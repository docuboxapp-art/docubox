import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  buildAutomationConditionContext,
  executeAgreementAction,
  type CanonicalEvent,
} from '@/lib/collaboration/automation';
import {
  automationConditionSchema,
  evaluateAutomationConditions,
} from '@/lib/collaboration/automation-conditions';
import { configuredAutomationActionSchema } from '@/lib/collaboration/automation-contracts';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import { emitDomainEvent } from '@/lib/notifications/service';
import { queueWebhookDeliveriesForEvent } from './webhook-dispatcher';
import {
  WORKFLOW_NOTIFICATION_CHANNELS,
  WORKFLOW_NOTIFICATION_RECIPIENTS,
} from './workflow-definition';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 5;

const notificationConfigurationSchema = z.object({
  channels: z.array(z.enum(WORKFLOW_NOTIFICATION_CHANNELS)).min(1).max(3),
  recipient: z.enum(WORKFLOW_NOTIFICATION_RECIPIENTS),
  title: z.string().trim().min(1).max(180),
  message: z.string().trim().min(1).max(1000),
  delivery_policy: z.enum(['single', 'fallback', 'multidelivery']),
});

type ClaimedWorkflowStep = {
  step_instance_id: string;
  workflow_instance_id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_version: number;
  workflow_name: string;
  subject_type: string;
  subject_id: string;
  started_by: string | null;
  context: Record<string, unknown> | null;
  step_id: string;
  step_type: 'notification' | 'action' | 'webhook' | 'condition';
  configuration: Record<string, unknown>;
  attempt_count: number;
  execution_claim_token: string;
  branch_decision: boolean | null;
};

function firstRow<T>(value: unknown): T | null {
  return (Array.isArray(value) ? value[0] : value) as T | null;
}

async function workflowStepEvent(
  service: SupabaseClient,
  step: ClaimedWorkflowStep
): Promise<CanonicalEvent> {
  if (step.subject_type !== 'document' || !UUID_PATTERN.test(step.subject_id)) {
    throw new Error('WORKFLOW_DOCUMENT_SUBJECT_REQUIRED');
  }
  const eventKey = `workflow-step:${step.step_instance_id}:execution`;
  const context = step.context || {};
  const participantReferenceId =
    typeof context.participant_reference_id === 'string' ? context.participant_reference_id : null;
  await appendDocumentOperationalEvent(service, {
    documentId: step.subject_id,
    workspaceId: step.workspace_id,
    participantReferenceId,
    actorUserId: step.started_by,
    eventType: `workflow.${step.step_type}.requested`,
    eventKey,
    source: 'worker',
    payload: {
      workflow_id: step.workflow_id,
      workflow_version: step.workflow_version,
      workflow_instance_id: step.workflow_instance_id,
      step_id: step.step_id,
    },
  });
  const event = await service
    .from('document_operational_events')
    .select(
      'id,workspace_id,document_id,participant_reference_id,event_type,correlation_id,occurred_at,payload'
    )
    .eq('document_id', step.subject_id)
    .eq('event_key', eventKey)
    .single();
  if (event.error) throw event.error;
  return event.data as CanonicalEvent;
}

async function notificationRecipient(
  service: SupabaseClient,
  step: ClaimedWorkflowStep,
  recipient: 'owner' | 'participant'
) {
  if (recipient === 'owner') {
    if (!step.started_by) throw new Error('WORKFLOW_NOTIFICATION_OWNER_UNAVAILABLE');
    return step.started_by;
  }
  const participantReferenceId = step.context?.participant_reference_id;
  if (typeof participantReferenceId !== 'string' || !UUID_PATTERN.test(participantReferenceId)) {
    throw new Error('WORKFLOW_NOTIFICATION_PARTICIPANT_CONTEXT_REQUIRED');
  }
  const participant = await service
    .from('document_participant_references')
    .select('participant_user_id')
    .eq('id', participantReferenceId)
    .eq('document_id', step.subject_id)
    .eq('workspace_id', step.workspace_id)
    .maybeSingle();
  if (participant.error) throw participant.error;
  if (!participant.data?.participant_user_id) {
    throw new Error('WORKFLOW_NOTIFICATION_PARTICIPANT_UNAVAILABLE');
  }
  return String(participant.data.participant_user_id);
}

async function executeNotificationStep(
  service: SupabaseClient,
  step: ClaimedWorkflowStep,
  event: CanonicalEvent
) {
  const config = notificationConfigurationSchema.parse(step.configuration);
  const userId = await notificationRecipient(service, step, config.recipient);
  return emitDomainEvent({
    type: 'workflow.notification_requested',
    recipients: [{ userId }],
    title: config.title,
    description: config.message,
    category: 'WORKFLOW',
    severity: 'info',
    legacyType: 'task',
    workspaceId: step.workspace_id,
    actorUserId: step.started_by,
    entityType: 'document',
    entityId: step.subject_id,
    metadata: {
      workflow_id: step.workflow_id,
      workflow_version: step.workflow_version,
      workflow_instance_id: step.workflow_instance_id,
      workflow_step_id: step.step_id,
      canonical_event_id: event.id,
    },
    deduplicationKey: `workflow-step:${step.step_instance_id}:notification`,
    channels: config.channels,
    deliveryPolicy: config.delivery_policy,
  });
}

function retryableWorkflowError(cause: unknown) {
  if (cause instanceof z.ZodError) return false;
  if (cause && typeof cause === 'object' && 'retryable' in cause) {
    return (cause as { retryable?: boolean }).retryable !== false;
  }
  const code = cause instanceof Error ? cause.message : String(cause);
  return !/INVALID|REQUIRED|UNAVAILABLE|NOT_FOUND|NOT_CONFIGURED|PERMISSION|SCOPE|AUTHORIZED/i.test(
    code
  );
}

async function finishStep(
  service: SupabaseClient,
  step: ClaimedWorkflowStep,
  input: {
    result: 'succeeded' | 'retry' | 'failed';
    eventId?: string | null;
    evidence?: Record<string, unknown>;
    errorCode?: string | null;
  }
) {
  const finished = await service.rpc('finish_organization_workflow_execution_step', {
    target_step_instance_id: step.step_instance_id,
    requested_claim_token: step.execution_claim_token,
    requested_result: input.result,
    requested_event_id: input.eventId || null,
    requested_evidence: input.evidence || {},
    requested_error_code: input.errorCode || null,
  });
  if (finished.error) throw finished.error;
}

export async function processOrganizationWorkflowExecutionSteps(
  service: SupabaseClient,
  options: { limit?: number; now?: Date } = {}
) {
  const now = options.now || new Date();
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const summary = { scanned: 0, succeeded: 0, retrying: 0, failed: 0 };

  for (let index = 0; index < limit; index += 1) {
    const claim = await service.rpc('claim_due_organization_workflow_execution_step', {
      p_now: now.toISOString(),
    });
    if (claim.error) throw claim.error;
    const step = firstRow<ClaimedWorkflowStep>(claim.data);
    if (!step) break;
    summary.scanned += 1;
    let event: CanonicalEvent | null = null;
    try {
      let evidence: Record<string, unknown> = {};
      if (step.step_type === 'condition') {
        let decision = step.branch_decision;
        let evaluation: ReturnType<typeof evaluateAutomationConditions> | null = null;
        if (decision === null) {
          const condition = automationConditionSchema.parse(step.configuration.condition);
          const context = await buildAutomationConditionContext(
            service,
            step.workspace_id,
            {
              document_id: step.subject_id,
              participant_reference_id: step.context?.participant_reference_id,
              event_type: step.context?.event_type,
            },
            null
          );
          evaluation = evaluateAutomationConditions([condition], context);
          const recorded = await service.rpc('record_organization_workflow_branch_decision', {
            target_step_instance_id: step.step_instance_id,
            requested_claim_token: step.execution_claim_token,
            requested_decision: evaluation.matched,
          });
          if (recorded.error) throw recorded.error;
          decision = Boolean(recorded.data);
        }
        evidence = {
          branch_decision: decision,
          condition: evaluation
            ? {
                schema_version: evaluation.schemaVersion,
                field: evaluation.results[0]?.field,
                operator: evaluation.results[0]?.operator,
                matched: evaluation.matched,
              }
            : { reused_committed_decision: true, matched: decision },
        };
      } else {
        event = await workflowStepEvent(service, step);
        if (step.step_type === 'notification') {
          const result = await executeNotificationStep(service, step, event);
          evidence = { notification: result };
        } else if (step.step_type === 'action') {
          const action = configuredAutomationActionSchema.parse(step.configuration.action);
          const result = await executeAgreementAction(service, {
            action,
            workspaceId: step.workspace_id,
            workflowId: step.workflow_id,
            workflowVersionId: step.workflow_id,
            workflowName: step.workflow_name,
            createdBy: step.started_by || '',
            actorUserId: step.started_by,
            correlationId: event.correlation_id,
            idempotencyKey: `workflow-step:${step.step_instance_id}:action`,
            event,
          });
          evidence = { action: result };
        } else {
          const endpointId = z.string().uuid().parse(step.configuration.webhook_configuration_id);
          evidence = {
            webhook: await queueWebhookDeliveriesForEvent(service, event, endpointId),
          };
        }
      }
      await finishStep(service, step, {
        result: 'succeeded',
        eventId: event?.id,
        evidence,
      });
      summary.succeeded += 1;
    } catch (cause) {
      const shouldRetry =
        retryableWorkflowError(cause) && Number(step.attempt_count || 1) < MAX_ATTEMPTS;
      await finishStep(service, step, {
        result: shouldRetry ? 'retry' : 'failed',
        eventId: event?.id,
        errorCode: cause instanceof Error ? cause.message.slice(0, 120) : 'WORKFLOW_STEP_FAILED',
      });
      if (shouldRetry) summary.retrying += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}
