import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { issueNom151ForVerifiedPadesBt, Nom151ServiceError } from '@/lib/nom151/service';
import { createBlockchainEvidenceForFinalDocument } from '@/lib/blockchain-evidence/service';
import { queueVerifiedDocumentCompletionEmails } from '@/lib/notifications/document-completion';
import { generateEvidenceV2ForDocument, EvidenceV2ServiceError } from './service';

type FinalizationJob = {
  id: string;
  document_id: string;
  document_version_id: string;
  source_certification_id: string;
  requested_by: string | null;
  attempt_count: number;
  fencing_token: number;
  checkpoints: Record<string, unknown> | null;
};

function retryAt(attempt: number) {
  const seconds = Math.min(15 * 60, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function retryable(error: unknown) {
  if (error instanceof Nom151ServiceError)
    return error.status >= 429 || error.code === 'NOM151_IN_PROGRESS';
  if (error instanceof EvidenceV2ServiceError)
    return error.status >= 500 || error.code.includes('NOT_READY');
  return true;
}

async function progress(
  service: SupabaseClient,
  job: FinalizationJob,
  workerId: string,
  state: string,
  checkpoints: Record<string, unknown>
) {
  const result = await service.rpc('transition_evidence_finalization', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_fencing_token: job.fencing_token,
    p_state: state,
    p_checkpoints: checkpoints,
    p_readiness: null,
    p_error_code: null,
    p_error_detail: null,
    p_retry_at: null,
    p_package_id: null,
  });
  if (result.error || !result.data)
    throw result.error || new Error('EVIDENCE_FINALIZATION_FENCING_REJECTED');
  await heartbeat(service, job, workerId);
}

async function heartbeat(service: SupabaseClient, job: FinalizationJob, workerId: string) {
  const result = await service.rpc('heartbeat_evidence_finalization', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_fencing_token: job.fencing_token,
    p_lease_seconds: 420,
  });
  if (result.error || result.data !== true)
    throw result.error || new Error('EVIDENCE_FINALIZATION_LEASE_LOST');
}

async function withLeaseHeartbeat<T>(
  service: SupabaseClient,
  job: FinalizationJob,
  workerId: string,
  operation: () => Promise<T>
) {
  let heartbeatFailure: unknown = null;
  await heartbeat(service, job, workerId);
  const timer = setInterval(() => {
    void heartbeat(service, job, workerId).catch((error) => {
      heartbeatFailure = error;
    });
  }, 60_000);
  timer.unref?.();
  try {
    const result = await operation();
    if (heartbeatFailure) throw heartbeatFailure;
    await heartbeat(service, job, workerId);
    return result;
  } finally {
    clearInterval(timer);
  }
}

function internalErrorCode(error: unknown) {
  if (error instanceof Nom151ServiceError || error instanceof EvidenceV2ServiceError)
    return error.code;
  if (error instanceof Error && /^[A-Z0-9_.:-]+$/.test(error.message)) return error.message;
  return 'EVIDENCE_FINALIZATION_FAILED';
}

async function finish(
  service: SupabaseClient,
  job: FinalizationJob,
  workerId: string,
  input: {
    state: string;
    checkpoints?: Record<string, unknown>;
    readiness?: Record<string, unknown>;
    errorCode?: string;
    errorDetail?: string;
    retryAt?: string;
    packageId?: string;
  }
) {
  const result = await service.rpc('transition_evidence_finalization', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_fencing_token: job.fencing_token,
    p_state: input.state,
    p_checkpoints: input.checkpoints || job.checkpoints || {},
    p_readiness: input.readiness || {},
    p_error_code: input.errorCode || null,
    p_error_detail: input.errorDetail || null,
    p_retry_at: input.retryAt || null,
    p_package_id: input.packageId || null,
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function enqueueEvidenceFinalization(
  service: SupabaseClient,
  input: { documentId: string; actorId: string; certificationId?: string | null }
) {
  let certificationQuery = service
    .from('document_certifications')
    .select('id,document_version_id')
    .eq('document_id', input.documentId)
    .eq('status', 'COMPLETED')
    .eq('verification_status', 'valid');
  if (input.certificationId)
    certificationQuery = certificationQuery.eq('certification_uuid', input.certificationId);
  const certification = await certificationQuery
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (certification.error || !certification.data?.document_version_id)
    throw (
      certification.error ||
      new EvidenceV2ServiceError(
        'EVIDENCE_FINALIZATION_PADES_MISSING',
        'No existe PAdES verificable para encolar la evidencia.',
        409
      )
    );
  const idempotencyKey = `evidence-finalize:${certification.data.document_version_id}:v2`;
  const result = await service
    .from('evidence_finalizations')
    .upsert(
      {
        document_id: input.documentId,
        document_version_id: certification.data.document_version_id,
        source_certification_id: certification.data.id,
        idempotency_key: idempotencyKey,
        state: 'FINALIZATION_PENDING',
        requested_by: input.actorId,
        next_attempt_at: new Date().toISOString(),
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    )
    .select('*')
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return result.data;
  const existing = await service
    .from('evidence_finalizations')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .single();
  if (existing.error) throw existing.error;
  return existing.data;
}

export async function processEvidenceFinalization(
  service: SupabaseClient,
  input: { documentId?: string; workerId?: string } = {}
) {
  const workerId = input.workerId || `evidence-worker:${randomUUID()}`;
  const claimed = await service.rpc('claim_evidence_finalization', {
    p_worker_id: workerId,
    p_lease_seconds: 420,
    p_document_id: input.documentId || null,
  });
  if (claimed.error) throw claimed.error;
  const job = (Array.isArray(claimed.data) ? claimed.data[0] : claimed.data) as
    FinalizationJob | undefined;
  if (!job) return null;
  const checkpoints = { ...(job.checkpoints || {}) };
  try {
    await progress(service, job, workerId, 'WAITING_FOR_PADES', checkpoints);
    checkpoints.pades = 'verified';
    await progress(service, job, workerId, 'WAITING_FOR_TIMESTAMP', checkpoints);
    checkpoints.rfc3161 = 'verified';
    await progress(service, job, workerId, 'WAITING_FOR_NOM151', checkpoints);
    let nomPending = false;
    try {
      await withLeaseHeartbeat(service, job, workerId, () =>
        issueNom151ForVerifiedPadesBt(service, {
          documentId: job.document_id,
          requestedBy: job.requested_by || '',
        })
      );
      checkpoints.nom151 = 'verified';
    } catch (error) {
      if (!retryable(error) || job.attempt_count < 3) throw error;
      nomPending = true;
      checkpoints.nom151 = 'pending_supplement';
    }
    await progress(service, job, workerId, 'WAITING_FOR_OTS_STAMP', checkpoints);
    const ots = await withLeaseHeartbeat(service, job, workerId, () =>
      createBlockchainEvidenceForFinalDocument(service, {
        documentId: job.document_id,
        actorId: job.requested_by,
        submitImmediately: true,
      })
    );
    checkpoints.opentimestamps = ots
      ? { status: ots.status, proof: Boolean(ots.proof_storage_path && ots.proof_sha256) }
      : 'not_applicable';
    if (ots && (!ots.proof_storage_path || !ots.proof_sha256))
      throw new Error('OTS_INITIAL_STAMP_MISSING');
    const bind = await service
      .from('signature_evidence')
      .update({ document_version_id: job.document_version_id })
      .eq('document_id', job.document_id)
      .eq('evidence_role', 'FINAL_SIGNATURE')
      .eq('is_voided', false);
    if (bind.error) throw bind.error;
    checkpoints.signatures = 'bound';
    await progress(service, job, workerId, 'READY_FOR_EVIDENCE_XML', checkpoints);
    await progress(service, job, workerId, 'GENERATING_EVIDENCE', checkpoints);
    const evidence = await withLeaseHeartbeat(service, job, workerId, () =>
      generateEvidenceV2ForDocument(service, {
        documentId: job.document_id,
        actorId: job.requested_by,
        allowNom151Pending: nomPending,
        onStage: async (stage) => {
          await progress(service, job, workerId, stage, checkpoints);
        },
      })
    );
    checkpoints.evidence_xml = { package_id: evidence.package_id, xml_sha256: evidence.xml_sha256 };
    const pending = nomPending || String(ots?.status || '').toUpperCase() === 'PENDING_BITCOIN';
    const finalState = pending ? 'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS' : 'EVIDENCE_READY';
    await finish(service, job, workerId, {
      state: finalState,
      checkpoints,
      readiness:
        'readiness' in evidence
          ? evidence.readiness
          : { status: 'READY', codes: [], pendingSupplements: [] },
      packageId: evidence.id,
    });
    try {
      const certification = await service
        .from('document_certifications')
        .select('certification_uuid')
        .eq('id', job.source_certification_id)
        .single();
      if (!certification.error && certification.data?.certification_uuid && job.requested_by) {
        await queueVerifiedDocumentCompletionEmails(service, {
          documentId: job.document_id,
          certificationUuid: certification.data.certification_uuid,
          requestedBy: job.requested_by,
        });
      }
    } catch (error) {
      console.error('[evidence-finalization] Completion email queue failed', {
        code: error instanceof Error ? error.name : 'EMAIL_QUEUE_FAILED',
      });
    }
    return { state: finalState, packageId: evidence.package_id };
  } catch (error) {
    const code = internalErrorCode(error);
    const canRetry = retryable(error) && job.attempt_count < 8;
    await finish(service, job, workerId, {
      state: canRetry ? 'FINALIZATION_RETRY_SCHEDULED' : 'FINALIZATION_ERROR',
      checkpoints,
      errorCode: code,
      errorDetail: error instanceof Error ? error.message : 'unknown',
      retryAt: canRetry ? retryAt(job.attempt_count) : undefined,
    });
    if (!canRetry) throw error;
    return { state: 'FINALIZATION_RETRY_SCHEDULED', code };
  }
}
