import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CertificationError, type CertificationStatus } from './types';

export type CertificationExecutionContext = {
  attempt: number;
  traceId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
};

type CertificationForExecution = {
  id: string;
  tenant_id: string;
  execution_attempt?: number | null;
  execution_trace_id?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  last_checkpoint?: string | null;
};

const LEASE_DURATION_MS = 90_000;

function isSchemaMissing(code?: string) {
  return code === '42P01' || code === '42703' || code === 'PGRST205';
}

export async function claimCertificationLease(
  supabase: SupabaseClient,
  certification: CertificationForExecution,
  leaseOwner: string = randomUUID()
): Promise<CertificationExecutionContext | null> {
  const now = new Date();
  const context: CertificationExecutionContext = {
    attempt: Number(certification.execution_attempt || 0) + 1,
    traceId: randomUUID(),
    leaseOwner,
    leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
  };

  const { data, error } = await supabase
    .from('document_certifications')
    .update({
      execution_status: certification.execution_attempt ? 'retrying' : 'queued',
      execution_attempt: context.attempt,
      execution_trace_id: context.traceId,
      lease_owner: context.leaseOwner,
      lease_expires_at: context.leaseExpiresAt,
      last_started_at: now.toISOString(),
      finished_at: null,
      recovery_detail: certification.last_checkpoint
        ? {
            checkpoint: certification.last_checkpoint,
            message: `Reanudacion solicitada desde checkpoint ${certification.last_checkpoint}.`,
          }
        : {},
    })
    .eq('id', certification.id)
    .eq('execution_attempt', Number(certification.execution_attempt || 0))
    .or(`lease_owner.is.null,lease_expires_at.lt.${now.toISOString()}`)
    .select('id')
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error.code)) {
      throw new CertificationError(
        'CERTIFICATION_ORCHESTRATION_SCHEMA_MISSING',
        'Falta aplicar la migracion del orquestador de certificacion.',
        503
      );
    }
    throw new CertificationError('CERTIFICATION_LEASE_FAILED', error.message, 500);
  }
  if (!data) return null;

  await supabase.from('certification_state_transitions').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    from_status: null,
    to_status: 'QUEUED',
    actor_id: null,
    result: 'PENDING',
    metadata: {
      attempt: context.attempt,
      trace_id: context.traceId,
      lease_owner: context.leaseOwner,
      recovery_checkpoint: certification.last_checkpoint || null,
    },
  });

  return context;
}

export async function recordCertificationCheckpoint(
  supabase: SupabaseClient,
  certification: CertificationForExecution,
  context: CertificationExecutionContext | undefined,
  checkpoint: CertificationStatus,
  state: 'started' | 'completed' | 'failed',
  detail: Record<string, unknown> = {}
) {
  if (!context) return;
  const now = new Date().toISOString();
  const previous =
    state === 'started'
      ? null
      : await supabase
          .from('certification_execution_checkpoints')
          .select('started_at')
          .eq('certification_id', certification.id)
          .eq('attempt', context.attempt)
          .eq('checkpoint', checkpoint)
          .maybeSingle();
  if (previous?.error)
    throw new CertificationError(
      'CERTIFICATION_CHECKPOINT_READ_FAILED',
      previous.error.message,
      500
    );
  const startedAt = previous?.data?.started_at || now;
  const durationMs =
    state === 'started' ? null : Math.max(0, Date.parse(now) - Date.parse(startedAt));
  const { error } = await supabase.from('certification_execution_checkpoints').upsert(
    {
      tenant_id: certification.tenant_id,
      certification_id: certification.id,
      attempt: context.attempt,
      trace_id: context.traceId,
      checkpoint,
      state,
      started_at: startedAt,
      completed_at: state === 'started' ? null : now,
      duration_ms: durationMs,
      recovery_detail: detail,
    },
    { onConflict: 'certification_id,attempt,checkpoint' }
  );
  if (error)
    throw new CertificationError('CERTIFICATION_CHECKPOINT_WRITE_FAILED', error.message, 500);

  const update: Record<string, unknown> = {
    last_checkpoint: checkpoint,
    last_checkpoint_at: now,
    execution_trace_id: context.traceId,
    lease_expires_at: new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
  };
  if (state === 'completed') update.execution_status = 'processing';
  if (state === 'failed') update.execution_status = 'manual_review';
  const certificationUpdate = await supabase
    .from('document_certifications')
    .update(update)
    .eq('id', certification.id)
    .eq('lease_owner', context.leaseOwner)
    .gt('lease_expires_at', now);
  if (certificationUpdate.error)
    throw new CertificationError(
      'CERTIFICATION_LEASE_LOST',
      'La ejecucion perdio el lease de certificacion.',
      409
    );
}

export async function finalizeCertificationExecution(
  supabase: SupabaseClient,
  certification: CertificationForExecution,
  context: CertificationExecutionContext | undefined,
  status: 'completed' | 'failed' | 'manual_review',
  recoveryDetail: Record<string, unknown> = {}
) {
  if (!context) return;
  const now = new Date().toISOString();
  const update = await supabase
    .from('document_certifications')
    .update({
      execution_status: status,
      lease_owner: null,
      lease_expires_at: null,
      finished_at: now,
      recovery_detail: recoveryDetail,
    })
    .eq('id', certification.id)
    .eq('lease_owner', context.leaseOwner)
    .gt('lease_expires_at', now);
  if (update.error)
    throw new CertificationError(
      'CERTIFICATION_FINALIZE_EXECUTION_FAILED',
      update.error.message,
      500
    );
}
