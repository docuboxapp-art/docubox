import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { OrganizationApiError } from '@/lib/organization/server';
import { hasCurrentCollaborationEntitlement } from './entitlements-server';
import { automationRetryStatus, calculateAutomationBackoffSeconds } from './automation-policy';
import { emitDomainEvent } from '@/lib/notifications/service';
import { issueNom151ForVerifiedPadesBt } from '@/lib/nom151/service';
import { queueWebhookDeliveriesForEvent } from '@/lib/organization/webhook-dispatcher';
import { configuredAutomationActionSchema } from './automation-contracts';
import {
  evaluateAutomationConditions,
  type AutomationConditionContext,
} from './automation-conditions';
import { analyzeContractualDocument } from '@/lib/ai/documentIntelligence';

export { automationRetryStatus, calculateAutomationBackoffSeconds } from './automation-policy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Action = z.infer<typeof configuredAutomationActionSchema>;
export type CanonicalEvent = {
  id: string;
  workspace_id: string | null;
  document_id: string;
  participant_reference_id?: string | null;
  event_type: string;
  correlation_id: string;
  occurred_at: string;
  payload?: Record<string, unknown> | null;
};

class AutomationExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'retrying'
  | 'failed'
  | 'dead_lettered'
  | 'cancelled'
  | 'skipped';
export interface AutomationQueueResult {
  scanned: number;
  succeeded: number;
  retrying: number;
  deadLettered: number;
  skipped: number;
  results: Array<{ id: string; status: AutomationRunStatus; errorCode?: string }>;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadCanonicalEvent(
  service: SupabaseClient,
  id: unknown
): Promise<CanonicalEvent | null> {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return null;
  const result = await service
    .from('document_operational_events')
    .select(
      'id,workspace_id,document_id,participant_reference_id,event_type,correlation_id,occurred_at,payload'
    )
    .eq('id', id)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as CanonicalEvent | null;
}

export async function buildAutomationConditionContext(
  service: SupabaseClient,
  workspaceId: string,
  snapshot: Record<string, unknown>,
  event: CanonicalEvent | null
): Promise<AutomationConditionContext> {
  const documentId = String(event?.document_id || snapshot.document_id || '');
  const base: AutomationConditionContext = {
    event: { type: String(event?.event_type || snapshot.event_type || '') },
    workspace: { id: workspaceId },
    organization: { id: workspaceId },
    participant: {
      reference_id: event?.participant_reference_id || snapshot.participant_reference_id || null,
    },
    document: {},
    metadata: {},
    package: { status: 'absent', resource_count: 0 },
  };
  if (!UUID_PATTERN.test(documentId)) return base;
  const [document, metadata, pack] = await Promise.all([
    service
      .from('documentos')
      .select('id,workspace_id,estado,tipo_documento_id,organization_workflow_id')
      .eq('id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    service
      .from('document_additional_metadata')
      .select('name,value_json')
      .eq('document_id', documentId)
      .eq('workspace_id', workspaceId)
      .eq('metadata_scope', 'management'),
    service
      .from('document_packages')
      .select('id')
      .eq('document_id', documentId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);
  if (document.error || metadata.error || pack.error)
    throw document.error || metadata.error || pack.error;
  if (!document.data)
    throw new AutomationExecutionError(
      'document_not_found',
      'El documento del evento no existe en el tenant.',
      false
    );
  let resourceCount = 0;
  if (pack.data?.id) {
    const resources = await service
      .from('document_package_resources')
      .select('id', { count: 'exact', head: true })
      .eq('package_id', pack.data.id)
      .is('deleted_at', null);
    if (resources.error) throw resources.error;
    resourceCount = resources.count || 0;
  }
  return {
    ...base,
    document: {
      status: document.data.estado,
      type_id: document.data.tipo_documento_id,
      classification: document.data.tipo_documento_id,
      template_id: document.data.organization_workflow_id,
    },
    metadata: Object.fromEntries(
      (metadata.data || []).map((row) => [String(row.name), row.value_json])
    ),
    package: { status: pack.data ? 'active' : 'absent', resource_count: resourceCount },
  };
}

async function notificationRecipients(
  service: SupabaseClient,
  action: Extract<Action, { type: 'notify' }>,
  automation: Record<string, unknown>,
  event: CanonicalEvent | null
) {
  if (action.target === 'owner') return [{ userId: String(automation.created_by || '') }];
  if (!event?.participant_reference_id) return [];
  const participant = await service
    .from('document_participant_references')
    .select('participant_user_id')
    .eq('id', event.participant_reference_id)
    .eq('document_id', event.document_id)
    .eq('workspace_id', automation.workspace_id)
    .maybeSingle();
  if (participant.error) throw participant.error;
  return participant.data?.participant_user_id
    ? [{ userId: participant.data.participant_user_id }]
    : [];
}

async function executeAction(
  service: SupabaseClient,
  action: Action,
  automation: Record<string, unknown>,
  version: Record<string, unknown>,
  actorUserId: string | null,
  correlationId: string | null | undefined,
  depth: number,
  key: string,
  event: CanonicalEvent | null
) {
  const workspaceId = String(automation.workspace_id || '');
  if (action.type === 'notify') {
    const recipients = await notificationRecipients(service, action, automation, event);
    if (!recipients.length || recipients.some(({ userId }) => !userId))
      throw new AutomationExecutionError(
        'notification_recipient_missing',
        'No existe un destinatario registrado para la notificación.',
        false
      );
    const emitted = await emitDomainEvent({
      type: 'workflow.automation_completed',
      recipients,
      title: action.title || `Automatización: ${String(automation.name || 'Colabora')}`,
      description: action.message || 'Una automatización documental se ejecutó correctamente.',
      legacyType: 'task',
      category: 'WORKFLOW',
      severity: 'info',
      workspaceId,
      actorUserId,
      entityType: event ? 'document' : 'collaboration_automation',
      entityId: event?.document_id || String(automation.id || ''),
      metadata: {
        module: 'colabora',
        automation_id: automation.id,
        correlation_id: correlationId || null,
      },
      deduplicationKey: key,
      channels: action.channels,
      deliveryPolicy: action.delivery_policy,
    });
    return {
      type: action.type,
      recipients: recipients.length,
      deduplicated: emitted.deduplicated.length,
    };
  }
  if (action.type === 'activity') {
    const result = await service.from('collaboration_activity_events').insert({
      workspace_id: workspaceId,
      actor_user_id: actorUserId,
      event_type: 'automation.activity',
      resource_type: event ? 'document' : 'collaboration_automation',
      resource_id: event?.document_id || automation.id,
      summary: action.summary,
      visibility: 'internal',
      correlation_id: correlationId || undefined,
      metadata: { automation_version_id: version.id, automation_depth: depth },
      idempotency_key: key,
    });
    if (result.error?.code !== '23505' && result.error) throw result.error;
    return { type: action.type, recorded: true, deduplicated: result.error?.code === '23505' };
  }
  if (!event)
    throw new AutomationExecutionError(
      'canonical_event_required',
      `La acción ${action.type} requiere un evento documental canónico.`,
      false
    );
  if (action.type === 'webhook')
    return {
      type: action.type,
      ...(await queueWebhookDeliveriesForEvent(service, event, action.endpoint_id)),
    };
  if (action.type === 'document_metadata') {
    const clientReference = `automation:${String(version.id)}:${action.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 80)}`;
    const metadata = await service.from('document_additional_metadata').upsert(
      {
        document_id: event.document_id,
        workspace_id: workspaceId,
        metadata_scope: 'management',
        data_type:
          typeof action.value === 'number'
            ? 'number'
            : typeof action.value === 'boolean'
              ? 'boolean'
              : 'text',
        name: action.name,
        value_json: action.value,
        value_display: String(action.value),
        client_reference: clientReference,
        created_by: String(automation.created_by),
        updated_by: actorUserId,
      },
      { onConflict: 'document_id,client_reference' }
    );
    if (metadata.error) throw metadata.error;
    return { type: action.type, client_reference: clientReference };
  }
  if (action.type === 'create_task') {
    const existing = await service
      .from('tareas')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('main_action', key.slice(0, 240))
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return { type: action.type, task_id: existing.data.id, deduplicated: true };
    const assignedTo =
      action.assigned_to === 'actor' && actorUserId ? actorUserId : String(automation.created_by);
    const task = await service
      .from('tareas')
      .insert({
        workspace_id: workspaceId,
        created_by: actorUserId || automation.created_by,
        assigned_to: assignedTo,
        title: action.title,
        description: action.description || null,
        tipo: 'revisar_documento',
        prioridad: 'media',
        estado: 'nueva',
        riesgo: 'bajo',
        due_date:
          action.due_in_days === undefined
            ? null
            : new Date(Date.now() + action.due_in_days * 86_400_000).toISOString(),
        main_action: key.slice(0, 240),
        document_id: event.document_id,
      })
      .select('id')
      .single();
    if (task.error) throw task.error;
    return { type: action.type, task_id: task.data.id };
  }
  if (action.type === 'trigger_lucia_contractual') {
    const actor = actorUserId || String(automation.created_by || '');
    const membership = await service
      .from('workspace_members')
      .select('role,status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', actor)
      .eq('status', 'active')
      .maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) {
      throw new AutomationExecutionError(
        'lucia_actor_not_authorized',
        'El actor de la automatizacion ya no tiene acceso al tenant.',
        false
      );
    }
    const analysis = await analyzeContractualDocument(
      event.document_id,
      workspaceId,
      actor,
      {
        service,
        authorization: {
          user_id: actor,
          workspace_id: workspaceId,
          role: membership.data.role,
          membership_status: membership.data.status,
          allowed_document_ids: [event.document_id],
          allowed_resource_ids: [event.document_id],
          permissions: ['read_document'],
          is_public_token_flow: false,
          token_grant_id: null,
          denied_reason: null,
        },
      },
      { requestedEventId: event.id }
    );
    return {
      type: action.type,
      analysis_run_id: analysis.analysis_run_id,
      reused: analysis.reused,
      document_version_scoped: true,
    };
  }
  const issued = await issueNom151ForVerifiedPadesBt(service, {
    documentId: event.document_id,
    requestedBy: actorUserId || String(automation.created_by),
  });
  return { type: action.type, record_id: issued.recordId, already_issued: issued.alreadyIssued };
}

export async function executeAgreementAction(
  service: SupabaseClient,
  input: {
    action: unknown;
    workspaceId: string;
    workflowId: string;
    workflowVersionId: string;
    workflowName: string;
    createdBy: string;
    actorUserId?: string | null;
    correlationId?: string | null;
    idempotencyKey: string;
    event?: CanonicalEvent | null;
  }
) {
  const action = configuredAutomationActionSchema.parse(input.action);
  return executeAction(
    service,
    action,
    {
      id: input.workflowId,
      workspace_id: input.workspaceId,
      name: input.workflowName,
      created_by: input.createdBy,
    },
    { id: input.workflowVersionId },
    input.actorUserId || null,
    input.correlationId,
    0,
    input.idempotencyKey,
    input.event || null
  );
}

export async function executeConfiguredAutomation(
  service: SupabaseClient,
  automation: Record<string, unknown>,
  version: Record<string, unknown>,
  actorUserId: string | null,
  correlationId?: string | null,
  automationDepth = 0,
  executionKey?: string | null,
  event?: CanonicalEvent | null
) {
  const actions = z.array(configuredAutomationActionSchema).min(1).max(20).parse(version.actions);
  const results: Array<Record<string, unknown>> = [];
  for (const [index, action] of actions.entries()) {
    const key = `automation:${String(version.id)}:event:${event?.id || executionKey || 'manual'}:action:${index}`;
    let actionRunId: string | null = null;
    if (executionKey && UUID_PATTERN.test(executionKey)) {
      const inserted = await service
        .from('collaboration_automation_action_runs')
        .insert({
          workspace_id: automation.workspace_id,
          automation_run_id: executionKey,
          automation_version_id: version.id,
          canonical_event_id: event?.id || null,
          action_index: index,
          action_type: action.type,
          idempotency_key: key,
        })
        .select('id')
        .maybeSingle();
      if (inserted.error?.code !== '23505' && inserted.error) throw inserted.error;
      const lookup = inserted.data
        ? {
            data: inserted.data as { id: string; status?: string; result_summary?: unknown },
            error: null,
          }
        : await service
            .from('collaboration_automation_action_runs')
            .select('id,status,result_summary')
            .eq('workspace_id', automation.workspace_id)
            .eq('idempotency_key', key)
            .single();
      if (lookup.error) throw lookup.error;
      if (lookup.data.status === 'succeeded') {
        results.push({ ...safeRecord(lookup.data.result_summary), deduplicated: true });
        continue;
      }
      const claimed = await service
        .from('collaboration_automation_action_runs')
        .update({ status: 'running', started_at: new Date().toISOString(), completed_at: null })
        .eq('id', lookup.data.id)
        .in('status', ['pending', 'retrying', 'failed'])
        .select('id,attempt_count')
        .maybeSingle();
      if (claimed.error) throw claimed.error;
      if (!claimed.data)
        throw new AutomationExecutionError(
          'action_already_running',
          'La acción ya está siendo procesada.',
          true
        );
      actionRunId = claimed.data.id;
      await service
        .from('collaboration_automation_action_runs')
        .update({ attempt_count: Number(claimed.data.attempt_count || 0) + 1 })
        .eq('id', actionRunId);
    }
    try {
      const result = await executeAction(
        service,
        action,
        automation,
        version,
        actorUserId,
        correlationId,
        automationDepth,
        key,
        event || null
      );
      if (actionRunId) {
        const completed = await service
          .from('collaboration_automation_action_runs')
          .update({
            status: 'succeeded',
            result_summary: result,
            error_code: null,
            error_detail: null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', actionRunId)
          .eq('status', 'running');
        if (completed.error) throw completed.error;
      }
      results.push(result);
    } catch (cause) {
      const known = cause as AutomationExecutionError;
      if (actionRunId)
        await service
          .from('collaboration_automation_action_runs')
          .update({
            status: known.retryable === false ? 'failed' : 'retrying',
            error_code: known.code || 'action_failed',
            error_detail: cause instanceof Error ? cause.message.slice(0, 1000) : 'action_failed',
            completed_at: known.retryable === false ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', actionRunId);
      throw cause;
    }
  }
  return results;
}

export async function processCollaborationAutomationQueue(
  service: SupabaseClient,
  options: { limit?: number; now?: Date } = {}
): Promise<AutomationQueueResult> {
  const now = options.now || new Date();
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const due = await service
    .from('collaboration_automation_runs')
    .select(
      'id,workspace_id,automation_id,automation_version_id,event_id,canonical_event_id,correlation_id,depth,status,attempt_count,input_snapshot,scheduled_at'
    )
    .in('status', ['queued', 'retrying'])
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at')
    .limit(limit);
  if (due.error) throw due.error;
  const summary: AutomationQueueResult = {
    scanned: due.data?.length || 0,
    succeeded: 0,
    retrying: 0,
    deadLettered: 0,
    skipped: 0,
    results: [],
  };
  const entitlements = new Map<string, boolean>();
  for (const candidate of due.data || []) {
    let allowed = entitlements.get(candidate.workspace_id);
    if (allowed === undefined) {
      allowed = await hasCurrentCollaborationEntitlement(
        service,
        candidate.workspace_id,
        'collaboration_automations',
        true
      );
      entitlements.set(candidate.workspace_id, allowed);
    }
    if (!allowed) {
      await service
        .from('collaboration_automation_runs')
        .update({
          status: 'cancelled',
          error_code: 'pro_plan_required',
          error_detail: 'La organización no tiene una suscripción Colabora Pro activa.',
          completed_at: now.toISOString(),
        })
        .eq('id', candidate.id)
        .in('status', ['queued', 'retrying']);
      summary.skipped++;
      summary.results.push({
        id: candidate.id,
        status: 'cancelled',
        errorCode: 'pro_plan_required',
      });
      continue;
    }
    const claimed = await service
      .from('collaboration_automation_runs')
      .update({
        status: 'running',
        started_at: now.toISOString(),
        attempt_count: Number(candidate.attempt_count || 0) + 1,
        error_code: null,
        error_detail: null,
      })
      .eq('id', candidate.id)
      .in('status', ['queued', 'retrying'])
      .select('*')
      .maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) {
      summary.skipped++;
      continue;
    }
    const [automation, version] = await Promise.all([
      service
        .from('collaboration_automations')
        .select('*')
        .eq('workspace_id', candidate.workspace_id)
        .eq('id', candidate.automation_id)
        .maybeSingle(),
      service
        .from('collaboration_automation_versions')
        .select('*')
        .eq('workspace_id', candidate.workspace_id)
        .eq('id', candidate.automation_version_id)
        .maybeSingle(),
    ]);
    const invalid = automation.error || version.error || !automation.data || !version.data;
    const disabled = automation.data && automation.data.status !== 'active';
    const tooDeep = Number(candidate.depth || 0) > Number(automation.data?.max_depth || 5);
    if (invalid || disabled || tooDeep) {
      const code = invalid
        ? 'automation_configuration_missing'
        : disabled
          ? 'automation_not_active'
          : 'automation_max_depth_exceeded';
      const status: AutomationRunStatus = invalid || tooDeep ? 'dead_lettered' : 'cancelled';
      await service
        .from('collaboration_automation_runs')
        .update({
          status,
          error_code: code,
          error_detail: 'La ejecución no puede continuar con la configuración actual.',
          completed_at: now.toISOString(),
        })
        .eq('id', candidate.id);
      if (status === 'dead_lettered') summary.deadLettered++;
      else summary.skipped++;
      summary.results.push({ id: candidate.id, status, errorCode: code });
      continue;
    }
    try {
      const snapshot = safeRecord(claimed.data.input_snapshot);
      const event = await loadCanonicalEvent(
        service,
        candidate.canonical_event_id || snapshot.canonical_event_id
      );
      const conditionResult = evaluateAutomationConditions(
        version.data.conditions,
        await buildAutomationConditionContext(service, candidate.workspace_id, snapshot, event)
      );
      if (!conditionResult.matched) {
        await service
          .from('collaboration_automation_runs')
          .update({
            status: 'skipped',
            condition_result: conditionResult,
            result_summary: { reason: 'conditions_not_met' },
            completed_at: new Date().toISOString(),
          })
          .eq('id', candidate.id);
        summary.skipped++;
        summary.results.push({ id: candidate.id, status: 'skipped' });
        continue;
      }
      const actor = typeof snapshot.actor_user_id === 'string' ? snapshot.actor_user_id : null;
      const actions = await executeConfiguredAutomation(
        service,
        automation.data,
        version.data,
        actor,
        candidate.correlation_id,
        Number(candidate.depth || 0),
        candidate.id,
        event
      );
      const completed = await service
        .from('collaboration_automation_runs')
        .update({
          status: 'succeeded',
          condition_result: conditionResult,
          result_summary: { actions },
          completed_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);
      if (completed.error) throw completed.error;
      await service
        .from('collaboration_automations')
        .update({ consecutive_failures: 0 })
        .eq('id', candidate.automation_id);
      summary.succeeded++;
      summary.results.push({ id: candidate.id, status: 'succeeded' });
    } catch (cause) {
      const attempt = Number(claimed.data.attempt_count || 1);
      const nonRetryable =
        (cause instanceof AutomationExecutionError && !cause.retryable) ||
        cause instanceof z.ZodError ||
        cause instanceof OrganizationApiError;
      const status: AutomationRunStatus = nonRetryable
        ? 'dead_lettered'
        : automationRetryStatus(attempt, version.data.error_policy);
      const code =
        cause instanceof AutomationExecutionError
          ? cause.code
          : cause instanceof z.ZodError
            ? 'invalid_automation_definition'
            : 'action_failed';
      const delay = calculateAutomationBackoffSeconds(attempt, version.data.error_policy);
      const failed = await service
        .from('collaboration_automation_runs')
        .update({
          status,
          error_code: code,
          error_detail: cause instanceof Error ? cause.message.slice(0, 1000) : 'execution_failed',
          scheduled_at: new Date(now.getTime() + delay * 1000).toISOString(),
          completed_at: status === 'dead_lettered' ? new Date().toISOString() : null,
        })
        .eq('id', candidate.id);
      if (failed.error) throw failed.error;
      await service
        .from('collaboration_automations')
        .update({ consecutive_failures: Number(automation.data.consecutive_failures || 0) + 1 })
        .eq('id', candidate.automation_id);
      if (status === 'dead_lettered') summary.deadLettered++;
      else summary.retrying++;
      summary.results.push({ id: candidate.id, status, errorCode: code });
    }
  }
  return summary;
}
