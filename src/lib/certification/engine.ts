import { constants, createPublicKey, randomUUID, verify, X509Certificate } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalSha256, canonicalizeRFC8785, sha256Hex } from './canonical';
import {
  EVIDENCE_SCHEMA_VERSION,
  FOUNDATION_CAPABILITIES,
  SOURCE_HASH_ALGORITHM,
  DEVELOPMENT_PROVIDER_CAPABILITIES,
  PADES_BB_CAPABILITIES,
  PADES_BT_CAPABILITIES,
} from './capabilities';
import {
  downloadCurrentDocumentBytes,
  resolveAndFreezeCertificationSource,
  verifyFrozenCertificationSource,
} from './foundation';
import {
  claimCertificationLease,
  finalizeCertificationExecution,
  recordCertificationCheckpoint,
  type CertificationExecutionContext,
} from './execution';
import { abbreviateBase64, appendCertificatePages, applyCryptographicPlacements, generateIntegrityCertificatePdf } from './pdf';
import { createCertificationProviderSet, type CertificationProviderSet } from './providers';
import { createStoredZip } from './zip';
import { CertificationError, CertificationStatus, CertificationSummary, EvidenceItem } from './types';
import type { CertificationArtifactKind } from './types';
import { requireCertificationManagerAccess } from './access';
import { assertProductionCertificationEnabled, getCryptoProviderMode } from './provider-mode';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
  type DocumentArtifactKind,
} from '@/lib/crypto/document-encryption';

type DocumentRow = {
  id: string;
  documento_id: string;
  nombre: string;
  estado: string;
  owner_id: string;
  workspace_id: string | null;
  file_url: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  file_hash_sha256: string | null;
  sealed_pdf_path: string | null;
  sealed_pdf_hash: string | null;
  created_at: string;
  fecha_completado: string | null;
  updated_at: string;
  participantes: Array<Record<string, unknown>> | null;
  campos_solicitados: Array<Record<string, unknown>> | null;
  sello_digital: boolean | null;
};

type CertificationRow = Record<string, any> & {
  id: string;
  certification_uuid: string;
  verification_uuid: string;
  tenant_id: string;
  document_id: string;
  document_folio: string;
  status: CertificationStatus;
  execution_status: 'created' | 'queued' | 'processing' | 'retrying' | 'manual_review' | 'completed' | 'failed';
  execution_attempt?: number | null;
  execution_trace_id?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  last_checkpoint?: string | null;
  __executionContext?: CertificationExecutionContext;
  __activeCheckpoint?: CertificationStatus;
  document_version_id: string | null;
  document_version: number;
  created_at: string;
  completed_at: string | null;
};

const ARTIFACT_BUCKET = 'certification-artifacts';
const ZERO_HASH = '0'.repeat(64);

type LegalEvidenceRow = {
  event_uuid: string;
  sequence_number: number;
  event_type: string;
  event_result: string;
  event_hash: string;
  previous_event_hash: string | null;
  chain_material: string;
  occurred_at: string;
};

function executionEnvironment() {
  const value = String(
    process.env.DOCUBOX_EXECUTION_ENVIRONMENT
    || process.env.VERCEL_ENV
    || process.env.NODE_ENV
    || 'UNKNOWN',
  ).toUpperCase();
  if (value === 'PRODUCTION') return 'PRODUCTION';
  if (value === 'PREVIEW' || value === 'STAGING') return 'STAGING';
  if (value === 'DEVELOPMENT') return 'DEVELOPMENT';
  return 'UNKNOWN';
}

function inspectLegalEvidenceChain(rows: LegalEvidenceRow[]) {
  let previousHash: string | null = null;
  let valid = rows.length > 0;
  const normalized = rows.map((row, index) => {
    const eventHash = String(row.event_hash || '').toLowerCase();
    const storedPrevious = row.previous_event_hash ? String(row.previous_event_hash).toLowerCase() : null;
    const calculatedHash = sha256Hex(row.chain_material || '');
    if (
      Number(row.sequence_number) !== index + 1
      || storedPrevious !== previousHash
      || !/^[a-f0-9]{64}$/.test(eventHash)
      || calculatedHash !== eventHash
    ) valid = false;
    previousHash = eventHash;
    return {
      event_uuid: row.event_uuid,
      sequence: Number(row.sequence_number),
      event_type: row.event_type,
      result: row.event_result,
      event_hash: eventHash,
      previous_event_hash: storedPrevious,
      occurred_at: row.occurred_at,
    };
  });
  return {
    valid,
    normalized,
    genesisHash: rows[0]?.previous_event_hash?.toLowerCase() || ZERO_HASH,
    finalHash: previousHash || ZERO_HASH,
    merkleRoot: normalized.length
      ? sha256Hex(canonicalizeRFC8785(normalized.map((row) => row.event_hash).sort()))
      : null,
  };
}

function upper(value: string) {
  return value.toUpperCase();
}

function displayChain(schema: string, values: Record<string, string | number | null>) {
  const lines = [`||${schema}|1.0|`];
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) lines.push(`${key}=${String(value).normalize('NFC')}|`);
  }
  lines.push('||');
  return lines.join('\n');
}

async function transition(
  supabase: SupabaseClient,
  certification: CertificationRow,
  toStatus: CertificationStatus,
  actorId: string,
  metadata: Record<string, unknown> = {},
) {
  const fromStatus = certification.status;
  const context = certification.__executionContext;
  if (certification.__activeCheckpoint) {
    await recordCertificationCheckpoint(
      supabase,
      certification,
      context,
      certification.__activeCheckpoint,
      'completed',
      { next_checkpoint: toStatus },
    );
  }
  const update: Record<string, unknown> = { status: toStatus, execution_status: 'processing' };
  if (certification.execution_status === 'created' || certification.execution_status === 'queued' || certification.execution_status === 'retrying') {
    update.started_at = new Date().toISOString();
  }
  let query = supabase.from('document_certifications').update(update).eq('id', certification.id);
  if (context) query = query.eq('lease_owner', context.leaseOwner).gt('lease_expires_at', new Date().toISOString());
  const { error } = await query;
  if (error) throw new CertificationError('CERTIFICATION_STATE_WRITE_FAILED', error.message, 500);
  await supabase.from('certification_state_transitions').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: actorId,
    result: 'SUCCESS',
    metadata: { ...metadata, attempt: context?.attempt || null, trace_id: context?.traceId || null },
  });
  await recordCertificationCheckpoint(supabase, certification, context, toStatus, 'started', metadata);
  certification.status = toStatus;
  certification.execution_status = 'processing';
  certification.__activeCheckpoint = toStatus;
}

async function markFailed(supabase: SupabaseClient, certification: CertificationRow, actorId: string, error: unknown): Promise<never> {
  const failure = error instanceof CertificationError
    ? error
    : new CertificationError('CERTIFICATION_FAILED', error instanceof Error ? error.message : 'La certificacion fallo.', 500);
  const fromStatus = certification.status;
  const context = certification.__executionContext;
  if (certification.__activeCheckpoint) {
    await recordCertificationCheckpoint(supabase, certification, context, certification.__activeCheckpoint, 'failed', {
      error_code: failure.code,
      error_message: failure.message,
    });
  }
  const requiresManualReview = failure.httpStatus >= 400 && failure.httpStatus < 500;
  let failedQuery = supabase.from('document_certifications').update({
    status: 'FAILED',
    execution_status: requiresManualReview ? 'manual_review' : 'failed',
    failed_at: new Date().toISOString(),
    failure_detail: failure.message,
    error_code: failure.code,
    error_message: failure.message,
  }).eq('id', certification.id);
  if (context) failedQuery = failedQuery.eq('lease_owner', context.leaseOwner).gt('lease_expires_at', new Date().toISOString());
  const failedWrite = await failedQuery;
  if (failedWrite.error) throw new CertificationError('CERTIFICATION_FAILURE_WRITE_FAILED', failedWrite.error.message, 500);
  await supabase.from('certification_state_transitions').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    from_status: fromStatus,
    to_status: 'FAILED',
    actor_id: actorId,
    result: 'FAILED',
    error_code: failure.code,
    metadata: { attempt: context?.attempt || null, trace_id: context?.traceId || null },
  });
  await finalizeCertificationExecution(
    supabase,
    certification,
    context,
    requiresManualReview ? 'manual_review' : 'failed',
    { error_code: failure.code, error_message: failure.message },
  );
  certification.status = 'FAILED';
  throw failure;
}

async function uploadArtifact(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string,
  encryptionContext?: {
    tenantId: string;
    documentId: string;
    documentVersionId: string;
    artifactKind: DocumentArtifactKind;
    actorId: string;
  }
) {
  if (encryptionContext && documentEncryptionPolicy().enabled) {
    await encryptAndUploadDocumentObject({
      service: supabase,
      plaintext: bytes,
      ...encryptionContext,
      storageBucket: ARTIFACT_BUCKET,
      storagePath: path,
      originalFileName: path.split('/').at(-1) || null,
      originalMimeType: contentType,
      userId: encryptionContext.actorId,
    });
    return path;
  }
  const { error } = await supabase.storage.from(ARTIFACT_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
    cacheControl: 'private, max-age=0',
  });
  if (error) {
    const existing = await supabase.storage.from(ARTIFACT_BUCKET).download(path);
    if (!existing.error && existing.data) {
      const existingBytes = Buffer.from(await existing.data.arrayBuffer());
      if (existingBytes.equals(Buffer.from(bytes))) return path;
      throw new CertificationError('ARTIFACT_STORAGE_CONFLICT', `El artefacto inmutable ${path} ya existe con contenido diferente.`, 409);
    }
    throw new CertificationError('ARTIFACT_STORAGE_FAILED', error.message, 500);
  }
  return path;
}

async function downloadArtifactBytes(
  supabase: SupabaseClient,
  path: string,
  userId?: string | null,
  expectedSha256?: string | null
) {
  if (documentEncryptionPolicy().enabled) {
    const decrypted = await readDocumentStorageObject({
      service: supabase,
      storageBucket: ARTIFACT_BUCKET,
      storagePath: path,
      expectedPlaintextSha256: expectedSha256,
      userId,
      accessEvent: userId ? 'DOCUMENT_DOWNLOADED' : 'DOCUMENT_DECRYPTED',
    });
    return new Uint8Array(decrypted.plaintext);
  }
  const downloaded = await supabase.storage.from(ARTIFACT_BUCKET).download(path);
  if (downloaded.error || !downloaded.data) {
    throw new CertificationError(
      'CERTIFICATION_ARTIFACT_READ_FAILED',
      downloaded.error?.message || 'No se pudo descargar el archivo.',
      500
    );
  }
  return new Uint8Array(await downloaded.data.arrayBuffer());
}

function mapSummary(row: CertificationRow, timestamp?: Record<string, any> | null): CertificationSummary {
  const kms = row.provider_metadata?.kms || {};
  const certificate = row.provider_metadata?.certificate || {};
  return {
    certificationUuid: row.certification_uuid,
    verificationUuid: row.verification_uuid,
    documentId: row.document_id,
    documentFolio: row.document_folio,
    status: row.status,
    executionStatus: row.execution_status || (row.status === 'COMPLETED' ? 'completed' : row.status === 'FAILED' ? 'failed' : 'processing'),
    documentVersionId: row.document_version_id || null,
    documentVersionNumber: Number(row.document_version || 1),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    documentBodySha256: row.document_body_sha256 || null,
    certifiedPdfSha256: row.certified_pdf_sha256 || null,
    certificationRootSha256: row.certification_root_sha256 || null,
    timestampStatus: row.timestamp_status || (timestamp?.status === 'VALID' ? 'valid' : 'not_configured'),
    timestampGenTime: timestamp?.gen_time || null,
    timestampProvider: timestamp?.tsa_name || null,
    timestampProviderRole: timestamp?.tsa_provider_role || null,
    timestampPolicyOid: timestamp?.tsa_policy_oid || null,
    timestampSerialNumber: timestamp?.tsa_serial_number || null,
    timestampCertificateFingerprintSha256: timestamp?.tsa_certificate_fingerprint_sha256 || null,
    timestampTrustBundleId: timestamp?.trust_bundle_id || null,
    timestampTrustRootFingerprintSha256: timestamp?.tsa_root_fingerprint_sha256 || null,
    timestampFallbackUsed: timestamp?.fallback_used === true,
    integrityStatus: row.integrity_status || 'pending',
    pdfSignatureStatus: row.pdf_signature_status || 'not_configured',
    certificateStatus: row.certificate_status || 'not_configured',
    verificationStatus: row.verification_status || 'pending',
    nom151Status: row.nom151_status || 'not_configured',
    padesProfile: row.pades_profile || null,
    padesSignatureAlgorithm: row.pades_signature_algorithm || null,
    padesDigestAlgorithm: row.pades_digest_algorithm || null,
    padesCertificateSerial: row.pades_certificate_serial || null,
    padesCertificateFingerprintSha256: row.pades_certificate_fingerprint_sha256 || null,
    padesSigningTimeDeclared: row.pades_signing_time_declared || null,
    padesVerifiedAt: row.pades_verified_at || null,
    cryptoEnvironment: row.provider_metadata?.environment || null,
    kmsProvider: kms.provider || null,
    kmsProtectionLevel: kms.protection_level || null,
    kmsKeyVersion: kms.document_key_version || null,
    certificatePublicKeyFingerprintSha256: certificate.public_key_fingerprint_sha256 || null,
    evidenceSchemaVersion: row.evidence_schema_version || EVIDENCE_SCHEMA_VERSION,
    sourceDocumentHash: row.source_document_hash || row.document_body_sha256 || null,
    sourceDocumentSizeBytes: row.source_document_size_bytes === null || row.source_document_size_bytes === undefined
      ? null
      : Number(row.source_document_size_bytes),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
  };
}

async function getTimestamp(supabase: SupabaseClient, certificationId: string) {
  const { data } = await supabase.from('timestamp_records').select('*').eq('document_certification_id', certificationId).maybeSingle();
  return data;
}

export async function getCertificationSummary(supabase: SupabaseClient, documentId: string, userId: string) {
  await requireCertificationManagerAccess(supabase, documentId, userId);
  const { data, error } = await supabase.from('document_certifications').select('*').eq('document_id', documentId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw new CertificationError('CERTIFICATION_READ_FAILED', error.message, 500);
  }
  if (!data) return null;
  return mapSummary(data as CertificationRow, await getTimestamp(supabase, data.id));
}

export async function createCertification(
  supabase: SupabaseClient,
  documentId: string,
  userId: string,
  idempotencyKey: string,
  requestedVersionId?: string | null,
  options: {
    providers?: CertificationProviderSet;
    leaseOwner?: string;
  } = {},
) {
  const providers = options.providers || createCertificationProviderSet();
  assertProductionCertificationEnabled();
  if (providers.mode === 'production' && !providers.productionEnabled) {
    throw new CertificationError('PRODUCTION_CERTIFICATION_DISABLED', 'La certificacion de produccion esta deshabilitada hasta completar la activacion controlada.', 503);
  }
  if (providers.mode === 'production') {
    const providerHealth = await providers.healthCheck();
    if (!providerHealth.ready) {
      throw new CertificationError('PRODUCTION_PROVIDER_CHAIN_NOT_READY', 'La cadena criptografica de produccion no esta lista para certificar.', 503);
    }
  }
  const { data: documentData, error: documentError } = await supabase
    .from('documentos')
    .select('id,documento_id,nombre,estado,owner_id,workspace_id,file_url,storage_path,file_name,file_type,file_size,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash,created_at,fecha_completado,updated_at,participantes,campos_solicitados,sello_digital')
    .eq('id', documentId)
    .maybeSingle();
  const document = documentData as DocumentRow | null;
  if (documentError || !document || document.owner_id !== userId) throw new CertificationError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
  if (document.estado !== 'completado') throw new CertificationError('DOCUMENT_NOT_COMPLETED', 'Solo pueden certificarse documentos completados.', 422);

  const tenantId = document.workspace_id || document.owner_id;
  const source = await resolveAndFreezeCertificationSource({
    supabase,
    document,
    actorUserId: userId,
    requestedVersionId,
  });
  const { data: idempotentCertification } = await supabase
    .from('document_certifications')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('document_version_id', source.versionId)
    .eq('certification_type', 'integrity_evidence')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (idempotentCertification?.status === 'COMPLETED') {
    return mapSummary(
      idempotentCertification as CertificationRow,
      await getTimestamp(supabase, idempotentCertification.id),
    );
  }
  const { data: existing } = await supabase
    .from('document_certifications')
    .select('*')
    .eq('document_version_id', source.versionId)
    .eq('certification_type', 'integrity_evidence')
    .maybeSingle();
  if (existing?.status === 'COMPLETED') return mapSummary(existing as CertificationRow, await getTimestamp(supabase, existing.id));

  let certification: CertificationRow;
  if (existing) {
    certification = existing as CertificationRow;
    if (certification.status === 'FAILED') {
      const { error } = await supabase.from('document_certifications').update({
        status: 'PENDING', error_code: null, error_message: null,
        execution_status: 'retrying', failed_at: null, failure_detail: null,
        execution_environment: executionEnvironment(),
      }).eq('id', certification.id);
      if (error) throw new CertificationError('CERTIFICATION_RETRY_FAILED', error.message, 500);
      certification.status = 'PENDING';
    }
  } else {
    const { data, error } = await supabase.from('document_certifications').insert({
      tenant_id: tenantId,
      workspace_id: document.workspace_id,
      document_id: document.id,
      document_uuid: document.id,
      document_folio: document.documento_id,
      document_version_id: source.versionId,
      document_version: source.versionNumber,
      certification_type: 'integrity_evidence',
      idempotency_key: idempotencyKey,
      status: 'PENDING',
      execution_status: 'created',
      source_document_hash: source.sha256,
      source_document_hash_algorithm: SOURCE_HASH_ALGORITHM,
      source_document_size_bytes: source.sizeBytes,
      source_storage_bucket: source.storageBucket,
      source_storage_path: source.storagePath,
      integrity_status: 'pending',
      pdf_signature_status: 'not_configured',
      certificate_status: 'not_configured',
      timestamp_status: 'not_configured',
      verification_status: 'pending',
      evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
      created_by: userId,
      schema_version: '1.0',
      execution_environment: executionEnvironment(),
    }).select('*').single();
    if (error?.code === '23505') {
      const raced = await supabase
        .from('document_certifications')
        .select('*')
        .eq('document_version_id', source.versionId)
        .eq('certification_type', 'integrity_evidence')
        .maybeSingle();
      if (raced.error || !raced.data) {
        throw new CertificationError('CERTIFICATION_CONCURRENT_CREATE_FAILED', raced.error?.message || 'No se pudo recuperar la certificacion concurrente.', 409);
      }
      certification = raced.data as CertificationRow;
    } else if (error || !data) {
      if (error?.code === '42P01' || error?.code === 'PGRST205') {
        throw new CertificationError('CERTIFICATION_SCHEMA_MISSING', 'Falta aplicar la migracion del motor de certificacion.', 503);
      }
      throw new CertificationError('CERTIFICATION_CREATE_FAILED', error?.message || 'No se pudo iniciar la certificacion.', 500);
    } else {
      certification = data as CertificationRow;
    }
  }

  await supabase.from('certification_state_transitions').insert({
    tenant_id: tenantId, certification_id: certification.id, from_status: null, to_status: 'PENDING', actor_id: userId, result: 'PENDING', metadata: {},
  });

  if (options.leaseOwner) {
    const context = await claimCertificationLease(supabase, certification, options.leaseOwner);
    if (!context) return mapSummary(certification, await getTimestamp(supabase, certification.id));
    certification.__executionContext = context;
    certification.execution_attempt = context.attempt;
    certification.execution_trace_id = context.traceId;
    certification.lease_owner = context.leaseOwner;
  }

  try {
    await transition(supabase, certification, 'FREEZING_DOCUMENT', userId);
    const documentBytes = source.bytes;
    const documentPdf = await PDFDocument.load(documentBytes);
    const pageCount = documentPdf.getPageCount();
    const completedAt = new Date(document.fecha_completado || document.updated_at).toISOString();
    const certificationStartedAt = new Date().toISOString();

    await transition(supabase, certification, 'HASHING_DOCUMENT', userId);
    const documentBodySha256 = sha256Hex(documentBytes);
    if (documentBodySha256 !== source.sha256) {
      throw new CertificationError('DOCUMENT_VERSION_HASH_MISMATCH', 'La version cambio despues de congelarse.', 409);
    }

    const [{ data: auditRows, error: auditError }, { data: signatureRows }, { data: nom151 }] = await Promise.all([
      supabase.from('legal_evidence_events').select('event_uuid,sequence_number,event_type,event_result,event_hash,previous_event_hash,chain_material,occurred_at').eq('document_id', document.id).order('sequence_number', { ascending: true }),
      supabase.from('signature_evidence').select('*').eq('document_id', document.id).eq('is_voided', false).order('captured_at', { ascending: true }),
      supabase.from('nom151_constancias_doc').select('id,constancia_sha256,constancia_size_bytes,constancia_path,created_at').eq('documento_id', document.id).eq('status', 'issued').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (auditError) throw new CertificationError('LEGAL_EVIDENCE_READ_FAILED', auditError.message, 503);
    const auditInspection = inspectLegalEvidenceChain((auditRows || []) as LegalEvidenceRow[]);
    if (!auditInspection.valid) {
      throw new CertificationError(
        'LEGAL_EVIDENCE_CHAIN_INVALID',
        'La bitacora legal esta vacia, incompleta o no supera la validacion de integridad.',
        422,
      );
    }
    const normalizedAudits = auditInspection.normalized;
    const auditLogGenesisHash = auditInspection.genesisHash;
    const auditLogFinalHash = auditInspection.finalHash;
    const auditMerkleRoot = auditInspection.merkleRoot;

    const evidenceItems: EvidenceItem[] = [{
      evidence_uuid: document.id,
      evidence_type: 'DOCUMENT',
      file_sha256: documentBodySha256,
      metadata_sha256: sha256Hex(canonicalizeRFC8785({
        mime_type: 'application/pdf',
        page_count: pageCount,
        version: source.versionNumber,
        document_version_id: source.versionId,
      })),
      mime_type: 'application/pdf',
      size_bytes: documentBytes.byteLength,
      storage_object_version: null,
      generated_at: completedAt,
    }];
    for (const row of signatureRows || []) {
      const metadata = { evidence_type: row.evidence_type, captured_at: row.captured_at };
      const metadataHash = sha256Hex(canonicalizeRFC8785(metadata));
      evidenceItems.push({
        evidence_uuid: row.id,
        evidence_type: row.evidence_type === 'autograph_signature' ? 'AUTOGRAPHIC_SIGNATURE' : 'OTHER',
        file_sha256: String(row.file_hash || row.signature_hash || row.evidence_hash || metadataHash).toLowerCase(),
        metadata_sha256: metadataHash,
        mime_type: row.mime_type || 'application/octet-stream',
        size_bytes: Number(row.size_bytes || 0),
        storage_object_version: row.storage_path || null,
        generated_at: new Date(row.captured_at || completedAt).toISOString(),
      });
    }
    if (nom151?.constancia_sha256 && /^[a-f0-9]{64}$/i.test(nom151.constancia_sha256)) {
      evidenceItems.push({
        evidence_uuid: nom151.id,
        evidence_type: 'NOM151_CONSTANCIA',
        file_sha256: nom151.constancia_sha256.toLowerCase(),
        metadata_sha256: sha256Hex(canonicalizeRFC8785({ provider: 'PSC', standard: 'NOM-151-SCFI-2016' })),
        mime_type: 'application/octet-stream',
        size_bytes: Number(nom151.constancia_size_bytes || 0),
        storage_object_version: nom151.constancia_path || null,
        generated_at: new Date(nom151.created_at).toISOString(),
      });
    }
    evidenceItems.sort((a, b) => a.evidence_uuid.localeCompare(b.evidence_uuid));

    const foundationEvidencePayload = {
      schema: EVIDENCE_SCHEMA_VERSION,
      document_id: document.id,
      document_version_id: source.versionId,
      document_version_number: source.versionNumber,
      document_sha256: documentBodySha256,
      legal_events: normalizedAudits,
      signature_evidence: (signatureRows || []).map((row) => ({
        id: row.id,
        type: row.evidence_type,
        hash: row.file_hash || row.signature_hash || row.evidence_hash || null,
        captured_at: row.captured_at || null,
      })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      nom151_constancia_sha256: nom151?.constancia_sha256 || null,
    };
    const foundationEvidence = canonicalSha256(foundationEvidencePayload);
    const providerStatus = await providers.healthCheck();

    if (!providerStatus.ready) {
      await verifyFrozenCertificationSource(supabase, source);
      const completedAtNow = new Date().toISOString();
      let foundationFinalizeQuery = supabase.from('document_certifications').update({
        status: 'COMPLETED',
        execution_status: 'completed',
        document_body_sha256: documentBodySha256,
        evidence_chain_canonical_json: foundationEvidencePayload,
        evidence_chain_sha256: foundationEvidence.sha256,
        evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
        integrity_status: FOUNDATION_CAPABILITIES.integrityStatus,
        pdf_signature_status: FOUNDATION_CAPABILITIES.pdfSignatureStatus,
        certificate_status: FOUNDATION_CAPABILITIES.certificateStatus,
        timestamp_status: FOUNDATION_CAPABILITIES.timestampStatus,
        verification_status: FOUNDATION_CAPABILITIES.verificationStatus,
        provider_metadata: {
          mode: 'foundation_only',
          environment: getCryptoProviderMode() === 'production' ? 'production' : 'development',
          runtime_environment: executionEnvironment(),
          missing_capabilities: providerStatus.missing,
          source_snapshot: {
            bucket: source.storageBucket,
            path: source.storagePath,
            sha256: source.sha256,
          },
        },
        validator_version: 'docubox-certification-foundation/1.0',
        completed_at: completedAtNow,
        error_code: null,
        error_message: null,
        failure_detail: null,
      }).eq('id', certification.id);
      if (certification.__executionContext) {
        foundationFinalizeQuery = foundationFinalizeQuery
          .eq('lease_owner', certification.__executionContext.leaseOwner)
          .gt('lease_expires_at', new Date().toISOString());
      }
      const { error: foundationError } = await foundationFinalizeQuery;
      if (foundationError) {
        throw new CertificationError('CERTIFICATION_FOUNDATION_FINALIZE_FAILED', foundationError.message, 500);
      }
      await supabase.from('certification_state_transitions').insert({
        tenant_id: tenantId,
        certification_id: certification.id,
        from_status: certification.status,
        to_status: 'COMPLETED',
        actor_id: userId,
        result: 'SUCCESS',
        metadata: {
          mode: 'foundation_only',
          document_version_id: source.versionId,
          source_document_hash: source.sha256,
        },
      });
      certification = {
        ...certification,
        status: 'COMPLETED',
        execution_status: 'completed',
        document_body_sha256: documentBodySha256,
        evidence_chain_sha256: foundationEvidence.sha256,
        integrity_status: FOUNDATION_CAPABILITIES.integrityStatus,
        pdf_signature_status: FOUNDATION_CAPABILITIES.pdfSignatureStatus,
        certificate_status: FOUNDATION_CAPABILITIES.certificateStatus,
        timestamp_status: FOUNDATION_CAPABILITIES.timestampStatus,
        verification_status: FOUNDATION_CAPABILITIES.verificationStatus,
        evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
        completed_at: completedAtNow,
      };
      if (certification.__activeCheckpoint) {
        await recordCertificationCheckpoint(supabase, certification, certification.__executionContext, certification.__activeCheckpoint, 'completed');
      }
      await recordCertificationCheckpoint(supabase, certification, certification.__executionContext, 'COMPLETED', 'completed', { mode: 'foundation_only' });
      await finalizeCertificationExecution(supabase, certification, certification.__executionContext, 'completed', { mode: 'foundation_only' });
      return mapSummary(certification, null);
    }

    // A visual certificate is never sufficient evidence. Do not continue when
    // the configured X.509 material is expired, untrusted, or bound to a key
    // other than the KeyManagementProvider key that will sign this record.
    const certificateVerification = await providers.certificate.verifyCertificateChain();
    if (certificateVerification.status !== 'valid' && certificateVerification.status !== 'expiring_soon') {
      throw new CertificationError(
        `CERTIFICATE_${certificateVerification.status.toUpperCase()}`,
        'El certificado institucional no supera la validacion requerida para certificar el documento.',
        503,
      );
    }
    const signingCertificate = certificateVerification.certificate;
    if (!signingCertificate) {
      throw new CertificationError('SIGNING_CERTIFICATE_NOT_CONFIGURED', 'No existe un certificado institucional disponible.', 503);
    }
    if (!certificateVerification.keyId || !certificateVerification.keyMatches || !certificateVerification.chainValid) {
      throw new CertificationError('CERTIFICATE_KEY_MISMATCH', 'El certificado institucional no esta vinculado a la llave KMS activa.', 503);
    }
    const signingKeyMetadata = await providers.keyManagement.getKeyMetadata(certificateVerification.keyId);
    const keyPublicPem = signingKeyMetadata.publicKeyPem || await providers.keyManagement.getPublicKey(signingKeyMetadata.keyId);
    const keyPublicKeyFingerprintSha256 = sha256Hex(createPublicKey(keyPublicPem).export({ type: 'spki', format: 'der' }));
    const certificatePublicKeyFingerprintSha256 = sha256Hex(
      new X509Certificate(signingCertificate.pem).publicKey.export({ type: 'spki', format: 'der' })
    );
    if (keyPublicKeyFingerprintSha256 !== certificatePublicKeyFingerprintSha256) {
      throw new CertificationError('CERTIFICATE_KEY_MISMATCH', 'La huella SPKI del certificado no coincide con la llave KMS activa.', 503);
    }
    const kmsResource = 'resourceName' in providers.keyManagement
      ? String((providers.keyManagement as { resourceName?: unknown }).resourceName || '') || null
      : null;

    const evidenceManifestUuid = randomUUID();
    const certificationUuid = certification.certification_uuid;
    const documentSealUuid = randomUUID();
    const verificationUrl = `${(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4028').replace(/\/$/, '')}/verificar-certificacion/${certification.verification_uuid}`;

    await transition(supabase, certification, 'BUILDING_DOCUMENT_CHAIN', userId);
    const documentPayload = {
      schema: 'DOCUBOX_DOCUMENT', schema_version: '1.0', certification_uuid: certificationUuid,
      document_seal_uuid: documentSealUuid,
      document_uuid: document.id, document_folio: document.documento_id, tenant_id: tenantId,
      workspace_id: document.workspace_id, document_type: 'DOCUMENTO_FIRMADO', document_version: source.versionNumber,
      document_status: 'COMPLETED', workflow_type: 'MIXED', created_at: new Date(document.created_at).toISOString(),
      completed_at: completedAt, certification_started_at: certificationStartedAt,
      document_body_sha256: documentBodySha256, document_size_bytes: documentBytes.byteLength,
      page_count: pageCount, mime_type: 'application/pdf', audit_log_final_hash: auditLogFinalHash,
      evidence_manifest_uuid: evidenceManifestUuid, verification_url: verificationUrl,
      canonicalization_algorithm: 'JCS-RFC8785', digest_algorithm: 'SHA-256',
      signature_algorithm: signingKeyMetadata.algorithm, signing_key_id: signingKeyMetadata.keyId, signing_key_version: signingKeyMetadata.keyVersion,
    };
    const documentChain = canonicalSha256(documentPayload);
    const documentChainDisplay = displayChain('DOCUBOX_DOCUMENT', {
      CERTIFICATION_UUID: certificationUuid, DOCUMENT_SEAL_UUID: documentSealUuid,
      DOCUMENT_UUID: document.id, DOCUMENT_FOLIO: document.documento_id,
      TENANT_ID: tenantId, WORKSPACE_ID: document.workspace_id, DOCUMENT_TYPE: 'DOCUMENTO_FIRMADO',
      DOCUMENT_VERSION: source.versionNumber, DOCUMENT_STATUS: 'COMPLETED', WORKFLOW_TYPE: 'MIXED',
      CREATED_AT: new Date(document.created_at).toISOString(), COMPLETED_AT: completedAt,
      DOCUMENT_BODY_SHA256: upper(documentBodySha256), AUDIT_LOG_FINAL_HASH: upper(auditLogFinalHash),
      DOCUMENT_SIZE_BYTES: documentBytes.byteLength, PAGE_COUNT: pageCount,
      EVIDENCE_MANIFEST_UUID: evidenceManifestUuid, VERIFICATION_URL: verificationUrl,
      CANONICALIZATION: 'JCS-RFC8785', DIGEST_ALGORITHM: 'SHA-256', SIGNATURE_ALGORITHM: signingKeyMetadata.algorithm,
      SIGNING_KEY_VERSION: documentPayload.signing_key_version,
    });

    await transition(supabase, certification, 'SIGNING_DOCUMENT_CHAIN', userId);
    const documentSeal = await providers.keyManagement.signDigest({
      purpose: 'DOCUMENT_SEAL',
      digestSha256: documentChain.sha256,
      canonicalBytes: Buffer.from(documentChain.canonical, 'utf8'),
    });

    await transition(supabase, certification, 'BUILDING_EVIDENCE_MANIFEST', userId);
    const workflowDefinitionSha256 = sha256Hex(canonicalizeRFC8785((document.participantes || []).map((participant) => ({
      id: participant.id || participant.participante_id || null,
      role: participant.rolDocumento || participant.acto || null,
      order: participant.orden ?? null,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)))));
    const manifestPayload = {
      schema: 'DOCUBOX_EVIDENCE_MANIFEST', schema_version: '1.0', evidence_manifest_uuid: evidenceManifestUuid,
      certification_uuid: certificationUuid, document_uuid: document.id, tenant_id: tenantId,
      document_body_sha256: documentBodySha256, document_chain_sha256: documentChain.sha256,
      document_seal_sha256: documentSeal.signatureSha256, audit_log_genesis_hash: auditLogGenesisHash,
      audit_log_final_hash: auditLogFinalHash, audit_merkle_root: auditMerkleRoot,
      workflow_definition_sha256: workflowDefinitionSha256, form_data_sha256: null,
      evidence_items: evidenceItems, evidence_count: evidenceItems.length,
      attachment_count: evidenceItems.filter((item) => item.evidence_type === 'ATTACHMENT').length,
      audit_event_count: normalizedAudits.length, generated_at: certificationStartedAt,
      canonicalization_algorithm: 'JCS-RFC8785', digest_algorithm: 'SHA-256',
    };
    const manifest = canonicalSha256(manifestPayload);
    const { data: manifestRow, error: manifestError } = await supabase.from('evidence_manifests').insert({
      evidence_manifest_uuid: evidenceManifestUuid, tenant_id: tenantId, document_id: document.id,
      canonical_manifest_json: manifestPayload, manifest_sha256: manifest.sha256,
      evidence_count: evidenceItems.length, attachment_count: manifestPayload.attachment_count,
      audit_event_count: normalizedAudits.length, sealed_at: certificationStartedAt,
    }).select('id').single();
    if (manifestError || !manifestRow) throw new CertificationError('EVIDENCE_MANIFEST_WRITE_FAILED', manifestError?.message || 'No se pudo registrar el manifiesto.', 500);
    const { error: itemError } = await supabase.from('evidence_manifest_items').insert(evidenceItems.map((item) => ({
      tenant_id: tenantId, evidence_manifest_id: manifestRow.id, ...item,
    })));
    if (itemError) throw new CertificationError('EVIDENCE_ITEMS_WRITE_FAILED', itemError.message, 500);

    await transition(supabase, certification, 'BUILDING_EVIDENCE_CHAIN', userId);
    const evidenceChainUuid = randomUUID();
    const evidencePayload = {
      schema: 'DOCUBOX_EVIDENCE', schema_version: '1.0', evidence_chain_uuid: evidenceChainUuid,
      evidence_manifest_uuid: evidenceManifestUuid, certification_uuid: certificationUuid,
      document_uuid: document.id, tenant_id: tenantId, document_body_sha256: documentBodySha256,
      document_chain_sha256: documentChain.sha256, document_seal_sha256: documentSeal.signatureSha256,
      evidence_manifest_sha256: manifest.sha256, audit_log_genesis_hash: auditLogGenesisHash,
      audit_log_final_hash: auditLogFinalHash, audit_merkle_root: auditMerkleRoot,
      evidence_count: evidenceItems.length, attachment_count: manifestPayload.attachment_count,
      audit_event_count: normalizedAudits.length, generated_at: certificationStartedAt,
      sealed_at: certificationStartedAt, canonicalization_algorithm: 'JCS-RFC8785',
      digest_algorithm: 'SHA-256', signature_algorithm: signingKeyMetadata.algorithm, signing_key_version: signingKeyMetadata.keyVersion,
    };
    const evidenceChain = canonicalSha256(evidencePayload);
    const evidenceChainDisplay = displayChain('DOCUBOX_EVIDENCE', {
      EVIDENCE_CHAIN_UUID: evidenceChainUuid, EVIDENCE_MANIFEST_UUID: evidenceManifestUuid,
      CERTIFICATION_UUID: certificationUuid, DOCUMENT_UUID: document.id, TENANT_ID: tenantId,
      DOCUMENT_BODY_SHA256: upper(documentBodySha256), DOCUMENT_CHAIN_SHA256: upper(documentChain.sha256),
      DOCUMENT_SEAL_SHA256: upper(documentSeal.signatureSha256), EVIDENCE_MANIFEST_SHA256: upper(manifest.sha256),
      AUDIT_LOG_GENESIS_HASH: upper(auditLogGenesisHash), AUDIT_LOG_FINAL_HASH: upper(auditLogFinalHash),
      AUDIT_MERKLE_ROOT: auditMerkleRoot ? upper(auditMerkleRoot) : null,
      EVIDENCE_COUNT: evidenceItems.length, ATTACHMENT_COUNT: manifestPayload.attachment_count,
      AUDIT_EVENT_COUNT: normalizedAudits.length, GENERATED_AT: certificationStartedAt, SEALED_AT: certificationStartedAt,
      CANONICALIZATION: 'JCS-RFC8785', DIGEST_ALGORITHM: 'SHA-256', SIGNATURE_ALGORITHM: signingKeyMetadata.algorithm,
      SIGNING_KEY_VERSION: evidencePayload.signing_key_version,
    });

    await transition(supabase, certification, 'SIGNING_EVIDENCE_CHAIN', userId);
    const evidenceSeal = await providers.keyManagement.signDigest({
      purpose: 'EVIDENCE_SEAL',
      digestSha256: evidenceChain.sha256,
      canonicalBytes: Buffer.from(evidenceChain.canonical, 'utf8'),
    });

    const packagePayload = {
      schema: 'DOCUBOX_CERTIFICATION_PACKAGE', schema_version: '1.0', certification_uuid: certificationUuid,
      document_uuid: document.id, tenant_id: tenantId, document_body_sha256: documentBodySha256,
      document_chain_sha256: documentChain.sha256, document_seal_sha256: documentSeal.signatureSha256,
      document_seal_uuid: documentSealUuid, document_signature_algorithm: documentSeal.algorithm,
      document_key_size_bits: documentSeal.keySizeBits, document_signing_key_version: documentSeal.keyVersion,
      document_public_key_fingerprint_sha256: documentSeal.publicKeyFingerprintSha256,
      document_seal_signed_at: documentSeal.signedAt,
      evidence_manifest_sha256: manifest.sha256, evidence_chain_sha256: evidenceChain.sha256,
      evidence_seal_sha256: evidenceSeal.signatureSha256, audit_log_final_hash: auditLogFinalHash,
      generated_at: certificationStartedAt, canonicalization_algorithm: 'JCS-RFC8785', digest_algorithm: 'SHA-256',
    };
    const certificationPackage = canonicalSha256(packagePayload);

    const rootPayload = {
      certification_uuid: certificationUuid, document_chain_sha256: documentChain.sha256,
      document_seal_sha256: documentSeal.signatureSha256, evidence_chain_sha256: evidenceChain.sha256,
      evidence_seal_sha256: evidenceSeal.signatureSha256,
      // WP-05 is intentionally PAdES-B-B. A RFC 3161 token is introduced in
      // WP-06 and must never be represented as present before then.
      timestamp_token_sha256: null,
    };
    const certificationRoot = canonicalSha256(rootPayload);

    const executionAttempt = Math.max(1, Number(certification.execution_attempt || 1));
    const artifactRoot = `${tenantId}/${document.id}/${certificationUuid}/attempt-${executionAttempt}`;
    const storeArtifact = (
      path: string,
      bytes: Uint8Array,
      contentType: string,
      artifactKind: DocumentArtifactKind = 'evidence'
    ) => uploadArtifact(supabase, path, bytes, contentType, {
      tenantId,
      documentId: document.id,
      documentVersionId: source.versionId,
      artifactKind,
      actorId: userId,
    });
    let timestampRow: Record<string, unknown> | null = null;

    for (const [purpose, seal] of [['DOCUMENT_SEAL', documentSeal], ['EVIDENCE_SEAL', evidenceSeal]] as const) {
      const { error: keyEvidenceError } = await supabase.from('cryptographic_keys').upsert({
        key_purpose: purpose, kms_key_id: seal.keyId, kms_key_version: seal.keyVersion,
        algorithm: seal.algorithm, public_key_pem: seal.publicKeyPem,
        public_key_fingerprint_sha256: seal.publicKeyFingerprintSha256,
        certificate_pem: signingCertificate.pem, certificate_fingerprint_sha256: signingCertificate.fingerprintSha256,
        certificate_serial_number: signingCertificate.serialNumber,
        certificate_subject: signingCertificate.subject,
        certificate_issuer: signingCertificate.issuer,
        certificate_not_before: signingCertificate.notBefore,
        certificate_not_after: signingCertificate.notAfter,
        certificate_signature_algorithm: signingCertificate.signatureAlgorithm,
        certificate_public_key_algorithm: signingCertificate.publicKeyAlgorithm,
        certificate_key_usage: signingCertificate.keyUsage,
        certificate_extended_key_usage: signingCertificate.extendedKeyUsage,
        certificate_chain_status: certificateVerification.status,
        certificate_environment: signingCertificate.environment,
        protection_level: signingKeyMetadata.protectionLevel === 'hsm' ? 'hardware' : signingKeyMetadata.protectionLevel,
        provider_metadata: {
          provider: signingKeyMetadata.provider,
          environment: signingCertificate.environment.toLowerCase(),
          kms_key_resource: kmsResource,
          public_key_fingerprint_sha256: keyPublicKeyFingerprintSha256,
          certificate_public_key_fingerprint_sha256: certificatePublicKeyFingerprintSha256,
        },
        status: 'ACTIVE', activated_at: seal.signedAt,
      }, { onConflict: 'kms_key_id,kms_key_version' });
      if (keyEvidenceError) {
        throw new CertificationError('CRYPTOGRAPHIC_KEY_EVIDENCE_WRITE_FAILED', keyEvidenceError.message, 500);
      }
    }

    await transition(supabase, certification, 'RENDERING_CERTIFICATE', userId);
    const certificateBytes = await generateIntegrityCertificatePdf({
      folio: document.documento_id, documentUuid: document.id, certificationUuid, verificationUrl,
      documentType: 'Documento firmado', documentVersion: source.versionNumber, completedAt, certifiedAt: certificationStartedAt,
      pageCount, documentBodySha256, documentChainSha256: documentChain.sha256,
      documentChainDisplay,
      documentSeal: {
        seal_uuid: documentSealUuid,
        status: documentSeal.status,
        document_chain_sha256: documentChain.sha256,
        seal_sha256: documentSeal.signatureSha256,
        signature_algorithm: documentSeal.algorithm,
        key_size_bits: documentSeal.keySizeBits,
        signing_key_version: documentSeal.keyVersion,
        public_key_fingerprint_sha256: documentSeal.publicKeyFingerprintSha256,
        signed_at: documentSeal.signedAt,
        seal_base64: documentSeal.signatureBase64,
        seal_base64_preview: abbreviateBase64(documentSeal.signatureBase64),
        verification_url: verificationUrl,
      },
      evidenceChainSha256: evidenceChain.sha256, evidenceChainDisplay,
      evidenceSealSha256: evidenceSeal.signatureSha256, evidenceSealBase64: evidenceSeal.signatureBase64,
      evidenceKeyVersion: evidenceSeal.keyVersion, certificationRootSha256: certificationRoot.sha256,
    });
    const certificatePath = await storeArtifact(`${artifactRoot}/constancia-integridad-evidencia.pdf`, certificateBytes, 'application/pdf', 'constancia');

    await transition(supabase, certification, 'APPENDING_CERTIFICATE', userId);
    const documentWithVisibleCertification = await applyCryptographicPlacements(
      documentBytes,
      (document.campos_solicitados || []) as any,
      {
        documentUuid: document.id,
        certifiedAt: certificationStartedAt,
        documentChainDisplay,
        documentChainSha256: documentChain.sha256,
        documentSealBase64: documentSeal.signatureBase64,
        documentSealSha256: documentSeal.signatureSha256,
        documentKeyVersion: documentSeal.keyVersion,
        evidenceChainDisplay,
      },
    );
    const appendedPdf = await appendCertificatePages(documentWithVisibleCertification, certificateBytes);
    await transition(supabase, certification, 'SIGNING_FINAL_PDF', userId);
    const preparedPdf = await providers.pdfSignature.preparePdf({
      pdfBytes: appendedPdf,
      reason: 'Certificacion criptografica Docubox',
      signerName: 'Docubox',
      contactInfo: verificationUrl,
    });
    const timestampHealth = await providers.timestampAuthority.healthCheck();
    const requestedPadesProfile = timestampHealth.ready ? 'PAdES-B-T' : 'PAdES-B-B';
    const signedPdf = await providers.pdfSignature.embedSignature({
      prepared: preparedPdf,
      profile: requestedPadesProfile,
      tenantId,
      idempotencyKey: certification.idempotency_key,
    });
    const padesVerification = await providers.pdfSignature.verifyPdf({
      pdfBytes: signedPdf.pdfBytes,
      expectedCertificateFingerprintSha256: signedPdf.certificateFingerprintSha256,
    });
    if (!padesVerification.valid) {
      throw new CertificationError('PADES_VERIFICATION_FAILED', padesVerification.detail || 'La firma PAdES no supero la verificacion criptografica.', 502);
    }
    const independentPadesVerification = await providers.independentVerification.verifyPdf({
      pdfBytes: signedPdf.pdfBytes,
      expectedCertificateFingerprintSha256: signedPdf.certificateFingerprintSha256,
    });
    if (!independentPadesVerification.valid) {
      throw new CertificationError('INDEPENDENT_PADES_VERIFICATION_FAILED', independentPadesVerification.detail || 'La verificacion independiente PAdES no supero la comprobacion criptografica.', 502);
    }
    if (requestedPadesProfile === 'PAdES-B-T' && (!signedPdf.timestamp || !padesVerification.timestamp?.valid)) {
      throw new CertificationError('PADES_TIMESTAMP_VERIFICATION_FAILED', 'La firma PAdES-B-T no contiene una estampa RFC 3161 verificable.', 502);
    }
    const certifiedPdf = signedPdf.pdfBytes;
    const certifiedPdfSha256 = signedPdf.pdfHashAfterSignature;
    const certifiedPdfPath = await storeArtifact(`${artifactRoot}/documento-certificado-pades.pdf`, certifiedPdf, 'application/pdf', 'certified_pdf');
    if (signedPdf.timestamp) {
      const timestamp = signedPdf.timestamp;
      const requestPath = await storeArtifact(`${artifactRoot}/timestamp/request.tsq`, timestamp.request, 'application/timestamp-query');
      const responsePath = await storeArtifact(`${artifactRoot}/timestamp/response.tsr`, timestamp.response, 'application/timestamp-reply');
      const tokenPath = await storeArtifact(`${artifactRoot}/timestamp/token.tst`, timestamp.token, 'application/timestamp-token');
      const { data: storedTimestamp, error: timestampError } = await supabase.from('timestamp_records').upsert({
        tenant_id: tenantId,
        document_certification_id: certification.id,
        standard: 'RFC3161', status: 'VALID',
        message_imprint_algorithm: timestamp.messageImprintAlgorithm,
        message_imprint_sha256: timestamp.messageImprintSha256,
        timestamp_request_sha256: timestamp.requestSha256,
        timestamp_response_sha256: timestamp.responseSha256,
        timestamp_token_sha256: timestamp.tokenSha256,
        gen_time: timestamp.genTime,
        tsa_name: timestamp.provider,
        tsa_policy_oid: timestamp.policyOid,
        tsa_serial_number: timestamp.serialNumber,
        tsa_nonce: timestamp.nonce,
        tsa_certificate_serial_number: timestamp.tsaCertificateSerialNumber,
        tsa_certificate_fingerprint_sha256: timestamp.tsaCertificateFingerprintSha256,
        tsa_issuer: timestamp.tsaIssuer,
        tsa_provider_role: timestamp.providerRole || null,
        tsa_endpoint_id: timestamp.endpointId || null,
        tsa_certificate_subject: timestamp.tsaCertificateSubject,
        tsa_root_fingerprint_sha256: timestamp.trustRootFingerprintSha256 || null,
        tsa_chain_fingerprints_sha256: timestamp.trustChainFingerprintsSha256 || [],
        trust_bundle_id: timestamp.trustBundleId || null,
        fallback_used: timestamp.fallbackUsed === true,
        fallback_reason: timestamp.fallbackReason || null,
        primary_failure_code: timestamp.primaryFailureCode || null,
        primary_failure_class: timestamp.primaryFailureClass || null,
        request_storage_path: requestPath,
        response_storage_path: responsePath,
        token_storage_path: tokenPath,
        verified_at: new Date().toISOString(),
      }, { onConflict: 'document_certification_id' }).select().single();
      if (timestampError || !storedTimestamp) {
        throw new CertificationError('RFC3161_EVIDENCE_WRITE_FAILED', timestampError?.message || 'No se pudo guardar la evidencia RFC 3161.', 500);
      }
      if (timestamp.fallbackUsed) {
        const failoverTransition = await supabase.from('certification_state_transitions').insert({
          tenant_id: tenantId,
          certification_id: certification.id,
          from_status: 'REQUESTING_TIMESTAMP',
          to_status: 'VALIDATING_TIMESTAMP',
          actor_id: userId,
          result: 'SUCCESS',
          error_code: timestamp.primaryFailureCode || timestamp.fallbackReason || 'TSA_PRIMARY_UNAVAILABLE',
          metadata: {
            event_type: timestamp.primaryFailureClass === 'SECURITY_VALIDATION_FAILURE'
              ? 'TSA_PRIMARY_SECURITY_VALIDATION_FAILURE'
              : 'TSA_PRIMARY_TEMPORARY_FAILURE',
            primary_provider: 'freetsa',
            selected_provider: timestamp.provider,
            selected_provider_role: timestamp.providerRole || 'FALLBACK',
            trust_bundle_id: timestamp.trustBundleId || null,
            fallback_used: true,
          },
          occurred_at: new Date().toISOString(),
        });
        if (failoverTransition.error) {
          console.error('[certification] TSA failover transition could not be persisted', {
            code: 'TSA_FAILOVER_AUDIT_WRITE_FAILED',
            certificationId: certification.id,
          });
        }
      }
      timestampRow = storedTimestamp;
    }
    const { error: padesEvidenceError } = await supabase.from('document_pdf_signatures').upsert({
      tenant_id: tenantId,
      document_id: document.id,
      document_certification_id: certification.id,
      timestamp_record_id: timestampRow?.id || null,
      pades_profile: signedPdf.profile,
      status: 'VALID',
      signature_algorithm: signedPdf.signatureAlgorithm,
      digest_algorithm: signedPdf.digestAlgorithm,
      certificate_serial: signedPdf.certificateSerialNumber,
      certificate_fingerprint_sha256: signedPdf.certificateFingerprintSha256,
      byte_range: signedPdf.byteRange,
      cms_sha256: signedPdf.cmsHashSha256,
      pdf_hash_after_signature: signedPdf.pdfHashAfterSignature,
      signing_time_declared: signedPdf.signingTimeDeclared,
      verification_result: { primary: padesVerification, independent: independentPadesVerification },
      verified_at: new Date().toISOString(),
    }, { onConflict: 'document_certification_id' });
    if (padesEvidenceError) {
      throw new CertificationError('PADES_EVIDENCE_WRITE_FAILED', padesEvidenceError.message, 500);
    }

    const report = {
      verification_uuid: certification.verification_uuid, overall_status: 'VALID',
      document: { body_hash_match: true, certified_pdf_hash_match: true },
      document_chain: {
        hash_match: true,
        seal_hash_match: true,
        seal_valid: documentSeal.status === 'VALID',
        seal_status: documentSeal.status,
        seal_uuid: documentSealUuid,
        seal_sha256: documentSeal.signatureSha256,
        signature_algorithm: documentSeal.algorithm,
        key_size_bits: documentSeal.keySizeBits,
        key_version: documentSeal.keyVersion,
        public_key_fingerprint_sha256: documentSeal.publicKeyFingerprintSha256,
        signed_at: documentSeal.signedAt,
      },
      evidence_chain: { manifest_hash_match: true, chain_hash_match: true, seal_valid: true, audit_chain_valid: true, key_version: evidenceSeal.keyVersion },
      pdf_signature: {
        profile: signedPdf.profile,
        status: 'VALID',
        byte_range: signedPdf.byteRange,
        byte_range_valid: padesVerification.byteRangeValid,
        cms_valid: padesVerification.cmsValid,
        certificate_valid: padesVerification.certificateValid,
        independently_verified: independentPadesVerification.valid,
        independent_verifier: independentPadesVerification.verifier,
        signature_algorithm: signedPdf.signatureAlgorithm,
        digest_algorithm: signedPdf.digestAlgorithm,
        certificate_serial_number: signedPdf.certificateSerialNumber,
        certificate_fingerprint_sha256: signedPdf.certificateFingerprintSha256,
        cms_sha256: signedPdf.cmsHashSha256,
        pdf_hash_after_signature: signedPdf.pdfHashAfterSignature,
        signing_time_declared: signedPdf.signingTimeDeclared,
        key_id: signedPdf.keyId,
        key_version: signedPdf.keyVersion,
      },
      timestamp: signedPdf.timestamp ? {
        standard: 'RFC3161', status: 'VALID', provider: signedPdf.timestamp.provider,
        policy_oid: signedPdf.timestamp.policyOid, serial_number: signedPdf.timestamp.serialNumber,
        gen_time: signedPdf.timestamp.genTime, nonce: signedPdf.timestamp.nonce,
        message_imprint_sha256: signedPdf.timestamp.messageImprintSha256,
        token_sha256: signedPdf.timestamp.tokenSha256,
        tsa_certificate_fingerprint_sha256: signedPdf.timestamp.tsaCertificateFingerprintSha256,
      } : { standard: 'RFC3161', status: 'NOT_CONFIGURED' },
      certification_root_sha256: certificationRoot.sha256,
    };
    const publicVerificationArtifacts = [
      { name: 'document-chain.json', data: Buffer.from(documentChain.canonical, 'utf8'), contentType: 'application/json' },
      { name: 'document-chain.txt', data: Buffer.from(documentChainDisplay, 'utf8'), contentType: 'text/plain' },
      { name: 'document-chain.sha256', data: Buffer.from(documentChain.sha256, 'ascii'), contentType: 'text/plain' },
      { name: 'document-seal.sig', data: Buffer.from(documentSeal.signatureBase64, 'base64'), contentType: 'application/octet-stream' },
      { name: 'document-seal.base64.txt', data: Buffer.from(documentSeal.signatureBase64, 'ascii'), contentType: 'text/plain' },
      { name: 'document-seal.sha256', data: Buffer.from(documentSeal.signatureSha256, 'ascii'), contentType: 'text/plain' },
      { name: 'public-key.pem', data: Buffer.from(documentSeal.publicKeyPem, 'utf8'), contentType: 'application/octet-stream' },
      { name: 'pdf-signature.cms', data: Buffer.from(signedPdf.cmsBytes), contentType: 'application/octet-stream' },
      { name: 'pdf-signature.cms.sha256', data: Buffer.from(signedPdf.cmsHashSha256, 'ascii'), contentType: 'text/plain' },
      { name: 'pdf-signature-verification.json', data: Buffer.from(JSON.stringify({ primary: padesVerification, independent: independentPadesVerification }, null, 2), 'utf8'), contentType: 'application/json' },
      ...(signedPdf.timestamp ? [
        { name: 'timestamp.tst', data: Buffer.from(signedPdf.timestamp.token), contentType: 'application/timestamp-token' },
        { name: 'timestamp-verification.json', data: Buffer.from(JSON.stringify(signedPdf.timestamp.verification, null, 2), 'utf8'), contentType: 'application/json' },
      ] : []),
      { name: 'verification-result.json', data: Buffer.from(JSON.stringify(report, null, 2), 'utf8'), contentType: 'application/json' },
    ];
    await Promise.all(publicVerificationArtifacts.map((artifact) => storeArtifact(
      `${artifactRoot}/public/${artifact.name}`,
      artifact.data,
      artifact.contentType,
    )));
    await Promise.all([
      storeArtifact(`${artifactRoot}/technical/verification-report.json`, Buffer.from(JSON.stringify(report, null, 2), 'utf8'), 'application/json'),
      storeArtifact(`${artifactRoot}/technical/signing-certificate.pem`, Buffer.from(signingCertificate.pem, 'utf8'), 'application/octet-stream'),
      storeArtifact(`${artifactRoot}/technical/certificate-chain.pem`, Buffer.from(
        (await providers.certificate.getCertificateChain()).map((certificate) => certificate.pem).join('\n'),
        'utf8',
      ), 'application/octet-stream'),
      storeArtifact(`${artifactRoot}/technical/evidence-manifest.json`, Buffer.from(manifest.canonical, 'utf8'), 'application/json'),
    ]);
    const technicalPackage = createStoredZip([
      { name: 'certification-package/certification-report.json', data: JSON.stringify(report, null, 2) },
      { name: 'certification-package/certification-root.json', data: JSON.stringify(rootPayload, null, 2) },
      { name: 'certification-package/document-chain.json', data: documentChain.canonical },
      { name: 'certification-package/document-chain.txt', data: documentChainDisplay },
      { name: 'certification-package/document-chain.sha256', data: documentChain.sha256 },
      { name: 'certification-package/document-seal.sig', data: Buffer.from(documentSeal.signatureBase64, 'base64') },
      { name: 'certification-package/document-seal.base64.txt', data: documentSeal.signatureBase64 },
      { name: 'certification-package/document-seal.sha256', data: documentSeal.signatureSha256 },
      { name: 'certification-package/public-key.pem', data: documentSeal.publicKeyPem },
      { name: 'certification-package/evidence-manifest.json', data: manifest.canonical },
      { name: 'certification-package/evidence-manifest.sha256', data: manifest.sha256 },
      { name: 'certification-package/evidence-chain.json', data: evidenceChain.canonical },
      { name: 'certification-package/evidence-chain.txt', data: evidenceChainDisplay },
      { name: 'certification-package/evidence-chain.sha256', data: evidenceChain.sha256 },
      { name: 'certification-package/evidence-seal.sig', data: Buffer.from(evidenceSeal.signatureBase64, 'base64') },
      { name: 'certification-package/evidence-seal.base64.txt', data: evidenceSeal.signatureBase64 },
      { name: 'certification-package/evidence-seal.sha256', data: evidenceSeal.signatureSha256 },
      { name: 'certification-package/certification-package.json', data: certificationPackage.canonical },
      { name: 'certification-package/certification-package.sha256', data: certificationPackage.sha256 },
      { name: 'certification-package/pdf-signature.cms', data: Buffer.from(signedPdf.cmsBytes) },
      { name: 'certification-package/pdf-signature.cms.sha256', data: signedPdf.cmsHashSha256 },
      { name: 'certification-package/pdf-signature-verification.json', data: JSON.stringify({ primary: padesVerification, independent: independentPadesVerification }, null, 2) },
      ...(signedPdf.timestamp ? [
        { name: 'certification-package/timestamp/request.tsq', data: Buffer.from(signedPdf.timestamp.request) },
        { name: 'certification-package/timestamp/response.tsr', data: Buffer.from(signedPdf.timestamp.response) },
        { name: 'certification-package/timestamp/token.tst', data: Buffer.from(signedPdf.timestamp.token) },
        { name: 'certification-package/timestamp/verification.json', data: JSON.stringify(signedPdf.timestamp.verification, null, 2) },
      ] : []),
      { name: 'certification-package/signing-certificate.pem', data: signingCertificate.pem },
      { name: 'certification-package/verification-result.json', data: JSON.stringify(report, null, 2) },
      { name: 'certification-package/public-keys.json', data: JSON.stringify({ document: documentSeal.publicKeyPem, evidence: evidenceSeal.publicKeyPem }, null, 2) },
    ]);
    const technicalPackagePath = await storeArtifact(`${artifactRoot}/certification-package.zip`, technicalPackage, 'application/zip');

    await verifyFrozenCertificationSource(supabase, source);
    const completedAtNow = new Date().toISOString();
    let completeFinalizeQuery = supabase.from('document_certifications').update({
      status: 'COMPLETED', execution_status: 'completed',
      document_body_sha256: documentBodySha256, certified_pdf_sha256: certifiedPdfSha256,
      document_chain_canonical_json: documentPayload, document_chain_display_text: documentChainDisplay,
      document_chain_sha256: documentChain.sha256, document_seal_base64: documentSeal.signatureBase64,
      document_seal_sha256: documentSeal.signatureSha256, document_signing_key_id: documentSeal.keyId,
      document_signing_key_version: documentSeal.keyVersion,
      document_public_key_fingerprint_sha256: documentSeal.publicKeyFingerprintSha256,
      evidence_manifest_id: manifestRow.id, evidence_manifest_sha256: manifest.sha256,
      evidence_chain_canonical_json: evidencePayload, evidence_chain_display_text: evidenceChainDisplay,
      evidence_chain_sha256: evidenceChain.sha256, evidence_seal_base64: evidenceSeal.signatureBase64,
      evidence_seal_sha256: evidenceSeal.signatureSha256, evidence_signing_key_id: evidenceSeal.keyId,
      evidence_signing_key_version: evidenceSeal.keyVersion,
      evidence_public_key_fingerprint_sha256: evidenceSeal.publicKeyFingerprintSha256,
      certification_package_canonical_json: packagePayload, certification_package_sha256: certificationPackage.sha256,
      certification_root_sha256: certificationRoot.sha256, audit_log_genesis_hash: auditLogGenesisHash,
      audit_log_final_hash: auditLogFinalHash, audit_merkle_root: auditMerkleRoot,
      audit_event_count: normalizedAudits.length,
      provider_metadata: {
        artifact_root: artifactRoot,
        execution_attempt: executionAttempt,
        environment: signingCertificate.environment.toLowerCase(),
        kms: {
          provider: signingKeyMetadata.provider === 'google-cloud-kms' ? 'gcp' : signingKeyMetadata.provider,
          implementation: signingKeyMetadata.provider,
          protection_level: signingKeyMetadata.protectionLevel,
          key_resource: kmsResource,
          document_key_id: documentSeal.keyId,
          document_key_version: documentSeal.keyVersion,
          evidence_key_id: evidenceSeal.keyId,
          evidence_key_version: evidenceSeal.keyVersion,
          public_key_fingerprint_sha256: keyPublicKeyFingerprintSha256,
        },
        certificate: {
          environment: signingCertificate.environment.toLowerCase(),
          fingerprint_sha256: signingCertificate.fingerprintSha256,
          public_key_fingerprint_sha256: certificatePublicKeyFingerprintSha256,
          key_matches: true,
          chain_status: certificateVerification.status,
        },
        tsa: signedPdf.timestamp ? {
          status: 'valid', standard: 'RFC3161', provider: signedPdf.timestamp.provider,
          policy_oid: signedPdf.timestamp.policyOid, serial_number: signedPdf.timestamp.serialNumber,
          gen_time: signedPdf.timestamp.genTime, token_sha256: signedPdf.timestamp.tokenSha256,
          certificate_fingerprint_sha256: signedPdf.timestamp.tsaCertificateFingerprintSha256,
        } : { status: 'not_configured', standard: 'RFC3161' },
        pades: {
          profile: signedPdf.profile,
          verified: padesVerification.valid,
          byte_range: signedPdf.byteRange,
          cms_sha256: signedPdf.cmsHashSha256,
          signature_algorithm: signedPdf.signatureAlgorithm,
          digest_algorithm: signedPdf.digestAlgorithm,
          certificate_serial_number: signedPdf.certificateSerialNumber,
          certificate_fingerprint_sha256: signedPdf.certificateFingerprintSha256,
          signing_time_declared: signedPdf.signingTimeDeclared,
          pdf_hash_after_signature: signedPdf.pdfHashAfterSignature,
          key_id: signedPdf.keyId,
          key_version: signedPdf.keyVersion,
          verification_result: { primary: padesVerification, independent: independentPadesVerification },
        },
      },
      pades_profile: signedPdf.profile,
      pades_signature_algorithm: signedPdf.signatureAlgorithm,
      pades_digest_algorithm: signedPdf.digestAlgorithm,
      pades_certificate_serial: signedPdf.certificateSerialNumber,
      pades_certificate_fingerprint_sha256: signedPdf.certificateFingerprintSha256,
      pades_byte_range: signedPdf.byteRange,
      pades_cms_sha256: signedPdf.cmsHashSha256,
      pades_pdf_hash_after_signature: signedPdf.pdfHashAfterSignature,
      pades_signing_time_declared: signedPdf.signingTimeDeclared,
      pades_verification_result: { primary: padesVerification, independent: independentPadesVerification },
      pades_verified_at: completedAtNow,
      integrity_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).integrityStatus,
      pdf_signature_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).pdfSignatureStatus,
      certificate_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).certificateStatus,
      timestamp_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).timestampStatus,
      verification_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).verificationStatus,
      nom151_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).nom151Status,
      evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
      validator_version: 'docubox-certification-engine/1.1',
      certificate_pdf_path: certificatePath, certified_pdf_path: certifiedPdfPath,
      technical_package_path: technicalPackagePath, sealed_at: certificationStartedAt, completed_at: completedAtNow,
      error_code: null, error_message: null,
    }).eq('id', certification.id);
    if (certification.__executionContext) {
      completeFinalizeQuery = completeFinalizeQuery
        .eq('lease_owner', certification.__executionContext.leaseOwner)
        .gt('lease_expires_at', new Date().toISOString());
    }
    const { error: completeError } = await completeFinalizeQuery;
    if (completeError) throw new CertificationError('CERTIFICATION_FINALIZE_FAILED', completeError.message, 500);
    await supabase.from('certification_state_transitions').insert({
      tenant_id: tenantId, certification_id: certification.id, from_status: 'SIGNING_FINAL_PDF',
      to_status: 'COMPLETED', actor_id: userId, result: 'SUCCESS', metadata: { certified_pdf_sha256: certifiedPdfSha256 },
    });
    certification = {
      ...certification,
      status: 'COMPLETED',
      execution_status: 'completed',
      document_body_sha256: documentBodySha256,
      certified_pdf_sha256: certifiedPdfSha256,
      certification_root_sha256: certificationRoot.sha256,
      integrity_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).integrityStatus,
      pdf_signature_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).pdfSignatureStatus,
      certificate_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).certificateStatus,
      timestamp_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).timestampStatus,
      verification_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).verificationStatus,
      nom151_status: (signedPdf.profile === 'PAdES-B-T' ? PADES_BT_CAPABILITIES : PADES_BB_CAPABILITIES).nom151Status,
      evidence_schema_version: EVIDENCE_SCHEMA_VERSION,
      completed_at: completedAtNow,
    };
    if (certification.__activeCheckpoint) {
      await recordCertificationCheckpoint(supabase, certification, certification.__executionContext, certification.__activeCheckpoint, 'completed');
    }
    await recordCertificationCheckpoint(supabase, certification, certification.__executionContext, 'COMPLETED', 'completed', { mode: 'provider' });
    await finalizeCertificationExecution(supabase, certification, certification.__executionContext, 'completed', { mode: 'provider' });
    return mapSummary(certification, timestampRow);
  } catch (error) {
    return markFailed(supabase, certification, userId, error);
  }
}

export async function getCertificationArtifact(
  supabase: SupabaseClient,
  documentId: string,
  certificationUuid: string,
  userId: string,
  kind: CertificationArtifactKind,
) {
  await requireCertificationManagerAccess(supabase, documentId, userId);
  const { data } = await supabase.from('document_certifications').select('*').eq('document_id', documentId).eq('certification_uuid', certificationUuid).maybeSingle();
  if (!data || data.status !== 'COMPLETED') throw new CertificationError('CERTIFICATION_NOT_READY', 'La certificacion aun no esta disponible.', 409);
  const artifactRoot = data.provider_metadata?.artifact_root
    || `${data.tenant_id}/${data.document_id}/${data.certification_uuid}`;
  const timestampResult = kind === 'timestamp-token'
    ? await supabase.from('timestamp_records')
      .select('token_storage_path')
      .eq('document_certification_id', data.id)
      .eq('status', 'VALID')
      .maybeSingle()
    : { data: null, error: null };
  if (timestampResult.error) {
    throw new CertificationError('CERTIFICATION_ARTIFACT_READ_FAILED', timestampResult.error.message, 500);
  }
  const padesBtReportPath = data.provider_metadata?.product_integration?.pades_bt?.verification_report_path || null;
  const paths: Record<CertificationArtifactKind, string | null> = {
    certificate: data.certificate_pdf_path,
    package: data.technical_package_path,
    'certified-pdf': data.certified_pdf_path,
    'verification-report': padesBtReportPath || `${artifactRoot}/technical/verification-report.json`,
    'timestamp-token': timestampResult.data?.token_storage_path || `${artifactRoot}/timestamp/token.tst`,
    'signing-certificate': `${artifactRoot}/technical/signing-certificate.pem`,
    'certificate-chain': `${artifactRoot}/technical/certificate-chain.pem`,
    'evidence-manifest': `${artifactRoot}/technical/evidence-manifest.json`,
  };
  const path = paths[kind];
  if (!path) throw new CertificationError('CERTIFICATION_ARTIFACT_MISSING', 'El archivo solicitado no esta disponible.', 404);
  const bytes = await downloadArtifactBytes(
    supabase,
    path,
    userId,
    kind === 'certified-pdf' ? data.certified_pdf_sha256 : null
  );
  await supabase.from('certification_access_logs').insert({
    tenant_id: data.tenant_id, certification_id: data.id, verification_uuid: data.verification_uuid,
    actor_id: userId, action: `DOWNLOAD_${kind.toUpperCase().replace('-', '_')}`, result: 'SUCCESS',
  });
  return { bytes, certification: data as CertificationRow };
}

export async function getPublicCertification(supabase: SupabaseClient, verificationUuid: string) {
  const { data: certification } = await supabase.from('document_certifications').select('*').eq('verification_uuid', verificationUuid).in('status', ['COMPLETED', 'REVOKED']).maybeSingle();
  if (!certification) throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);
  if (certification.verification_status !== 'valid') {
    let sourceHashMatch = false;
    try {
      const sourceBytes = await verifyFrozenCertificationSource(supabase, {
        storageBucket: certification.source_storage_bucket,
        storagePath: certification.source_storage_path,
        sha256: certification.source_document_hash,
      });
      sourceHashMatch = sha256Hex(sourceBytes) === certification.document_body_sha256;
    } catch {
      sourceHashMatch = false;
    }
    const evidenceHashMatch = Boolean(
      certification.evidence_chain_canonical_json
      && certification.evidence_chain_sha256
      && sha256Hex(canonicalizeRFC8785(certification.evidence_chain_canonical_json)) === certification.evidence_chain_sha256,
    );
    const integrityValid = sourceHashMatch && evidenceHashMatch;
    const overallStatus = certification.status === 'REVOKED'
      ? 'REVOKED'
      : integrityValid
        ? 'PENDING'
        : 'INVALID';
    await supabase.from('certification_access_logs').insert({
      tenant_id: certification.tenant_id,
      certification_id: certification.id,
      verification_uuid: certification.verification_uuid,
      actor_id: null,
      action: 'PUBLIC_VERIFY',
      result: integrityValid ? 'SUCCESS' : 'FAILED',
      metadata: { mode: 'foundation_only', verification_status: certification.verification_status },
    });
    return {
      verification_uuid: certification.verification_uuid,
      overall_status: overallStatus,
      certification: {
        certification_uuid: certification.certification_uuid,
        verification_uuid: certification.verification_uuid,
        environment: certification.execution_environment || 'UNKNOWN',
        status: certification.status,
        mode: 'foundation_only',
        capabilities: {
          integrity: certification.integrity_status || 'pending',
          pdf_signature: certification.pdf_signature_status || 'not_configured',
          certificate: certification.certificate_status || 'not_configured',
          timestamp: certification.timestamp_status || 'not_configured',
          verification: certification.verification_status || 'pending',
        },
      },
      ...(integrityValid ? {} : {
        failure_code: 'FOUNDATION_INTEGRITY_MISMATCH',
        failure_message: 'La version congelada o su cadena de evidencia no coincide con el registro.',
      }),
      document: {
        body_hash_match: sourceHashMatch,
        certified_pdf_hash_match: false,
        folio: certification.document_folio,
      },
      document_chain: {
        hash_match: false,
        seal_hash_match: false,
        seal_valid: false,
        key_version: null,
        sha256: null,
        display_text: null,
      },
      document_seal: {
        seal_uuid: null,
        status: 'UNVERIFIED',
        document_chain_sha256: null,
        signature_algorithm: null,
        key_size_bits: null,
        signing_key_version: null,
        public_key_fingerprint_sha256: null,
        signed_at: null,
        seal_sha256: null,
        seal_base64_preview: null,
        verification_url: null,
        downloads: [],
      },
      evidence_chain: {
        manifest_hash_match: false,
        chain_hash_match: evidenceHashMatch,
        seal_hash_match: false,
        seal_valid: false,
        audit_chain_valid: evidenceHashMatch,
        key_version: null,
        sha256: certification.evidence_chain_sha256,
        display_text: null,
      },
      evidence_seal: {
        status: 'UNVERIFIED',
        signature_algorithm: null,
        signing_key_version: null,
        seal_sha256: null,
        seal_base64_preview: null,
      },
      certification_package: { hash_match: false },
      timestamp: null,
      audit: {
        event_count: Array.isArray(certification.evidence_chain_canonical_json?.legal_events)
          ? certification.evidence_chain_canonical_json.legal_events.length
          : 0,
        final_hash: null,
        merkle_root: null,
        valid: evidenceHashMatch,
      },
      certification_root_sha256: null,
      certification_root_match: false,
    };
  }
  const timestamp = await getTimestamp(supabase, certification.id);
  const [{ data: keyRows }, { data: manifestRow }, { data: documentRow }, { data: auditRows }, certifiedPdfResult, timestampTokenResult] = await Promise.all([
    supabase.from('cryptographic_keys').select('*').in('kms_key_id', [certification.document_signing_key_id, certification.evidence_signing_key_id]),
    supabase.from('evidence_manifests').select('canonical_manifest_json,manifest_sha256').eq('id', certification.evidence_manifest_id).maybeSingle(),
    supabase.from('documentos').select('id,documento_id,nombre,estado,owner_id,workspace_id,file_url,file_name,file_type,file_size,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash,created_at,fecha_completado,updated_at,participantes').eq('id', certification.document_id).maybeSingle(),
    supabase.from('legal_evidence_events').select('event_uuid,sequence_number,event_type,event_result,event_hash,previous_event_hash,chain_material,occurred_at').eq('document_id', certification.document_id).order('sequence_number', { ascending: true }),
    downloadArtifactBytes(supabase, certification.certified_pdf_path, null, certification.certified_pdf_sha256)
      .then((data) => ({ data, error: null as Error | null }))
      .catch((error) => ({ data: null, error: error as Error })),
    timestamp?.token_storage_path
      ? downloadArtifactBytes(supabase, timestamp.token_storage_path)
        .then((data) => ({ data, error: null as Error | null }))
        .catch((error) => ({ data: null, error: error as Error }))
      : Promise.resolve({ data: null, error: new Error('Timestamp token missing') }),
  ]);

  const documentKey = (keyRows || []).find((key) => key.kms_key_id === certification.document_signing_key_id && key.kms_key_version === certification.document_signing_key_version);
  const evidenceKey = (keyRows || []).find((key) => key.kms_key_id === certification.evidence_signing_key_id && key.kms_key_version === certification.evidence_signing_key_version);
  const documentCanonical = canonicalizeRFC8785(certification.document_chain_canonical_json);
  const evidenceCanonical = canonicalizeRFC8785(certification.evidence_chain_canonical_json);
  const documentHashMatch = sha256Hex(documentCanonical) === certification.document_chain_sha256;
  const evidenceHashMatch = sha256Hex(evidenceCanonical) === certification.evidence_chain_sha256;
  const manifestHashMatch = Boolean(manifestRow && sha256Hex(canonicalizeRFC8785(manifestRow.canonical_manifest_json)) === manifestRow.manifest_sha256 && manifestRow.manifest_sha256 === certification.evidence_manifest_sha256);
  const packageHashMatch = sha256Hex(canonicalizeRFC8785(certification.certification_package_canonical_json)) === certification.certification_package_sha256;
  const verifySeal = (canonical: string, signatureBase64: string, publicKeyPem?: string) => {
    if (!signatureBase64 || !publicKeyPem) return false;
    try {
      return verify('sha256', Buffer.from(canonical, 'utf8'), {
        key: createPublicKey(publicKeyPem), padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
      }, Buffer.from(signatureBase64, 'base64'));
    } catch {
      return false;
    }
  };
  const documentSealValid = verifySeal(documentCanonical, certification.document_seal_base64, documentKey?.public_key_pem);
  const evidenceSealValid = verifySeal(evidenceCanonical, certification.evidence_seal_base64, evidenceKey?.public_key_pem);
  const documentSealHashMatch = sha256Hex(Buffer.from(certification.document_seal_base64 || '', 'base64')) === certification.document_seal_sha256;
  const evidenceSealHashMatch = sha256Hex(Buffer.from(certification.evidence_seal_base64 || '', 'base64')) === certification.evidence_seal_sha256;
  let documentBodyHashMatch = false;
  if (certification.source_storage_bucket && certification.source_storage_path && certification.source_document_hash) {
    try {
      const sourceBytes = await verifyFrozenCertificationSource(supabase, {
        storageBucket: certification.source_storage_bucket,
        storagePath: certification.source_storage_path,
        sha256: certification.source_document_hash,
      });
      documentBodyHashMatch = sha256Hex(sourceBytes) === certification.document_body_sha256;
    } catch {
      documentBodyHashMatch = false;
    }
  } else if (documentRow) {
    try {
      documentBodyHashMatch = sha256Hex(await downloadCurrentDocumentBytes(supabase, documentRow as DocumentRow)) === certification.document_body_sha256;
    } catch {
      documentBodyHashMatch = false;
    }
  }
  const certifiedPdfBytes = certifiedPdfResult.data ? new Uint8Array(certifiedPdfResult.data) : null;
  const certifiedPdfHashMatch = Boolean(certifiedPdfBytes && sha256Hex(certifiedPdfBytes) === certification.certified_pdf_sha256);
  const requiresTimestamp = ['PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA'].includes(String(certification.pades_profile || ''));
  const publicPadesVerification = certifiedPdfBytes
    ? await createCertificationProviderSet().pdfSignature.verifyPdf({
      pdfBytes: certifiedPdfBytes,
      expectedCertificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256,
    })
    : null;
  const timestampTokenBytes = timestampTokenResult.data ? new Uint8Array(timestampTokenResult.data) : null;
  const timestampTokenHashMatch = Boolean(timestamp && timestampTokenBytes && sha256Hex(timestampTokenBytes) === timestamp.timestamp_token_sha256);
  const timestampImprintMatch = Boolean(timestamp && publicPadesVerification?.timestamp?.messageImprintValid);
  const timestampValidForProfile = !requiresTimestamp || Boolean(
    timestamp?.status === 'VALID'
      && timestampTokenHashMatch
      && timestampImprintMatch
      && publicPadesVerification?.profile === 'PAdES-B-T'
      && publicPadesVerification.timestamp?.valid,
  );
  const auditInspection = inspectLegalEvidenceChain((auditRows || []) as LegalEvidenceRow[]);
  const auditChainValid = auditInspection.valid
    && auditInspection.normalized.length === Number(certification.audit_event_count || 0)
    && auditInspection.finalHash === certification.audit_log_final_hash
    && auditInspection.genesisHash === certification.audit_log_genesis_hash
    && auditInspection.merkleRoot === certification.audit_merkle_root
    && certification.audit_log_final_hash === certification.evidence_chain_canonical_json?.audit_log_final_hash;
  const expectedRoot = canonicalSha256({
    certification_uuid: certification.certification_uuid,
    document_chain_sha256: certification.document_chain_sha256,
    document_seal_sha256: certification.document_seal_sha256,
    evidence_chain_sha256: certification.evidence_chain_sha256,
    evidence_seal_sha256: certification.evidence_seal_sha256,
    // The timestamp seals the CMS signature after the canonical certification
    // root is fixed. Including it here would create a circular dependency.
    timestamp_token_sha256: null,
  }).sha256;
  const certificationRootMatch = expectedRoot === certification.certification_root_sha256;
  const documentSealStatus = certification.status === 'REVOKED' || documentKey?.status === 'REVOKED'
    ? 'REVOKED'
    : !documentKey?.public_key_pem || !certification.document_seal_base64
      ? 'UNVERIFIED'
      : documentSealValid && documentSealHashMatch && documentHashMatch
        ? 'VALID'
        : 'INVALID';
  const overallValid = documentBodyHashMatch && documentHashMatch && documentSealValid && documentSealHashMatch
    && manifestHashMatch && evidenceHashMatch && evidenceSealValid && evidenceSealHashMatch
    && packageHashMatch && certifiedPdfHashMatch && timestampValidForProfile
    && certificationRootMatch && auditChainValid;
  await supabase.from('certification_access_logs').insert({
    tenant_id: certification.tenant_id, certification_id: certification.id, verification_uuid: certification.verification_uuid,
    actor_id: null, action: 'PUBLIC_VERIFY', result: overallValid && documentSealStatus === 'VALID' ? 'SUCCESS' : 'FAILED',
  });
  return {
    verification_uuid: certification.verification_uuid,
    overall_status: documentSealStatus === 'REVOKED' ? 'REVOKED' : overallValid ? 'VALID' : 'INVALID',
    certification: {
      certification_uuid: certification.certification_uuid,
      verification_uuid: certification.verification_uuid,
      environment: certification.execution_environment || 'UNKNOWN',
      status: certification.status,
    },
    ...(overallValid ? {} : { failure_code: 'CERTIFICATION_INTEGRITY_MISMATCH', failure_message: 'Uno o mas componentes no coinciden con los artefactos registrados.' }),
    document: { body_hash_match: documentBodyHashMatch, certified_pdf_hash_match: certifiedPdfHashMatch, folio: certification.document_folio },
    document_chain: {
      hash_match: documentHashMatch,
      seal_hash_match: documentSealHashMatch,
      seal_valid: documentSealValid,
      key_version: certification.document_signing_key_version,
      sha256: certification.document_chain_sha256,
      display_text: certification.document_chain_display_text,
    },
    document_seal: {
      seal_uuid: certification.document_chain_canonical_json?.document_seal_uuid
        || `SDL-DBX-${new Date(certification.sealed_at || certification.created_at).getUTCFullYear()}-${String(certification.document_uuid).replace(/-/g, '').slice(0, 8).toUpperCase()}-0001`,
      status: documentSealStatus,
      document_chain_sha256: certification.document_chain_sha256,
      signature_algorithm: documentKey?.algorithm || 'RSA-PSS-SHA256',
      key_size_bits: 3072,
      signing_key_version: certification.document_signing_key_version,
      public_key_fingerprint_sha256: certification.document_public_key_fingerprint_sha256,
      signed_at: certification.document_chain_canonical_json?.certification_started_at || certification.sealed_at || certification.created_at,
      seal_sha256: certification.document_seal_sha256,
      seal_base64_preview: abbreviateBase64(certification.document_seal_base64 || ''),
      verification_url: certification.document_chain_canonical_json?.verification_url,
      downloads: [
        'document-chain.json', 'document-chain.txt', 'document-chain.sha256',
        'document-seal.sig', 'document-seal.base64.txt', 'document-seal.sha256',
        'public-key.pem', 'verification-result.json',
      ],
    },
    evidence_chain: {
      manifest_hash_match: manifestHashMatch,
      chain_hash_match: evidenceHashMatch,
      seal_hash_match: evidenceSealHashMatch,
      seal_valid: evidenceSealValid,
      audit_chain_valid: auditChainValid,
      key_version: certification.evidence_signing_key_version,
      sha256: certification.evidence_chain_sha256,
      display_text: certification.evidence_chain_display_text,
    },
    evidence_seal: {
      status: evidenceSealValid && evidenceSealHashMatch ? 'VALID' : 'INVALID',
      signature_algorithm: evidenceKey?.algorithm || 'RSA-PSS-SHA256',
      signing_key_version: certification.evidence_signing_key_version,
      seal_sha256: certification.evidence_seal_sha256,
      seal_base64_preview: abbreviateBase64(certification.evidence_seal_base64 || ''),
    },
    certification_package: { hash_match: packageHashMatch },
    timestamp: timestamp ? {
      standard: timestamp.standard, status: timestampTokenHashMatch && timestampImprintMatch ? timestamp.status : 'INVALID', message_imprint_match: timestampImprintMatch,
      token_signature_valid: timestamp.status === 'VALID' && timestampTokenHashMatch && timestampImprintMatch,
      tsa_certificate_valid: timestamp.status === 'VALID', gen_time: timestamp.gen_time,
      timestamp_token_sha256: timestamp.timestamp_token_sha256,
      tsa_name: timestamp.tsa_name,
      tsa_policy_oid: timestamp.tsa_policy_oid,
      message_imprint_algorithm: timestamp.message_imprint_algorithm,
    } : null,
    audit: {
      event_count: Number(certification.audit_event_count || 0),
      final_hash: certification.audit_log_final_hash,
      merkle_root: certification.audit_merkle_root,
      valid: auditChainValid,
    },
    certification_root_sha256: certification.certification_root_sha256,
    certification_root_match: certificationRootMatch,
  };
}

const PUBLIC_CERTIFICATION_ARTIFACTS: Record<string, string> = {
  'document-chain.json': 'application/json',
  'document-chain.txt': 'text/plain; charset=utf-8',
  'document-chain.sha256': 'text/plain; charset=us-ascii',
  'document-seal.sig': 'application/octet-stream',
  'document-seal.base64.txt': 'text/plain; charset=us-ascii',
  'document-seal.sha256': 'text/plain; charset=us-ascii',
  'public-key.pem': 'application/x-pem-file',
  'verification-result.json': 'application/json',
};

export async function getPublicCertificationArtifact(
  supabase: SupabaseClient,
  verificationUuid: string,
  artifactName: string,
) {
  const contentType = PUBLIC_CERTIFICATION_ARTIFACTS[artifactName];
  if (!contentType) throw new CertificationError('ARTIFACT_NOT_ALLOWED', 'Artefacto no disponible.', 404);
  const { data: certification } = await supabase
    .from('document_certifications')
    .select('id,tenant_id,document_id,certification_uuid,verification_uuid,status,provider_metadata')
    .eq('verification_uuid', verificationUuid)
    .in('status', ['COMPLETED', 'REVOKED'])
    .maybeSingle();
  if (!certification) throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);

  const artifactRoot = certification.provider_metadata?.artifact_root
    || `${certification.tenant_id}/${certification.document_id}/${certification.certification_uuid}`;
  const storagePath = `${artifactRoot}/public/${artifactName}`;
  let bytes: Uint8Array;
  try {
    bytes = await downloadArtifactBytes(supabase, storagePath);
  } catch {
    throw new CertificationError('ARTIFACT_NOT_FOUND', 'Artefacto no disponible.', 404);
  }
  await supabase.from('certification_access_logs').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    verification_uuid: certification.verification_uuid,
    actor_id: null,
    action: 'PUBLIC_ARTIFACT_DOWNLOAD',
    result: 'SUCCESS',
    metadata: { artifact_name: artifactName },
  });
  return { bytes, contentType };
}
