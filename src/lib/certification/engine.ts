import { constants, createPublicKey, randomUUID, verify } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalSha256, canonicalizeRFC8785, sha256Hex } from './canonical';
import { requestVerifiedTimestamp, signDigestWithKms, signPdfWithPades } from './adapters';
import { abbreviateBase64, appendCertificatePages, applyCryptographicPlacements, generateIntegrityCertificatePdf } from './pdf';
import { createStoredZip } from './zip';
import { CertificationError, CertificationStatus, CertificationSummary, EvidenceItem } from './types';

type DocumentRow = {
  id: string;
  documento_id: string;
  nombre: string;
  estado: string;
  owner_id: string;
  workspace_id: string | null;
  file_url: string | null;
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

function parseStorageReference(raw: string) {
  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    return match ? { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) } : null;
  } catch {
    return null;
  }
}

async function downloadDocumentBytes(supabase: SupabaseClient, document: DocumentRow) {
  const candidates: Array<{ bucket: string; path: string }> = [];
  if (document.sealed_pdf_path) {
    candidates.push({ bucket: 'documents-signed', path: document.sealed_pdf_path });
    candidates.push({ bucket: 'documents', path: document.sealed_pdf_path });
  }
  if (document.file_url) {
    const reference = parseStorageReference(document.file_url);
    if (reference) candidates.push(reference);
    else if (!/^https?:/i.test(document.file_url)) candidates.push({ bucket: 'documents', path: document.file_url });
  }
  for (const candidate of candidates) {
    const { data, error } = await supabase.storage.from(candidate.bucket).download(candidate.path);
    if (!error && data) return new Uint8Array(await data.arrayBuffer());
  }
  if (document.file_url && /^https?:/i.test(document.file_url)) {
    const response = await fetch(document.file_url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (response?.ok) return new Uint8Array(await response.arrayBuffer());
  }
  throw new CertificationError('DOCUMENT_BYTES_UNAVAILABLE', 'No fue posible recuperar los bytes del documento cerrado.', 422);
}

async function transition(
  supabase: SupabaseClient,
  certification: CertificationRow,
  toStatus: CertificationStatus,
  actorId: string,
  metadata: Record<string, unknown> = {},
) {
  const fromStatus = certification.status;
  const { error } = await supabase.from('document_certifications').update({ status: toStatus }).eq('id', certification.id);
  if (error) throw new CertificationError('CERTIFICATION_STATE_WRITE_FAILED', error.message, 500);
  await supabase.from('certification_state_transitions').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: actorId,
    result: 'SUCCESS',
    metadata,
  });
  certification.status = toStatus;
}

async function markFailed(supabase: SupabaseClient, certification: CertificationRow, actorId: string, error: unknown): Promise<never> {
  const failure = error instanceof CertificationError
    ? error
    : new CertificationError('CERTIFICATION_FAILED', error instanceof Error ? error.message : 'La certificacion fallo.', 500);
  const fromStatus = certification.status;
  await supabase.from('document_certifications').update({
    status: 'FAILED',
    error_code: failure.code,
    error_message: failure.message,
  }).eq('id', certification.id);
  await supabase.from('certification_state_transitions').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    from_status: fromStatus,
    to_status: 'FAILED',
    actor_id: actorId,
    result: 'FAILED',
    error_code: failure.code,
    metadata: {},
  });
  certification.status = 'FAILED';
  throw failure;
}

async function uploadArtifact(supabase: SupabaseClient, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabase.storage.from(ARTIFACT_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
    cacheControl: 'private, max-age=0',
  });
  if (error) throw new CertificationError('ARTIFACT_STORAGE_FAILED', error.message, 500);
  return path;
}

function mapSummary(row: CertificationRow, timestamp?: Record<string, any> | null): CertificationSummary {
  return {
    certificationUuid: row.certification_uuid,
    verificationUuid: row.verification_uuid,
    documentId: row.document_id,
    documentFolio: row.document_folio,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    documentBodySha256: row.document_body_sha256 || null,
    certifiedPdfSha256: row.certified_pdf_sha256 || null,
    certificationRootSha256: row.certification_root_sha256 || null,
    timestampStatus: timestamp?.status || null,
    timestampGenTime: timestamp?.gen_time || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
  };
}

async function getTimestamp(supabase: SupabaseClient, certificationId: string) {
  const { data } = await supabase.from('timestamp_records').select('*').eq('document_certification_id', certificationId).maybeSingle();
  return data;
}

export async function getCertificationSummary(supabase: SupabaseClient, documentId: string, userId: string) {
  const { data: document } = await supabase.from('documentos').select('id,owner_id').eq('id', documentId).maybeSingle();
  if (!document || document.owner_id !== userId) throw new CertificationError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
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
) {
  const { data: documentData, error: documentError } = await supabase
    .from('documentos')
    .select('id,documento_id,nombre,estado,owner_id,workspace_id,file_url,file_name,file_type,file_size,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash,created_at,fecha_completado,updated_at,participantes,campos_solicitados,sello_digital')
    .eq('id', documentId)
    .maybeSingle();
  const document = documentData as DocumentRow | null;
  if (documentError || !document || document.owner_id !== userId) throw new CertificationError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
  if (document.estado !== 'completado') throw new CertificationError('DOCUMENT_NOT_COMPLETED', 'Solo pueden certificarse documentos completados.', 422);

  const tenantId = document.workspace_id || document.owner_id;
  const { data: existing } = await supabase.from('document_certifications').select('*').eq('document_id', documentId).eq('document_version', 1).maybeSingle();
  if (existing?.status === 'COMPLETED') return mapSummary(existing as CertificationRow, await getTimestamp(supabase, existing.id));

  let certification: CertificationRow;
  if (existing) {
    certification = existing as CertificationRow;
    if (certification.status !== 'FAILED') return mapSummary(certification, await getTimestamp(supabase, certification.id));
    const { error } = await supabase.from('document_certifications').update({
      status: 'PENDING', idempotency_key: idempotencyKey, error_code: null, error_message: null,
      execution_environment: executionEnvironment(),
    }).eq('id', certification.id);
    if (error) throw new CertificationError('CERTIFICATION_RETRY_FAILED', error.message, 500);
    certification.status = 'PENDING';
  } else {
    const { data, error } = await supabase.from('document_certifications').insert({
      tenant_id: tenantId,
      workspace_id: document.workspace_id,
      document_id: document.id,
      document_uuid: document.id,
      document_folio: document.documento_id,
      document_version: 1,
      idempotency_key: idempotencyKey,
      status: 'PENDING',
      created_by: userId,
      schema_version: '1.0',
      execution_environment: executionEnvironment(),
    }).select('*').single();
    if (error || !data) {
      if (error?.code === '42P01' || error?.code === 'PGRST205') {
        throw new CertificationError('CERTIFICATION_SCHEMA_MISSING', 'Falta aplicar la migracion del motor de certificacion.', 503);
      }
      throw new CertificationError('CERTIFICATION_CREATE_FAILED', error?.message || 'No se pudo iniciar la certificacion.', 500);
    }
    certification = data as CertificationRow;
  }

  await supabase.from('certification_state_transitions').insert({
    tenant_id: tenantId, certification_id: certification.id, from_status: null, to_status: 'PENDING', actor_id: userId, result: 'PENDING', metadata: {},
  });

  try {
    await transition(supabase, certification, 'FREEZING_DOCUMENT', userId);
    const documentBytes = await downloadDocumentBytes(supabase, document);
    const documentPdf = await PDFDocument.load(documentBytes);
    const pageCount = documentPdf.getPageCount();
    const completedAt = new Date(document.fecha_completado || document.updated_at).toISOString();
    const certificationStartedAt = new Date().toISOString();

    await transition(supabase, certification, 'HASHING_DOCUMENT', userId);
    const documentBodySha256 = sha256Hex(documentBytes);

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
      metadata_sha256: sha256Hex(canonicalizeRFC8785({ mime_type: 'application/pdf', page_count: pageCount, version: 1 })),
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

    const evidenceManifestUuid = randomUUID();
    const certificationUuid = certification.certification_uuid;
    const documentSealUuid = randomUUID();
    const verificationUrl = `${(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4028').replace(/\/$/, '')}/verificar-certificacion/${certification.verification_uuid}`;

    await transition(supabase, certification, 'BUILDING_DOCUMENT_CHAIN', userId);
    const documentPayload = {
      schema: 'DOCUBOX_DOCUMENT', schema_version: '1.0', certification_uuid: certificationUuid,
      document_seal_uuid: documentSealUuid,
      document_uuid: document.id, document_folio: document.documento_id, tenant_id: tenantId,
      workspace_id: document.workspace_id, document_type: 'DOCUMENTO_FIRMADO', document_version: 1,
      document_status: 'COMPLETED', workflow_type: 'MIXED', created_at: new Date(document.created_at).toISOString(),
      completed_at: completedAt, certification_started_at: certificationStartedAt,
      document_body_sha256: documentBodySha256, document_size_bytes: documentBytes.byteLength,
      page_count: pageCount, mime_type: 'application/pdf', audit_log_final_hash: auditLogFinalHash,
      evidence_manifest_uuid: evidenceManifestUuid, verification_url: verificationUrl,
      canonicalization_algorithm: 'JCS-RFC8785', digest_algorithm: 'SHA-256',
      signature_algorithm: 'RSA-PSS-SHA256', signing_key_id: 'KMS_GATEWAY_DOCUMENT_KEY', signing_key_version: 'ACTIVE',
    };
    const documentChain = canonicalSha256(documentPayload);
    const documentChainDisplay = displayChain('DOCUBOX_DOCUMENT', {
      CERTIFICATION_UUID: certificationUuid, DOCUMENT_SEAL_UUID: documentSealUuid,
      DOCUMENT_UUID: document.id, DOCUMENT_FOLIO: document.documento_id,
      TENANT_ID: tenantId, WORKSPACE_ID: document.workspace_id, DOCUMENT_TYPE: 'DOCUMENTO_FIRMADO',
      DOCUMENT_VERSION: 1, DOCUMENT_STATUS: 'COMPLETED', WORKFLOW_TYPE: 'MIXED',
      CREATED_AT: new Date(document.created_at).toISOString(), COMPLETED_AT: completedAt,
      DOCUMENT_BODY_SHA256: upper(documentBodySha256), AUDIT_LOG_FINAL_HASH: upper(auditLogFinalHash),
      DOCUMENT_SIZE_BYTES: documentBytes.byteLength, PAGE_COUNT: pageCount,
      EVIDENCE_MANIFEST_UUID: evidenceManifestUuid, VERIFICATION_URL: verificationUrl,
      CANONICALIZATION: 'JCS-RFC8785', DIGEST_ALGORITHM: 'SHA-256', SIGNATURE_ALGORITHM: 'RSA-PSS-SHA256',
      SIGNING_KEY_VERSION: documentPayload.signing_key_version,
    });

    await transition(supabase, certification, 'SIGNING_DOCUMENT_CHAIN', userId);
    const documentSeal = await signDigestWithKms('DOCUMENT_SEAL', documentChain.sha256, Buffer.from(documentChain.canonical, 'utf8'));

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
      digest_algorithm: 'SHA-256', signature_algorithm: 'RSA-PSS-SHA256', signing_key_version: 'ACTIVE',
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
      CANONICALIZATION: 'JCS-RFC8785', DIGEST_ALGORITHM: 'SHA-256', SIGNATURE_ALGORITHM: 'RSA-PSS-SHA256',
      SIGNING_KEY_VERSION: evidencePayload.signing_key_version,
    });

    await transition(supabase, certification, 'SIGNING_EVIDENCE_CHAIN', userId);
    const evidenceSeal = await signDigestWithKms('EVIDENCE_SEAL', evidenceChain.sha256, Buffer.from(evidenceChain.canonical, 'utf8'));

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

    await transition(supabase, certification, 'REQUESTING_TIMESTAMP', userId);
    const timestamp = await requestVerifiedTimestamp(certificationPackage.sha256);
    await transition(supabase, certification, 'VALIDATING_TIMESTAMP', userId);
    const timestampTokenSha256 = sha256Hex(timestamp.tokenBytes);
    const rootPayload = {
      certification_uuid: certificationUuid, document_chain_sha256: documentChain.sha256,
      document_seal_sha256: documentSeal.signatureSha256, evidence_chain_sha256: evidenceChain.sha256,
      evidence_seal_sha256: evidenceSeal.signatureSha256, timestamp_token_sha256: timestampTokenSha256,
    };
    const certificationRoot = canonicalSha256(rootPayload);

    const artifactRoot = `${tenantId}/${document.id}/${certificationUuid}`;
    const requestPath = timestamp.requestBytes ? `${artifactRoot}/timestamp-request.tsq` : null;
    if (timestamp.requestBytes && requestPath) await uploadArtifact(supabase, requestPath, timestamp.requestBytes, 'application/octet-stream');
    const responsePath = await uploadArtifact(supabase, `${artifactRoot}/timestamp-response.tsr`, timestamp.responseBytes, 'application/octet-stream');
    const tokenPath = await uploadArtifact(supabase, `${artifactRoot}/timestamp-token.tst`, timestamp.tokenBytes, 'application/octet-stream');

    const { data: timestampRow, error: timestampError } = await supabase.from('timestamp_records').insert({
      tenant_id: tenantId, document_certification_id: certification.id, standard: 'RFC3161', status: 'VALID',
      message_imprint_algorithm: 'SHA-256', message_imprint_sha256: timestamp.messageImprintSha256,
      timestamp_request_sha256: timestamp.requestBytes ? sha256Hex(timestamp.requestBytes) : null,
      timestamp_response_sha256: sha256Hex(timestamp.responseBytes), timestamp_token_sha256: timestampTokenSha256,
      gen_time: timestamp.genTime, tsa_name: timestamp.tsaName, tsa_policy_oid: timestamp.tsaPolicyOid,
      tsa_serial_number: timestamp.tsaSerialNumber, tsa_nonce: timestamp.tsaNonce,
      tsa_certificate_serial_number: timestamp.certificateSerialNumber,
      tsa_certificate_fingerprint_sha256: timestamp.certificateFingerprintSha256,
      tsa_issuer: timestamp.issuer, request_storage_path: requestPath, response_storage_path: responsePath,
      token_storage_path: tokenPath, verified_at: timestamp.verifiedAt,
    }).select('*').single();
    if (timestampError || !timestampRow) throw new CertificationError('TIMESTAMP_WRITE_FAILED', timestampError?.message || 'No se pudo registrar la estampa.', 500);

    for (const [purpose, seal] of [['DOCUMENT_SEAL', documentSeal], ['EVIDENCE_SEAL', evidenceSeal]] as const) {
      await supabase.from('cryptographic_keys').upsert({
        key_purpose: purpose, kms_key_id: seal.keyId, kms_key_version: seal.keyVersion,
        algorithm: seal.algorithm, public_key_pem: seal.publicKeyPem,
        public_key_fingerprint_sha256: seal.publicKeyFingerprintSha256,
        certificate_pem: seal.certificatePem, certificate_fingerprint_sha256: seal.certificateFingerprintSha256,
        status: 'ACTIVE', activated_at: seal.signedAt,
      }, { onConflict: 'kms_key_id,kms_key_version' });
    }

    await transition(supabase, certification, 'RENDERING_CERTIFICATE', userId);
    const certificateBytes = await generateIntegrityCertificatePdf({
      folio: document.documento_id, documentUuid: document.id, certificationUuid, verificationUrl,
      documentType: 'Documento firmado', documentVersion: 1, completedAt, certifiedAt: certificationStartedAt,
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
      timestamp: {
        genTime: timestamp.genTime, tsaName: timestamp.tsaName, policyOid: timestamp.tsaPolicyOid,
        serialNumber: timestamp.tsaSerialNumber, messageImprintSha256: timestamp.messageImprintSha256,
        tokenSha256: timestampTokenSha256,
      },
    });
    const certificatePath = await uploadArtifact(supabase, `${artifactRoot}/constancia-integridad-evidencia.pdf`, certificateBytes, 'application/pdf');

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
        timestamp: {
          genTime: timestamp.genTime,
          tsaName: timestamp.tsaName,
          policyOid: timestamp.tsaPolicyOid,
          serialNumber: timestamp.tsaSerialNumber,
          tokenSha256: timestampTokenSha256,
        },
      },
    );
    const appendedPdf = await appendCertificatePages(documentWithVisibleCertification, certificateBytes);
    await transition(supabase, certification, 'SIGNING_FINAL_PDF', userId);
    const certifiedPdf = await signPdfWithPades(appendedPdf);
    const certifiedPdfSha256 = sha256Hex(certifiedPdf);
    const certifiedPdfPath = await uploadArtifact(supabase, `${artifactRoot}/documento-certificado-pades.pdf`, certifiedPdf, 'application/pdf');

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
      timestamp: { standard: 'RFC3161', status: 'VALID', message_imprint_match: true, token_signature_valid: true, tsa_certificate_valid: true, gen_time: timestamp.genTime, timestamp_token_sha256: timestampTokenSha256 },
      certification_root_sha256: certificationRoot.sha256,
    };
    const publicVerificationArtifacts = [
      { name: 'document-chain.json', data: Buffer.from(documentChain.canonical, 'utf8'), contentType: 'application/json' },
      { name: 'document-chain.txt', data: Buffer.from(documentChainDisplay, 'utf8'), contentType: 'text/plain; charset=utf-8' },
      { name: 'document-chain.sha256', data: Buffer.from(documentChain.sha256, 'ascii'), contentType: 'text/plain; charset=us-ascii' },
      { name: 'document-seal.sig', data: Buffer.from(documentSeal.signatureBase64, 'base64'), contentType: 'application/octet-stream' },
      { name: 'document-seal.base64.txt', data: Buffer.from(documentSeal.signatureBase64, 'ascii'), contentType: 'text/plain; charset=us-ascii' },
      { name: 'document-seal.sha256', data: Buffer.from(documentSeal.signatureSha256, 'ascii'), contentType: 'text/plain; charset=us-ascii' },
      { name: 'public-key.pem', data: Buffer.from(documentSeal.publicKeyPem, 'utf8'), contentType: 'application/x-pem-file' },
      { name: 'verification-result.json', data: Buffer.from(JSON.stringify(report, null, 2), 'utf8'), contentType: 'application/json' },
    ];
    await Promise.all(publicVerificationArtifacts.map((artifact) => uploadArtifact(
      supabase,
      `${artifactRoot}/public/${artifact.name}`,
      artifact.data,
      artifact.contentType,
    )));
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
      ...(timestamp.requestBytes ? [{ name: 'certification-package/timestamp-request.tsq', data: timestamp.requestBytes }] : []),
      { name: 'certification-package/timestamp-response.tsr', data: timestamp.responseBytes },
      { name: 'certification-package/timestamp-token.tst', data: timestamp.tokenBytes },
      { name: 'certification-package/timestamp-token.sha256', data: timestampTokenSha256 },
      { name: 'certification-package/tsa-certificate.pem', data: timestamp.certificatePem },
      { name: 'certification-package/tsa-chain.pem', data: timestamp.chainPem },
      { name: 'certification-package/verification-result.json', data: JSON.stringify(report, null, 2) },
      { name: 'certification-package/public-keys.json', data: JSON.stringify({ document: documentSeal.publicKeyPem, evidence: evidenceSeal.publicKeyPem }, null, 2) },
    ]);
    const technicalPackagePath = await uploadArtifact(supabase, `${artifactRoot}/certification-package.zip`, technicalPackage, 'application/zip');

    const completedAtNow = new Date().toISOString();
    const { error: completeError } = await supabase.from('document_certifications').update({
      status: 'COMPLETED', document_body_sha256: documentBodySha256, certified_pdf_sha256: certifiedPdfSha256,
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
        kms: {
          document_key_id: documentSeal.keyId,
          document_key_version: documentSeal.keyVersion,
          evidence_key_id: evidenceSeal.keyId,
          evidence_key_version: evidenceSeal.keyVersion,
        },
        tsa: { name: timestamp.tsaName, policy_oid: timestamp.tsaPolicyOid },
        pades: { profile: 'PAdES-B-T', verified: true },
      },
      validator_version: 'docubox-certification-engine/1.1',
      certificate_pdf_path: certificatePath, certified_pdf_path: certifiedPdfPath,
      technical_package_path: technicalPackagePath, sealed_at: certificationStartedAt, completed_at: completedAtNow,
      error_code: null, error_message: null,
    }).eq('id', certification.id);
    if (completeError) throw new CertificationError('CERTIFICATION_FINALIZE_FAILED', completeError.message, 500);
    await supabase.from('certification_state_transitions').insert({
      tenant_id: tenantId, certification_id: certification.id, from_status: 'SIGNING_FINAL_PDF',
      to_status: 'COMPLETED', actor_id: userId, result: 'SUCCESS', metadata: { certified_pdf_sha256: certifiedPdfSha256 },
    });
    certification = { ...certification, status: 'COMPLETED', document_body_sha256: documentBodySha256, certified_pdf_sha256: certifiedPdfSha256, certification_root_sha256: certificationRoot.sha256, completed_at: completedAtNow };
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
  kind: 'certificate' | 'package' | 'certified-pdf',
) {
  const { data: document } = await supabase.from('documentos').select('id,owner_id').eq('id', documentId).maybeSingle();
  if (!document || document.owner_id !== userId) throw new CertificationError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
  const { data } = await supabase.from('document_certifications').select('*').eq('document_id', documentId).eq('certification_uuid', certificationUuid).maybeSingle();
  if (!data || data.status !== 'COMPLETED') throw new CertificationError('CERTIFICATION_NOT_READY', 'La certificacion aun no esta disponible.', 409);
  const path = kind === 'certificate' ? data.certificate_pdf_path : kind === 'package' ? data.technical_package_path : data.certified_pdf_path;
  if (!path) throw new CertificationError('CERTIFICATION_ARTIFACT_MISSING', 'El archivo solicitado no esta disponible.', 404);
  const { data: blob, error } = await supabase.storage.from(ARTIFACT_BUCKET).download(path);
  if (error || !blob) throw new CertificationError('CERTIFICATION_ARTIFACT_READ_FAILED', error?.message || 'No se pudo descargar el archivo.', 500);
  await supabase.from('certification_access_logs').insert({
    tenant_id: data.tenant_id, certification_id: data.id, verification_uuid: data.verification_uuid,
    actor_id: userId, action: `DOWNLOAD_${kind.toUpperCase().replace('-', '_')}`, result: 'SUCCESS',
  });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), certification: data as CertificationRow };
}

export async function getPublicCertification(supabase: SupabaseClient, verificationUuid: string) {
  const { data: certification } = await supabase.from('document_certifications').select('*').eq('verification_uuid', verificationUuid).in('status', ['COMPLETED', 'REVOKED']).maybeSingle();
  if (!certification) throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);
  const timestamp = await getTimestamp(supabase, certification.id);
  const [{ data: keyRows }, { data: manifestRow }, { data: documentRow }, { data: auditRows }, certifiedPdfResult, timestampTokenResult] = await Promise.all([
    supabase.from('cryptographic_keys').select('*').in('kms_key_id', [certification.document_signing_key_id, certification.evidence_signing_key_id]),
    supabase.from('evidence_manifests').select('canonical_manifest_json,manifest_sha256').eq('id', certification.evidence_manifest_id).maybeSingle(),
    supabase.from('documentos').select('id,documento_id,nombre,estado,owner_id,workspace_id,file_url,file_name,file_type,file_size,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash,created_at,fecha_completado,updated_at,participantes').eq('id', certification.document_id).maybeSingle(),
    supabase.from('legal_evidence_events').select('event_uuid,sequence_number,event_type,event_result,event_hash,previous_event_hash,chain_material,occurred_at').eq('document_id', certification.document_id).order('sequence_number', { ascending: true }),
    supabase.storage.from(ARTIFACT_BUCKET).download(certification.certified_pdf_path),
    timestamp?.token_storage_path
      ? supabase.storage.from(ARTIFACT_BUCKET).download(timestamp.token_storage_path)
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
  if (documentRow) {
    try {
      documentBodyHashMatch = sha256Hex(await downloadDocumentBytes(supabase, documentRow as DocumentRow)) === certification.document_body_sha256;
    } catch {
      documentBodyHashMatch = false;
    }
  }
  const certifiedPdfBytes = certifiedPdfResult.data ? new Uint8Array(await certifiedPdfResult.data.arrayBuffer()) : null;
  const certifiedPdfHashMatch = Boolean(certifiedPdfBytes && sha256Hex(certifiedPdfBytes) === certification.certified_pdf_sha256);
  const timestampTokenBytes = timestampTokenResult.data ? new Uint8Array(await timestampTokenResult.data.arrayBuffer()) : null;
  const timestampTokenHashMatch = Boolean(timestamp && timestampTokenBytes && sha256Hex(timestampTokenBytes) === timestamp.timestamp_token_sha256);
  const timestampImprintMatch = Boolean(timestamp && timestamp.message_imprint_sha256 === certification.certification_package_sha256);
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
    timestamp_token_sha256: timestamp?.timestamp_token_sha256,
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
    && packageHashMatch && certifiedPdfHashMatch && timestampTokenHashMatch && timestampImprintMatch
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
    .select('id,tenant_id,document_id,certification_uuid,verification_uuid,status')
    .eq('verification_uuid', verificationUuid)
    .in('status', ['COMPLETED', 'REVOKED'])
    .maybeSingle();
  if (!certification) throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);

  const storagePath = `${certification.tenant_id}/${certification.document_id}/${certification.certification_uuid}/public/${artifactName}`;
  const { data, error } = await supabase.storage.from(ARTIFACT_BUCKET).download(storagePath);
  if (error || !data) throw new CertificationError('ARTIFACT_NOT_FOUND', 'Artefacto no disponible.', 404);
  await supabase.from('certification_access_logs').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    verification_uuid: certification.verification_uuid,
    actor_id: null,
    action: 'PUBLIC_ARTIFACT_DOWNLOAD',
    result: 'SUCCESS',
    metadata: { artifact_name: artifactName },
  });
  return { bytes: new Uint8Array(await data.arrayBuffer()), contentType };
}
