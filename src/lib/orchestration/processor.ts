import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import {
  deliverDocumentInvitations,
  stampDeliveredParticipants,
  type DeliveryParticipant,
} from './document-delivery';
import { processCollaborationAutomationQueue } from '@/lib/collaboration/automation';
import { processNotificationDeliveries } from '@/lib/notifications/delivery-worker';
import { processOrganizationWebhookDeliveries } from '@/lib/organization/webhook-dispatcher';
import { processOrganizationWorkflowExecutionSteps } from '@/lib/organization/workflow-runtime';
import { processBulkSignatureCampaigns } from '@/lib/bulk-signatures/runtime';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';
import { isPhaseCFeatureEnabled, PHASE_C_FEATURE_KEYS } from './feature-flags';

const TERMINAL = new Set(['completado', 'cancelado', 'rechazado', 'vencido', 'expirado']);

function retryAt(attempt: number) {
  return new Date(
    Date.now() + Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600) * 1000
  ).toISOString();
}

function claimedRow(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

function expired(document: Record<string, unknown>) {
  return (
    document.tiene_vencimiento === true &&
    typeof document.fecha_vencimiento === 'string' &&
    new Date(document.fecha_vencimiento).getTime() <= Date.now()
  );
}

async function processSendSchedules(service: SupabaseClient, limit = 20) {
  const summary = { scanned: 0, succeeded: 0, retrying: 0, skipped: 0 };
  const workerId = `phase-c-send-${randomUUID()}`;
  for (let index = 0; index < limit; index++) {
    const claim = await service.rpc('claim_due_document_send_schedule', {
      p_worker_id: workerId,
      p_now: new Date().toISOString(),
    });
    if (claim.error) throw claim.error;
    const schedule = claimedRow(claim.data) as Record<string, unknown> | null;
    if (!schedule) break;
    summary.scanned++;
    try {
      const documentResult = await service
        .from('documentos')
        .select(
          'id,workspace_id,owner_id,nombre,descripcion,estado,tiene_vencimiento,fecha_vencimiento,participantes'
        )
        .eq('id', schedule.document_id)
        .eq('workspace_id', schedule.workspace_id)
        .maybeSingle();
      if (documentResult.error) throw documentResult.error;
      const document = documentResult.data as Record<string, unknown> | null;
      if (
        !document ||
        TERMINAL.has(String(document.estado || '').toLowerCase()) ||
        expired(document)
      ) {
        await service
          .from('document_send_schedules')
          .update({
            status: 'skipped',
            last_error_code: 'DOCUMENT_NOT_ELIGIBLE',
            executed_at: new Date().toISOString(),
          })
          .eq('id', schedule.id)
          .eq('status', 'processing');
        summary.skipped++;
        continue;
      }
      const participants = Array.isArray(document.participantes)
        ? (document.participantes as DeliveryParticipant[])
        : [];
      const ids = new Set(
        Array.isArray((schedule.payload as Record<string, unknown>)?.initial_visible_ids)
          ? ((schedule.payload as Record<string, unknown>).initial_visible_ids as string[])
          : []
      );
      const activated = participants.map((participant) =>
        participant.isCurrentUser || ids.has(String(participant.id || ''))
          ? { ...participant, visible: true }
          : participant
      );
      const state = await service
        .from('documentos')
        .update({ estado: 'en_proceso', participantes: activated })
        .eq('id', document.id)
        .eq('workspace_id', schedule.workspace_id)
        .eq('estado', 'programado')
        .select('id')
        .maybeSingle();
      if (state.error) throw state.error;
      if (!state.data) {
        await service
          .from('document_send_schedules')
          .update({
            status: 'skipped',
            last_error_code: 'SCHEDULE_STATE_CHANGED',
            executed_at: new Date().toISOString(),
          })
          .eq('id', schedule.id)
          .eq('status', 'processing');
        summary.skipped++;
        continue;
      }
      const delivery = await deliverDocumentInvitations(service, {
        documentId: String(document.id),
        workspaceId: String(schedule.workspace_id),
        ownerId: String(document.owner_id),
        documentName: String(document.nombre || 'Documento'),
        documentDescription: typeof document.descripcion === 'string' ? document.descripcion : null,
        participants: activated,
      });
      const at = new Date().toISOString();
      if (delivery.sent.length)
        await service
          .from('documentos')
          .update({
            participantes: stampDeliveredParticipants(
              activated,
              delivery.sent.map((item) => item.email),
              at
            ),
          })
          .eq('id', document.id)
          .eq('workspace_id', schedule.workspace_id);
      const event = await appendDocumentOperationalEvent(service, {
        documentId: String(document.id),
        workspaceId: String(schedule.workspace_id),
        actorUserId: String(schedule.created_by),
        eventType: 'document.sent',
        eventKey: `scheduled-send:${String(schedule.id)}`,
        source: 'worker',
        payload: {
          schedule_id: schedule.id,
          timezone: schedule.timezone,
          invitation_count: delivery.attempted,
        },
      });
      await service.from('audit_trail').insert({
        documento_id: document.id,
        actor_id: schedule.created_by,
        action: 'envio_programado_ejecutado',
        category: 'orquestacion',
        details: { schedule_id: schedule.id, canonical_event_id: event.id },
      });
      await service
        .from('document_send_schedules')
        .update({ status: 'succeeded', executed_at: at, claim_expires_at: null })
        .eq('id', schedule.id)
        .eq('status', 'processing');
      summary.succeeded++;
    } catch (cause) {
      const attempt = Number(schedule.attempt_count || 1);
      const retry = attempt < 5;
      await service
        .from('document_send_schedules')
        .update({
          status: retry ? 'retrying' : 'failed',
          next_retry_at: retry ? retryAt(attempt) : null,
          last_error_code: 'SCHEDULE_EXECUTION_FAILED',
          last_error_detail:
            cause instanceof Error ? cause.message.slice(0, 1000) : 'unknown_error',
          claim_expires_at: null,
        })
        .eq('id', schedule.id)
        .eq('status', 'processing');
      if (retry) summary.retrying++;
      else summary.skipped++;
    }
  }
  return summary;
}

async function processRoutingSchedules(service: SupabaseClient, limit = 30) {
  const summary = { scanned: 0, succeeded: 0, retrying: 0, skipped: 0 };
  const workerId = `phase-c-routing-${randomUUID()}`;
  for (let index = 0; index < limit; index++) {
    const claim = await service.rpc('claim_due_document_routing_schedule', {
      p_worker_id: workerId,
      p_now: new Date().toISOString(),
    });
    if (claim.error) throw claim.error;
    const schedule = claimedRow(claim.data) as Record<string, unknown> | null;
    if (!schedule) break;
    summary.scanned++;
    try {
      const documentResult = await service
        .from('documentos')
        .select(
          'id,workspace_id,owner_id,nombre,descripcion,estado,tiene_vencimiento,fecha_vencimiento,participantes'
        )
        .eq('id', schedule.document_id)
        .eq('workspace_id', schedule.workspace_id)
        .maybeSingle();
      if (documentResult.error) throw documentResult.error;
      const document = documentResult.data as Record<string, unknown> | null;
      if (
        !document ||
        TERMINAL.has(String(document.estado || '').toLowerCase()) ||
        expired(document)
      ) {
        await service
          .from('document_routing_schedules')
          .update({
            status: 'skipped',
            last_error_code: 'DOCUMENT_NOT_ELIGIBLE',
            activated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id)
          .eq('status', 'processing');
        summary.skipped++;
        continue;
      }
      const participants = Array.isArray(document.participantes)
        ? (document.participantes as DeliveryParticipant[])
        : [];
      const target = participants.find(
        (participant) => String(participant.id || '') === String(schedule.participant_json_id)
      );
      if (!target || target.visible === true) {
        await service
          .from('document_routing_schedules')
          .update({
            status: target ? 'succeeded' : 'skipped',
            last_error_code: target ? null : 'PARTICIPANT_NOT_FOUND',
            activated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id)
          .eq('status', 'processing');
        if (target) summary.succeeded++;
        else summary.skipped++;
        continue;
      }
      const activated = participants.map((participant) =>
        String(participant.id || '') === String(schedule.participant_json_id)
          ? { ...participant, visible: true }
          : participant
      );
      const state = await service
        .from('documentos')
        .update({ participantes: activated })
        .eq('id', document.id)
        .eq('workspace_id', schedule.workspace_id)
        .eq('participantes', participants)
        .select('id')
        .maybeSingle();
      if (state.error) throw state.error;
      if (!state.data) throw new Error('ROUTING_STATE_CHANGED');
      const delivery = await deliverDocumentInvitations(service, {
        documentId: String(document.id),
        workspaceId: String(schedule.workspace_id),
        ownerId: String(document.owner_id),
        documentName: String(document.nombre || 'Documento'),
        participants: activated.filter(
          (participant) => String(participant.id || '') === String(schedule.participant_json_id)
        ),
        eventType: 'workflow.step_available',
      });
      const at = new Date().toISOString();
      if (delivery.sent.length)
        await service
          .from('documentos')
          .update({
            participantes: stampDeliveredParticipants(
              activated,
              delivery.sent.map((item) => item.email),
              at
            ),
          })
          .eq('id', document.id)
          .eq('workspace_id', schedule.workspace_id);
      await appendDocumentOperationalEvent(service, {
        documentId: String(document.id),
        workspaceId: String(schedule.workspace_id),
        participantReferenceId: String(schedule.participant_reference_id),
        eventType: 'workflow.participation_activated',
        eventKey: `routing-schedule:${String(schedule.id)}`,
        causationId: typeof schedule.source_event_id === 'string' ? schedule.source_event_id : null,
        source: 'worker',
        payload: { routing_mode: schedule.routing_mode, schedule_id: schedule.id },
      });
      await service
        .from('document_routing_schedules')
        .update({ status: 'succeeded', activated_at: at, claim_expires_at: null })
        .eq('id', schedule.id)
        .eq('status', 'processing');
      summary.succeeded++;
    } catch (cause) {
      const attempt = Number(schedule.attempt_count || 1);
      const retry = attempt < 5;
      await service
        .from('document_routing_schedules')
        .update({
          status: retry ? 'retrying' : 'failed',
          next_retry_at: retry ? retryAt(attempt) : null,
          last_error_code: 'ROUTING_EXECUTION_FAILED',
          last_error_detail:
            cause instanceof Error ? cause.message.slice(0, 1000) : 'unknown_error',
          claim_expires_at: null,
        })
        .eq('id', schedule.id)
        .eq('status', 'processing');
      if (retry) summary.retrying++;
      else summary.skipped++;
    }
  }
  return summary;
}

async function processOrganizationWorkflowSchedules(service: SupabaseClient, limit = 25) {
  const [delays, executableSteps] = await Promise.all([
    service.rpc('advance_due_organization_workflow_steps', {
      p_now: new Date().toISOString(),
      p_limit: Math.min(Math.max(limit, 1), 100),
    }),
    processOrganizationWorkflowExecutionSteps(service, { limit }),
  ]);
  if (delays.error) throw delays.error;
  return { delaysAdvanced: Number(delays.data || 0), executableSteps };
}

export async function processPhaseCOrchestration(service: SupabaseClient) {
  const [flags, bulkRuntimeEnabled, workflowBuilderEnabled] = await Promise.all([
    Promise.all(
      Object.values(PHASE_C_FEATURE_KEYS).map((key) => isPhaseCFeatureEnabled(service, key))
    ),
    isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.bulkRuntime),
    isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.workflowBuilder),
  ]);
  const enabled = Object.fromEntries(
    Object.keys(PHASE_C_FEATURE_KEYS).map((key, index) => [key, flags[index]])
  );
  const [
    scheduledSending,
    delayedRouting,
    automations,
    notifications,
    webhooks,
    bulkSignatures,
    organizationWorkflows,
  ] = await Promise.all([
    enabled.scheduledSending ? processSendSchedules(service) : { disabled: true },
    enabled.delayedRouting ? processRoutingSchedules(service) : { disabled: true },
    enabled.agreementActions ? processCollaborationAutomationQueue(service) : { disabled: true },
    enabled.multichannel ? processNotificationDeliveries(service) : { disabled: true },
    enabled.webhooks ? processOrganizationWebhookDeliveries(service) : { disabled: true },
    bulkRuntimeEnabled ? processBulkSignatureCampaigns(service) : { disabled: true },
    workflowBuilderEnabled ? processOrganizationWorkflowSchedules(service) : { disabled: true },
  ]);
  return {
    enabled: {
      ...enabled,
      bulkSignatures: bulkRuntimeEnabled,
      organizationWorkflows: workflowBuilderEnabled,
    },
    scheduledSending,
    delayedRouting,
    automations,
    notifications,
    webhooks,
    bulkSignatures,
    organizationWorkflows,
  };
}
