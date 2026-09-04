import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { OrganizationApiError } from '@/lib/organization/server';
import { hasCurrentCollaborationEntitlement } from './entitlements-server';
import { automationRetryStatus, calculateAutomationBackoffSeconds } from './automation-policy';
import { emitDomainEvent } from '@/lib/notifications/service';

export { automationRetryStatus, calculateAutomationBackoffSeconds } from './automation-policy';

const configuredAutomationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('notify'),
    target: z.literal('owner').default('owner'),
    title: z.string().trim().min(1).max(180).optional(),
    message: z.string().trim().min(1).max(1000).optional(),
  }),
  z.object({
    type: z.literal('activity'),
    summary: z.string().trim().min(1).max(500),
  }),
]);

export type AutomationRunStatus =
  'queued' | 'running' | 'succeeded' | 'retrying' | 'failed' | 'dead_lettered' | 'cancelled';

export interface AutomationQueueResult {
  scanned: number;
  succeeded: number;
  retrying: number;
  deadLettered: number;
  skipped: number;
  results: Array<{ id: string; status: AutomationRunStatus; errorCode?: string }>;
}

export async function executeConfiguredAutomation(
  service: SupabaseClient,
  automation: Record<string, unknown>,
  version: Record<string, unknown>,
  actorUserId: string | null,
  correlationId?: string | null,
  automationDepth = 0,
  executionKey?: string | null
) {
  const actions = z.array(configuredAutomationActionSchema).min(1).max(20).parse(version.actions);
  const results: Array<Record<string, unknown>> = [];
  for (const [actionIndex, action] of actions.entries()) {
    const idempotencyKey = executionKey ? `automation:${executionKey}:action:${actionIndex}` : null;
    if (action.type === 'notify') {
      const ownerId = String(automation.created_by || '');
      if (!ownerId) {
        throw new OrganizationApiError(
          409,
          'automation_owner_missing',
          'La automatizacion no tiene un responsable para recibir la notificacion.'
        );
      }
      const emitted = await emitDomainEvent({
        type: 'workflow.automation_completed',
        recipients: [{ userId: ownerId }],
        title: action.title || `Automatización: ${String(automation.name || 'Colabora')}`,
        description:
          action.message || 'Una automatización de Docubox Colabora se ejecutó correctamente.',
        legacyType: 'task',
        category: 'WORKFLOW',
        severity: 'info',
        workspaceId: String(automation.workspace_id || ''),
        actorUserId,
        entityType: 'collaboration_automation',
        entityId: String(automation.id || ''),
        metadata: {
          module: 'colabora',
          automation_id: automation.id,
          correlation_id: correlationId || null,
        },
        deduplicationKey: idempotencyKey,
      });
      results.push({
        type: action.type,
        delivered_to: ownerId,
        deduplicated: emitted.deduplicated.length > 0,
      });
      continue;
    }

    const activity = await service.from('collaboration_activity_events').insert({
      workspace_id: automation.workspace_id,
      actor_user_id: actorUserId,
      event_type: 'automation.activity',
      resource_type: 'collaboration_automation',
      resource_id: automation.id,
      summary: action.summary,
      visibility: 'internal',
      correlation_id: correlationId || undefined,
      metadata: {
        actor_user_id: actorUserId,
        automation_version_id: version.id,
        automation_depth: automationDepth,
      },
      idempotency_key: idempotencyKey,
    });
    if (activity.error?.code === '23505') {
      results.push({ type: action.type, recorded: true, deduplicated: true });
      continue;
    }
    if (activity.error) throw activity.error;
    results.push({ type: action.type, recorded: true });
  }
  return results;
}

export async function processCollaborationAutomationQueue(
  service: SupabaseClient,
  options: { limit?: number; now?: Date } = {}
): Promise<AutomationQueueResult> {
  const now = options.now || new Date();
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const dueRuns = await service
    .from('collaboration_automation_runs')
    .select(
      'id,workspace_id,automation_id,automation_version_id,event_id,correlation_id,depth,status,attempt_count,input_snapshot,scheduled_at'
    )
    .in('status', ['queued', 'retrying'])
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (dueRuns.error) throw dueRuns.error;

  const summary: AutomationQueueResult = {
    scanned: dueRuns.data?.length || 0,
    succeeded: 0,
    retrying: 0,
    deadLettered: 0,
    skipped: 0,
    results: [],
  };
  const workspaceEntitlements = new Map<string, boolean>();

  for (const candidate of dueRuns.data || []) {
    let automationAllowed = workspaceEntitlements.get(candidate.workspace_id);
    if (automationAllowed === undefined) {
      automationAllowed = await hasCurrentCollaborationEntitlement(
        service,
        candidate.workspace_id,
        'collaboration_automations',
        true
      );
      workspaceEntitlements.set(candidate.workspace_id, automationAllowed);
    }
    if (!automationAllowed) {
      await service
        .from('collaboration_automation_runs')
        .update({
          status: 'cancelled',
          error_code: 'pro_plan_required',
          error_detail: 'La organizacion no tiene una suscripcion Colabora Pro activa.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
        .in('status', ['queued', 'retrying']);
      summary.skipped += 1;
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
      summary.skipped += 1;
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

    const invalidConfiguration =
      automation.error || version.error || !automation.data || !version.data;
    const disabled = automation.data && automation.data.status !== 'active';
    const excessiveDepth = Number(candidate.depth || 0) > Number(automation.data?.max_depth || 5);
    if (invalidConfiguration || disabled || excessiveDepth) {
      const errorCode = invalidConfiguration
        ? 'automation_configuration_missing'
        : disabled
          ? 'automation_not_active'
          : 'automation_max_depth_exceeded';
      await service
        .from('collaboration_automation_runs')
        .update({
          status: invalidConfiguration || excessiveDepth ? 'dead_lettered' : 'cancelled',
          error_code: errorCode,
          error_detail: 'La ejecucion no puede continuar con la configuracion actual.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);
      if (invalidConfiguration || excessiveDepth) summary.deadLettered += 1;
      else summary.skipped += 1;
      summary.results.push({
        id: candidate.id,
        status: invalidConfiguration || excessiveDepth ? 'dead_lettered' : 'cancelled',
        errorCode,
      });
      continue;
    }

    try {
      const actorId =
        typeof claimed.data.input_snapshot?.actor_user_id === 'string'
          ? claimed.data.input_snapshot.actor_user_id
          : null;
      const actions = await executeConfiguredAutomation(
        service,
        automation.data,
        version.data,
        actorId,
        candidate.correlation_id,
        Number(candidate.depth || 0),
        candidate.id
      );
      const completed = await service
        .from('collaboration_automation_runs')
        .update({
          status: 'succeeded',
          result_summary: { actions },
          completed_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);
      if (completed.error) throw completed.error;
      await service
        .from('collaboration_automations')
        .update({ consecutive_failures: 0 })
        .eq('id', candidate.automation_id);
      summary.succeeded += 1;
      summary.results.push({ id: candidate.id, status: 'succeeded' });
    } catch (cause) {
      const attempt = Number(claimed.data.attempt_count || 1);
      const nextStatus = automationRetryStatus(attempt, version.data.error_policy);
      const delay = calculateAutomationBackoffSeconds(attempt, version.data.error_policy);
      const detail = cause instanceof Error ? cause.message.slice(0, 1000) : 'execution_failed';
      const failed = await service
        .from('collaboration_automation_runs')
        .update({
          status: nextStatus,
          error_code: 'action_failed',
          error_detail: detail,
          scheduled_at: new Date(now.getTime() + delay * 1000).toISOString(),
          completed_at: nextStatus === 'dead_lettered' ? new Date().toISOString() : null,
        })
        .eq('id', candidate.id);
      if (failed.error) throw failed.error;
      await service
        .from('collaboration_automations')
        .update({ consecutive_failures: Number(automation.data.consecutive_failures || 0) + 1 })
        .eq('id', candidate.automation_id);
      if (nextStatus === 'dead_lettered') summary.deadLettered += 1;
      else summary.retrying += 1;
      summary.results.push({ id: candidate.id, status: nextStatus, errorCode: 'action_failed' });
    }
  }

  return summary;
}
