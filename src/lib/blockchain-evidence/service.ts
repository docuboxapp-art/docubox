import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { blockchainEvidenceConfig } from './config';
import { resolveBitcoinBlock } from './bitcoin-core';
import { createBlockchainEvidenceManifest, hashBytes } from './manifest';
import { createOpenTimestampProvider } from './provider';
import { readBlockchainArtifact, storeBlockchainArtifact } from './storage';
import { retryDelayMs } from './state-machine';
import type { OpenTimestampProvider } from './types';
import { createBitcoinAnchorCertificate } from './certificate';

const CERTIFICATION_BUCKET = 'certification-artifacts';

export class BlockchainEvidenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500
  ) {
    super(message);
    this.name = 'BlockchainEvidenceError';
  }
}

function safeErrorCode(error: unknown, fallback: string) {
  if (error instanceof BlockchainEvidenceError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_:.-]{3,120}$/.test(error.name)) return error.name;
  return fallback;
}

async function audit(
  service: SupabaseClient,
  input: {
    documentId: string;
    evidenceId: string;
    eventType: string;
    result?: string;
    actorId?: string | null;
    documentHash?: string | null;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
  }
) {
  const result = await service.rpc('append_legal_evidence_event', {
    p_document_id: input.documentId,
    p_event_type: input.eventType,
    p_event_category: input.eventType.includes('VERIFICATION') ? 'VERIFICATION' : 'CERTIFICATION',
    p_event_result: input.result || 'SUCCESS',
    p_actor_id: input.actorId || null,
    p_actor_type: input.actorId ? 'USER' : 'SERVICE',
    p_payload: { evidence_id: input.evidenceId, ...(input.payload || {}) },
    p_document_sha256: input.documentHash || null,
    p_idempotency_key: input.idempotencyKey,
    p_source_system: 'DOCUBOX_BLOCKCHAIN_EVIDENCE',
    p_source_record_id: input.evidenceId,
  });
  if (result.error)
    throw new BlockchainEvidenceError('BLOCKCHAIN_AUDIT_FAILED', result.error.message);
}

async function latestFinalCertification(service: SupabaseClient, documentId: string) {
  const result = await service
    .from('document_certifications')
    .select(
      'id,tenant_id,workspace_id,document_id,document_version_id,certified_pdf_path,certified_pdf_sha256,pades_pdf_hash_after_signature,evidence_chain_sha256,status,execution_status,pades_profile,pdf_signature_status,certificate_status,timestamp_status,verification_status'
    )
    .eq('document_id', documentId)
    .eq('status', 'COMPLETED')
    .eq('execution_status', 'completed')
    .eq('pades_profile', 'PAdES-B-T')
    .eq('pdf_signature_status', 'valid')
    .eq('certificate_status', 'valid')
    .eq('timestamp_status', 'valid')
    .eq('verification_status', 'valid')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data)
    throw new BlockchainEvidenceError(
      'FINAL_CERTIFICATION_NOT_FOUND',
      'No existe un PDF final PAdES-B-T verificable.',
      409
    );
  const row = result.data as Record<string, any>;
  if (
    !row.document_version_id ||
    !row.certified_pdf_path ||
    !row.evidence_chain_sha256 ||
    row.certified_pdf_sha256 !== row.pades_pdf_hash_after_signature
  ) {
    throw new BlockchainEvidenceError(
      'FINAL_CERTIFICATION_INCOMPLETE',
      'La certificación final no contiene todos los hashes inmutables.',
      409
    );
  }
  return row;
}

async function featureEnabledForDocument(service: SupabaseClient, documentId: string) {
  const documentResult = await service
    .from('documentos')
    .select('id,estado')
    .eq('id', documentId)
    .maybeSingle();
  if (documentResult.error || !documentResult.data)
    throw new BlockchainEvidenceError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
  if (documentResult.data.estado !== 'completado')
    throw new BlockchainEvidenceError(
      'DOCUMENT_NOT_FINAL',
      'La evidencia sólo se genera para documentos completados.',
      409
    );
  return true;
}

export async function createBlockchainEvidenceForFinalDocument(
  service: SupabaseClient,
  input: { documentId: string; actorId?: string | null; submitImmediately?: boolean },
  provider: OpenTimestampProvider = createOpenTimestampProvider()
) {
  const config = blockchainEvidenceConfig();
  if (!config.enabled || !(await featureEnabledForDocument(service, input.documentId))) return null;
  const certification = await latestFinalCertification(service, input.documentId);
  const finalPdf = await readDocumentStorageObject({
    service,
    storageBucket: CERTIFICATION_BUCKET,
    storagePath: certification.certified_pdf_path,
    expectedPlaintextSha256: certification.certified_pdf_sha256,
  });
  const documentBytes = new Uint8Array(finalPdf.plaintext);
  const documentHash = hashBytes(documentBytes);
  documentBytes.fill(0);
  if (documentHash !== certification.certified_pdf_sha256)
    throw new BlockchainEvidenceError(
      'FINAL_PDF_HASH_MISMATCH',
      'El PDF final almacenado no coincide con PAdES.',
      409
    );

  const existing = await service
    .from('document_blockchain_evidence')
    .select('*')
    .eq('document_id', input.documentId)
    .eq('document_hash', documentHash)
    .eq('schema_version', '1.0')
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const existingStatus = String(existing.data.status || '').toUpperCase();
    if (
      input.submitImmediately !== false &&
      (!existing.data.proof_storage_path || !existing.data.proof_sha256 || existingStatus === 'GENERATED')
    ) {
      return retryBlockchainEvidenceSubmission(service, existing.data, provider);
    }
    return existing.data;
  }

  const evidenceId = randomUUID();
  const evidenceHash = String(certification.evidence_chain_sha256).toLowerCase();
  const manifest = createBlockchainEvidenceManifest({ documentHash, evidenceHash });
  const root = `${certification.tenant_id}/${input.documentId}/${certification.document_version_id}/blockchain/${evidenceId}`;
  const manifestPath = `${root}/blockchain-evidence-manifest.json`;
  await storeBlockchainArtifact({
    service,
    bytes: Buffer.from(manifest.canonical, 'utf8'),
    tenantId: certification.tenant_id,
    documentId: input.documentId,
    documentVersionId: certification.document_version_id,
    path: manifestPath,
    mimeType: 'application/json',
    userId: input.actorId,
  });

  const inserted = await service
    .from('document_blockchain_evidence')
    .insert({
      id: evidenceId,
      tenant_id: certification.tenant_id,
      workspace_id: certification.workspace_id,
      document_id: input.documentId,
      document_version_id: certification.document_version_id,
      document_certification_id: certification.id,
      document_hash: documentHash,
      evidence_hash: evidenceHash,
      manifest_hash: manifest.manifestHash,
      manifest_storage_path: manifestPath,
      calendars_configured: config.calendars,
      created_by: input.actorId || null,
    })
    .select('*')
    .single();
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      const concurrent = await service
        .from('document_blockchain_evidence')
        .select('*')
        .eq('document_id', input.documentId)
        .eq('document_hash', documentHash)
        .eq('schema_version', '1.0')
        .single();
      if (!concurrent.error) return concurrent.data;
    }
    throw inserted.error || new Error('BLOCKCHAIN_EVIDENCE_INSERT_FAILED');
  }
  await audit(service, {
    documentId: input.documentId,
    evidenceId,
    eventType: 'BLOCKCHAIN_EVIDENCE_GENERATED',
    actorId: input.actorId,
    documentHash,
    idempotencyKey: `blockchain-generated:${evidenceId}`,
    payload: { manifest_hash: manifest.manifestHash, schema_version: '1.0' },
  });

  if (input.submitImmediately === false) return inserted.data;

  try {
    const stampStartedAt = Date.now();
    await audit(service, {
      documentId: input.documentId,
      evidenceId,
      eventType: 'OPENTIMESTAMPS_STAMP_STARTED',
      result: 'PENDING',
      actorId: input.actorId,
      documentHash,
      idempotencyKey: `ots-stamp-started:${evidenceId}:1`,
    });
    const created = await provider.createProof({
      canonicalManifest: manifest.canonical,
      manifestHash: manifest.manifestHash,
      calendars: config.calendars,
    });
    const proofHash = hashBytes(created.proof);
    const proofPath = `${root}/proofs/document-v1.ots`;
    await storeBlockchainArtifact({
      service,
      bytes: created.proof,
      tenantId: certification.tenant_id,
      documentId: input.documentId,
      documentVersionId: certification.document_version_id,
      path: proofPath,
      mimeType: 'application/vnd.opentimestamps.ots',
      userId: input.actorId,
    });
    const now = new Date().toISOString();
    const proofVersion = await service.from('document_blockchain_proof_versions').insert({
      evidence_id: evidenceId,
      version: 1,
      storage_path: proofPath,
      proof_sha256: proofHash,
      size_bytes: created.proof.byteLength,
      source: 'SUBMISSION',
    });
    if (proofVersion.error) throw proofVersion.error;
    const submitted = await service
      .from('document_blockchain_evidence')
      .update({
        proof_storage_path: proofPath,
        proof_sha256: proofHash,
        proof_version: 1,
        status: 'SUBMITTED',
        submitted_at: now,
        calendars_succeeded: created.calendarsSucceeded,
        calendars_failed: created.calendarsFailed,
      })
      .eq('id', evidenceId);
    if (submitted.error) throw submitted.error;
    const inspection = await provider.getProofStatus(created.proof);
    const nextStatus = inspection.bitcoinAttestationFound ? 'ANCHORED' : 'PENDING_BITCOIN';
    const updated = await service
      .from('document_blockchain_evidence')
      .update({
        proof_storage_path: proofPath,
        proof_sha256: proofHash,
        proof_version: 1,
        status: nextStatus,
        submitted_at: now,
        anchored_at: inspection.bitcoinAttestationFound ? now : null,
        bitcoin_block_height: inspection.bitcoinBlockHeight,
        verification_status: 'PENDING',
        calendars_succeeded: created.calendarsSucceeded,
        calendars_failed: created.calendarsFailed,
        next_upgrade_attempt_at: new Date(
          Date.now() + Math.max(retryDelayMs(0), config.upgradeIntervalMs)
        ).toISOString(),
      })
      .eq('id', evidenceId)
      .select('*')
      .single();
    for (const calendar of config.calendars) {
      await service.from('document_blockchain_calendar_attempts').insert({
        evidence_id: evidenceId,
        calendar_origin: new URL(calendar).origin,
        operation: 'SUBMIT',
        result: created.calendarsFailed.includes(calendar) ? 'FAILED' : 'SUCCESS',
        duration_ms: Date.now() - stampStartedAt,
      });
    }
    await audit(service, {
      documentId: input.documentId,
      evidenceId,
      eventType: 'OPENTIMESTAMPS_SUBMITTED',
      actorId: input.actorId,
      documentHash,
      idempotencyKey: `ots-submitted:${evidenceId}:1`,
      payload: {
        proof_sha256: proofHash,
        proof_version: 1,
        calendars_succeeded: created.calendarsSucceeded.length,
      },
    });
    await audit(service, {
      documentId: input.documentId,
      evidenceId,
      eventType: inspection.bitcoinAttestationFound
        ? 'BITCOIN_ANCHOR_FOUND'
        : 'OPENTIMESTAMPS_PENDING',
      result: inspection.bitcoinAttestationFound ? 'SUCCESS' : 'PENDING',
      documentHash,
      idempotencyKey: `ots-status:${evidenceId}:1`,
      payload: { bitcoin_block_height: inspection.bitcoinBlockHeight },
    });
    if (updated.error) throw updated.error;
    return updated.data;
  } catch (error) {
    const code = safeErrorCode(error, 'OPENTIMESTAMPS_SUBMISSION_FAILED');
    await service
      .from('document_blockchain_evidence')
      .update({
        status: 'SUBMISSION_FAILED',
        verification_status: 'PENDING',
        verification_error_code: code,
        last_error_message: error instanceof Error ? error.message.slice(0, 1000) : code,
        next_upgrade_attempt_at: new Date(
          Date.now() + Math.max(retryDelayMs(0), config.upgradeIntervalMs)
        ).toISOString(),
      })
      .eq('id', evidenceId);
    await audit(service, {
      documentId: input.documentId,
      evidenceId,
      eventType: 'OPENTIMESTAMPS_STAMP_FAILED',
      result: 'FAILED',
      documentHash,
      idempotencyKey: `ots-submission-failed:${evidenceId}:1`,
      payload: { error_code: code, stage: 'SUBMISSION' },
    });
    return (
      await service.from('document_blockchain_evidence').select('*').eq('id', evidenceId).single()
    ).data;
  }
}

export async function retryBlockchainEvidenceSubmission(
  service: SupabaseClient,
  row: Record<string, any>,
  provider: OpenTimestampProvider = createOpenTimestampProvider()
) {
  const config = blockchainEvidenceConfig();
  if (row.proof_storage_path) return row;
  const manifestBytes = await readBlockchainArtifact(service, row.manifest_storage_path);
  if (hashBytes(manifestBytes) !== row.manifest_hash)
    throw new BlockchainEvidenceError(
      'BLOCKCHAIN_MANIFEST_CORRUPT',
      'El manifiesto almacenado no coincide con su SHA-256.'
    );
  const canonicalManifest = Buffer.from(manifestBytes).toString('utf8');
  const stampStartedAt = Date.now();
  await audit(service, {
    documentId: row.document_id,
    evidenceId: row.id,
    eventType: 'OPENTIMESTAMPS_STAMP_STARTED',
    result: 'PENDING',
    documentHash: row.document_hash,
    idempotencyKey: `ots-stamp-started:${row.id}:retry:${Number(row.upgrade_attempts || 0) + 1}`,
  });
  const created = await provider.createProof({
    canonicalManifest,
    manifestHash: row.manifest_hash,
    calendars: config.calendars,
  });
  for (const calendar of config.calendars) {
    await service.from('document_blockchain_calendar_attempts').insert({
      evidence_id: row.id,
      calendar_origin: new URL(calendar).origin,
      operation: 'SUBMIT',
      result: created.calendarsFailed.includes(calendar) ? 'FAILED' : 'SUCCESS',
      duration_ms: Date.now() - stampStartedAt,
    });
  }
  const proofHash = hashBytes(created.proof);
  const proofPath = row.manifest_storage_path.replace(
    'blockchain-evidence-manifest.json',
    'proofs/document-v1.ots'
  );
  await storeBlockchainArtifact({
    service,
    bytes: created.proof,
    tenantId: row.tenant_id,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    path: proofPath,
    mimeType: 'application/vnd.opentimestamps.ots',
  });
  const history = await service.from('document_blockchain_proof_versions').insert({
    evidence_id: row.id,
    version: 1,
    storage_path: proofPath,
    proof_sha256: proofHash,
    size_bytes: created.proof.byteLength,
    source: 'SUBMISSION',
  });
  if (history.error && history.error.code !== '23505') throw history.error;
  const submitted = await service
    .from('document_blockchain_evidence')
    .update({
      proof_storage_path: proofPath,
      proof_sha256: proofHash,
      proof_version: 1,
      status: 'SUBMITTED',
      submitted_at: row.submitted_at || new Date().toISOString(),
      calendars_succeeded: created.calendarsSucceeded,
      calendars_failed: created.calendarsFailed,
    })
    .eq('id', row.id);
  if (submitted.error) throw submitted.error;
  const inspection = await provider.getProofStatus(created.proof);
  const status = inspection.bitcoinAttestationFound ? 'ANCHORED' : 'PENDING_BITCOIN';
  const now = new Date().toISOString();
  const updated = await service
    .from('document_blockchain_evidence')
    .update({
      proof_storage_path: proofPath,
      proof_sha256: proofHash,
      proof_version: 1,
      status,
      submitted_at: row.submitted_at || now,
      anchored_at: inspection.bitcoinAttestationFound ? now : null,
      bitcoin_block_height: inspection.bitcoinBlockHeight,
      verification_status: 'PENDING',
      calendars_succeeded: created.calendarsSucceeded,
      calendars_failed: created.calendarsFailed,
      verification_error_code: null,
      last_error_message: null,
      claimed_at: null,
      claimed_by: null,
      next_upgrade_attempt_at: new Date(
        Date.now() +
          Math.max(retryDelayMs(Number(row.upgrade_attempts || 0)), config.upgradeIntervalMs)
      ).toISOString(),
    })
    .eq('id', row.id)
    .select('*')
    .single();
  if (updated.error) throw updated.error;
  await audit(service, {
    documentId: row.document_id,
    evidenceId: row.id,
    eventType: 'OPENTIMESTAMPS_SUBMITTED',
    documentHash: row.document_hash,
    idempotencyKey: `ots-submitted:${row.id}:retry:${proofHash}`,
    payload: { proof_sha256: proofHash, retry: true },
  });
  return updated.data;
}

export async function processBlockchainEvidenceQueue(
  service: SupabaseClient,
  input: { workerId: string; limit?: number; operation?: 'STAMP' | 'UPGRADE' | 'ALL' },
  provider: OpenTimestampProvider = createOpenTimestampProvider()
) {
  const config = blockchainEvidenceConfig();
  if (!config.enabled) return { claimed: 0, verified: 0, pending: 0, failed: 0 };
  const claims = await service.rpc('claim_blockchain_evidence_jobs', {
    p_worker: input.workerId,
    p_limit: input.limit || 20,
    p_operation: input.operation || 'ALL',
  });
  if (claims.error) throw claims.error;
  let verified = 0,
    pending = 0,
    failed = 0;
  for (const row of (claims.data || []) as Record<string, any>[]) {
    const attempt = Number(row.upgrade_attempts || 0) + 1;
    const hadProof = Boolean(row.proof_storage_path && row.proof_sha256);
    try {
      if (!row.proof_storage_path || !row.proof_sha256) {
        await retryBlockchainEvidenceSubmission(service, row, provider);
        pending += 1;
        continue;
      }
      await audit(service, {
        documentId: row.document_id,
        evidenceId: row.id,
        eventType: 'OPENTIMESTAMPS_UPGRADE_STARTED',
        result: 'PENDING',
        documentHash: row.document_hash,
        idempotencyKey: `ots-upgrade-started:${row.id}:${attempt}`,
      });
      const upgradeStartedAt = Date.now();
      const original = await readBlockchainArtifact(
        service,
        row.proof_storage_path,
        row.proof_sha256
      );
      if (hashBytes(original) !== row.proof_sha256)
        throw new BlockchainEvidenceError(
          'OPENTIMESTAMPS_PROOF_CORRUPT',
          'La prueba no coincide con su SHA-256.'
        );
      const upgraded = await provider.upgradeProof({
        proof: original,
        calendars: config.calendars,
      });
      for (const calendar of config.calendars) {
        await service.from('document_blockchain_calendar_attempts').insert({
          evidence_id: row.id,
          calendar_origin: new URL(calendar).origin,
          operation: 'UPGRADE',
          result: 'SUCCESS',
          duration_ms: Date.now() - upgradeStartedAt,
        });
      }
      const proof = upgraded.proof;
      const proofHash = hashBytes(proof);
      let version = Number(row.proof_version || 1);
      let proofPath = row.proof_storage_path;
      if (upgraded.changed || proofHash !== row.proof_sha256) {
        version += 1;
        proofPath = row.proof_storage_path.replace(
          /document-v\d+\.ots$/,
          `document-v${version}.ots`
        );
        await storeBlockchainArtifact({
          service,
          bytes: proof,
          tenantId: row.tenant_id,
          documentId: row.document_id,
          documentVersionId: row.document_version_id,
          path: proofPath,
          mimeType: 'application/vnd.opentimestamps.ots',
        });
        const history = await service.from('document_blockchain_proof_versions').insert({
          evidence_id: row.id,
          version,
          storage_path: proofPath,
          proof_sha256: proofHash,
          size_bytes: proof.byteLength,
          source: 'UPGRADE',
        });
        if (history.error) throw history.error;
        await audit(service, {
          documentId: row.document_id,
          evidenceId: row.id,
          eventType: 'OPENTIMESTAMPS_UPGRADED',
          documentHash: row.document_hash,
          idempotencyKey: `ots-upgraded:${row.id}:${version}`,
          payload: { proof_version: version, proof_sha256: proofHash },
        });
      }
      const inspection = await provider.getProofStatus(proof);
      let status = inspection.bitcoinAttestationFound ? 'ANCHORED' : 'PENDING_BITCOIN';
      let verificationStatus = 'PENDING';
      let blockHash: string | null = null;
      let attestedAt = inspection.bitcoinAttestedAt;
      if (inspection.bitcoinAttestationFound) {
        await audit(service, {
          documentId: row.document_id,
          evidenceId: row.id,
          eventType: 'OPENTIMESTAMPS_VERIFY_STARTED',
          result: 'PENDING',
          documentHash: row.document_hash,
          idempotencyKey: `ots-verify-started:${row.id}:${proofHash}`,
        });
        const result = await provider.verifyProof({ proof, manifestHash: row.manifest_hash });
        if (!result.manifestHashMatches)
          throw new BlockchainEvidenceError(
            'OPENTIMESTAMPS_MANIFEST_MISMATCH',
            'La prueba no corresponde al manifiesto.'
          );
        if (result.bitcoinVerified) {
          status = 'VERIFIED';
          verificationStatus = 'VALID';
          attestedAt = result.bitcoinAttestedAt;
          if (
            config.bitcoinVerificationMode === 'LOCAL_NODE' &&
            inspection.bitcoinBlockHeight !== null
          ) {
            const block = await resolveBitcoinBlock(inspection.bitcoinBlockHeight);
            blockHash = block.hash;
            attestedAt = block.attestedAt;
          }
        }
      }
      const now = new Date().toISOString();
      const update = await service
        .from('document_blockchain_evidence')
        .update({
          proof_storage_path: proofPath,
          proof_sha256: proofHash,
          proof_version: version,
          status,
          verification_status: verificationStatus,
          bitcoin_block_height: inspection.bitcoinBlockHeight,
          bitcoin_block_hash: blockHash,
          bitcoin_attested_at: attestedAt,
          anchored_at: inspection.bitcoinAttestationFound ? row.anchored_at || now : null,
          verified_at: status === 'VERIFIED' ? now : null,
          last_upgrade_attempt_at: now,
          upgrade_attempts: attempt,
          next_upgrade_attempt_at:
            status === 'VERIFIED'
              ? null
              : new Date(
                  Date.now() + Math.max(retryDelayMs(attempt), config.upgradeIntervalMs)
                ).toISOString(),
          verification_error_code: null,
          last_error_message: null,
          claimed_at: null,
          claimed_by: null,
        })
        .eq('id', row.id);
      if (update.error) throw update.error;
      if (status === 'VERIFIED') {
        verified += 1;
        await audit(service, {
          documentId: row.document_id,
          evidenceId: row.id,
          eventType: 'BLOCKCHAIN_EVIDENCE_VERIFIED',
          documentHash: row.document_hash,
          idempotencyKey: `ots-verified:${row.id}:${proofHash}`,
          payload: {
            proof_sha256: proofHash,
            bitcoin_block_height: inspection.bitcoinBlockHeight,
            bitcoin_block_hash: blockHash,
          },
        });
        if (!row.certificate_storage_path && inspection.bitcoinBlockHeight !== null) {
          try {
            const appUrl =
              process.env.NEXT_PUBLIC_APP_URL ||
              (process.env.VERCEL_PROJECT_PRODUCTION_URL
                ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
                : 'http://localhost:4028');
            const certificate = await createBitcoinAnchorCertificate({
              publicToken: row.public_token,
              documentHash: row.document_hash,
              manifestHash: row.manifest_hash,
              proofHash,
              blockHeight: inspection.bitcoinBlockHeight,
              blockHash,
              attestedAt,
              verifiedAt: now,
              verificationUrl: `${appUrl}/verify/blockchain/${row.public_token}`,
            });
            const certificateHash = hashBytes(certificate);
            const certificatePath = row.manifest_storage_path.replace(
              'blockchain-evidence-manifest.json',
              `certificate-${certificateHash}.pdf`
            );
            await storeBlockchainArtifact({
              service,
              bytes: certificate,
              tenantId: row.tenant_id,
              documentId: row.document_id,
              documentVersionId: row.document_version_id,
              path: certificatePath,
              mimeType: 'application/pdf',
              kind: 'constancia',
            });
            const certificateUpdate = await service
              .from('document_blockchain_evidence')
              .update({
                certificate_storage_path: certificatePath,
                certificate_sha256: certificateHash,
                certificate_generated_at: now,
              })
              .eq('id', row.id);
            if (certificateUpdate.error) throw certificateUpdate.error;
            await audit(service, {
              documentId: row.document_id,
              evidenceId: row.id,
              eventType: 'BLOCKCHAIN_CERTIFICATE_GENERATED',
              documentHash: row.document_hash,
              idempotencyKey: `blockchain-certificate:${row.id}:${certificateHash}`,
              payload: { certificate_sha256: certificateHash },
            });
          } catch (certificateError) {
            const certificateErrorCode = safeErrorCode(
              certificateError,
              'BLOCKCHAIN_CERTIFICATE_GENERATION_FAILED'
            );
            await service
              .from('document_blockchain_evidence')
              .update({
                verification_error_code: certificateErrorCode,
                last_error_message:
                  certificateError instanceof Error
                    ? certificateError.message.slice(0, 1000)
                    : certificateErrorCode,
              })
              .eq('id', row.id);
            await audit(service, {
              documentId: row.document_id,
              evidenceId: row.id,
              eventType: 'BLOCKCHAIN_CERTIFICATE_GENERATION_FAILED',
              result: 'FAILED',
              documentHash: row.document_hash,
              idempotencyKey: `blockchain-certificate-failed:${row.id}:${proofHash}`,
              payload: { error_code: certificateErrorCode },
            });
          }
        }
      } else pending += 1;
    } catch (error) {
      failed += 1;
      const code = safeErrorCode(error, 'OPENTIMESTAMPS_UPGRADE_FAILED');
      const invalid = code.includes('CORRUPT') || code.includes('MISMATCH');
      await service
        .from('document_blockchain_evidence')
        .update({
          status: invalid ? 'INVALID_PROOF' : hadProof ? 'UPGRADE_FAILED' : 'SUBMISSION_FAILED',
          verification_status: invalid ? 'INVALID' : 'PENDING',
          verification_error_code: code,
          last_error_message: error instanceof Error ? error.message.slice(0, 1000) : code,
          last_upgrade_attempt_at: new Date().toISOString(),
          upgrade_attempts: attempt,
          next_upgrade_attempt_at: invalid
            ? null
            : new Date(
                Date.now() + Math.max(retryDelayMs(attempt), config.upgradeIntervalMs)
              ).toISOString(),
          claimed_at: null,
          claimed_by: null,
        })
        .eq('id', row.id);
      await audit(service, {
        documentId: row.document_id,
        evidenceId: row.id,
        eventType: hadProof
          ? 'BLOCKCHAIN_EVIDENCE_VERIFICATION_FAILED'
          : 'OPENTIMESTAMPS_STAMP_FAILED',
        result: 'FAILED',
        documentHash: row.document_hash,
        idempotencyKey: `ots-upgrade-failed:${row.id}:${attempt}`,
        payload: { error_code: code, attempt },
      });
    }
  }
  return { claimed: (claims.data || []).length, verified, pending, failed };
}

export function processGeneratedBlockchainEvidence(
  service: SupabaseClient,
  input: { workerId: string; limit?: number },
  provider: OpenTimestampProvider = createOpenTimestampProvider()
) {
  return processBlockchainEvidenceQueue(service, { ...input, operation: 'STAMP' }, provider);
}

export function processPendingBlockchainEvidence(
  service: SupabaseClient,
  input: { workerId: string; limit?: number },
  provider: OpenTimestampProvider = createOpenTimestampProvider()
) {
  return processBlockchainEvidenceQueue(service, { ...input, operation: 'UPGRADE' }, provider);
}

export async function verifyBlockchainEvidenceArtifacts(
  service: SupabaseClient,
  row: Record<string, any>,
  documentBytes?: Uint8Array,
  provider: OpenTimestampProvider = createOpenTimestampProvider()
) {
  const presentedDocumentHash = documentBytes ? hashBytes(documentBytes) : null;
  if (presentedDocumentHash !== null && presentedDocumentHash !== row.document_hash) {
    return {
      document_hash_matches: false,
      manifest_hash_matches: null,
      proof_integrity: null,
      bitcoin_attestation_found: null,
      bitcoin_verified: null,
      status: 'VERIFICATION_FAILED',
    };
  }
  const [manifestBytes, proof] = await Promise.all([
    readBlockchainArtifact(service, row.manifest_storage_path),
    readBlockchainArtifact(service, row.proof_storage_path, row.proof_sha256),
  ]);
  const canonicalManifest = Buffer.from(manifestBytes).toString('utf8');
  const manifestHash = hashBytes(manifestBytes);
  const parsed = JSON.parse(canonicalManifest) as Record<string, unknown>;
  const canonical = createBlockchainEvidenceManifest({
    documentHash: String(parsed.document_hash || ''),
    evidenceHash: String(parsed.evidence_hash || ''),
  });
  const manifestHashMatches =
    canonical.canonical === canonicalManifest &&
    canonical.manifestHash === manifestHash &&
    manifestHash === row.manifest_hash;
  const proofIntegrity = hashBytes(proof) === row.proof_sha256;
  const proofResult =
    proofIntegrity && manifestHashMatches
      ? await provider.verifyProof({ proof, manifestHash })
      : null;
  return {
    document_hash_matches:
      presentedDocumentHash === null ? null : presentedDocumentHash === row.document_hash,
    manifest_hash_matches: manifestHashMatches,
    proof_integrity: proofIntegrity && Boolean(proofResult?.proofIntegrity),
    bitcoin_attestation_found: Boolean(proofResult?.bitcoinAttestationFound),
    bitcoin_verified: Boolean(proofResult?.bitcoinVerified),
    status:
      presentedDocumentHash !== null && presentedDocumentHash !== row.document_hash
        ? 'VERIFICATION_FAILED'
        : proofResult?.bitcoinVerified
          ? 'VERIFIED'
          : row.status,
  };
}
