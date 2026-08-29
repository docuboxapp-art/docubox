import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createNom151Provider,
  type Nom151ArtifactVerification,
  type Nom151Provider,
} from './provider';

const CERTIFICATION_BUCKET = 'certification-artifacts';
const NOM151_BUCKET = 'nom151-constancias';

type VerifiedPadesBt = {
  id: string;
  certification_uuid: string;
  document_id: string;
  document_version_id: string;
  certified_pdf_path: string;
  certified_pdf_sha256: string;
  pades_pdf_hash_after_signature: string;
  pades_profile: 'PAdES-B-T';
  pades_verified_at: string;
  provider_metadata: Record<string, unknown> | null;
};

type Nom151Row = {
  id: string;
  documento_id: string;
  document_version_id: string | null;
  document_certification_id: string | null;
  provider: string | null;
  environment: string | null;
  document_digest: string | null;
  pdf_sha256_local: string;
  constancia_path: string | null;
  constancia_sha256: string | null;
  source_storage_bucket: string | null;
  source_storage_path: string | null;
  nubarium_request_payload: Record<string, unknown> | null;
  provider_metadata: Record<string, unknown> | null;
  production_trusted: boolean | null;
  status: string;
  verification_status: string | null;
};

export class Nom151ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500
  ) {
    super(message);
    this.name = 'Nom151ServiceError';
  }
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function downloadObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  code: string
) {
  const result = await supabase.storage.from(bucket).download(path);
  if (result.error || !result.data) {
    throw new Nom151ServiceError(
      code,
      result.error?.message || 'No se encontró el artefacto.',
      500
    );
  }
  return new Uint8Array(await result.data.arrayBuffer());
}

async function verifiedPadesBt(supabase: SupabaseClient, documentId: string) {
  const result = await supabase
    .from('document_certifications')
    .select(
      'id,certification_uuid,document_id,document_version_id,certified_pdf_path,certified_pdf_sha256,pades_pdf_hash_after_signature,pades_profile,pades_verified_at,provider_metadata'
    )
    .eq('document_id', documentId)
    .eq('status', 'COMPLETED')
    .eq('execution_status', 'completed')
    .eq('pades_profile', 'PAdES-B-T')
    .eq('pdf_signature_status', 'valid')
    .eq('certificate_status', 'valid')
    .eq('timestamp_status', 'valid')
    .eq('verification_status', 'valid')
    .order('pades_verified_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) {
    throw new Nom151ServiceError(
      'NOM151_PADES_BT_NOT_VERIFIED',
      'La NOM-151 solo puede emitirse sobre el PDF final PAdES-B-T verificado.',
      409
    );
  }
  const row = result.data as VerifiedPadesBt;
  if (
    !row.document_version_id ||
    !row.certified_pdf_path ||
    !/^[a-f0-9]{64}$/i.test(row.certified_pdf_sha256 || '') ||
    row.certified_pdf_sha256.toLowerCase() !==
      String(row.pades_pdf_hash_after_signature || '').toLowerCase()
  ) {
    throw new Nom151ServiceError(
      'NOM151_PADES_BT_EVIDENCE_INCOMPLETE',
      'La evidencia persistida del PDF PAdES-B-T está incompleta.',
      409
    );
  }
  return row;
}

async function setAggregateStatus(
  supabase: SupabaseClient,
  certificationId: string | null,
  valid: boolean,
  productionTrusted = false
) {
  if (!certificationId) return;
  const nom151Status = valid ? (productionTrusted ? 'valid' : 'development') : 'invalid';
  await supabase
    .from('document_certifications')
    .update({ nom151_status: nom151Status })
    .eq('id', certificationId);
}

export type IssueNom151Result = {
  alreadyIssued: boolean;
  recordId: string;
  status: 'issued';
  verificationStatus: 'verified';
  environment: string;
  productionTrusted: boolean;
  provider: string;
  pscName: string;
  operationId: string;
  folio: string;
  documentDigest: string;
  artifactSha256: string;
  artifactPath: string;
  verification: Nom151ArtifactVerification;
};

export async function issueNom151ForVerifiedPadesBt(
  supabase: SupabaseClient,
  input: { documentId: string; requestedBy: string },
  provider: Nom151Provider = createNom151Provider()
): Promise<IssueNom151Result> {
  const pades = await verifiedPadesBt(supabase, input.documentId);
  const documentBytes = await downloadObject(
    supabase,
    CERTIFICATION_BUCKET,
    pades.certified_pdf_path,
    'NOM151_PADES_BT_STORAGE_MISSING'
  );
  const documentDigest = sha256(documentBytes);
  if (documentDigest !== pades.certified_pdf_sha256.toLowerCase()) {
    throw new Nom151ServiceError(
      'NOM151_DIGEST_MISMATCH',
      'El PDF PAdES-B-T almacenado no coincide con su SHA-256 persistido.',
      409
    );
  }
  const health = await provider.healthCheck();
  if (!health.ready) {
    throw new Nom151ServiceError(
      'NOM151_PROVIDER_NOT_CONFIGURED',
      'El proveedor NOM-151 no está configurado en el backend.',
      503
    );
  }

  const existing = await supabase
    .from('nom151_constancias_doc')
    .select(
      'id,status,verification_status,provider,psc_name,environment,operation_id,folio,document_digest,constancia_sha256,constancia_path,provider_metadata,production_trusted'
    )
    .eq('documento_id', input.documentId)
    .eq('document_version_id', pades.document_version_id)
    .eq('document_digest', documentDigest)
    .eq('provider', provider.providerId)
    .in('status', ['processing', 'issued'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Nom151ServiceError('NOM151_LOOKUP_FAILED', existing.error.message);
  if (existing.data?.status === 'issued' && existing.data.verification_status === 'verified') {
    const verification = (
      existing.data.provider_metadata as { verification?: Nom151ArtifactVerification } | null
    )?.verification;
    if (
      !verification?.valid ||
      !existing.data.constancia_path ||
      !existing.data.constancia_sha256
    ) {
      throw new Nom151ServiceError(
        'NOM151_EXISTING_EVIDENCE_INCOMPLETE',
        'La constancia existente no contiene verificación técnica completa.',
        409
      );
    }
    const productionTrusted =
      existing.data.production_trusted === true && verification.productionTrusted === true;
    await setAggregateStatus(supabase, pades.id, true, productionTrusted);
    return {
      alreadyIssued: true,
      recordId: existing.data.id,
      status: 'issued',
      verificationStatus: 'verified',
      environment: existing.data.environment,
      productionTrusted,
      provider: existing.data.provider,
      pscName: existing.data.psc_name,
      operationId: existing.data.operation_id,
      folio: existing.data.folio,
      documentDigest,
      artifactSha256: existing.data.constancia_sha256,
      artifactPath: existing.data.constancia_path,
      verification,
    };
  }
  if (existing.data?.status === 'processing') {
    throw new Nom151ServiceError(
      'NOM151_IN_PROGRESS',
      'La certificación NOM-151 de esta versión ya está en proceso.',
      409
    );
  }

  const idempotencyKey = `nom151:${provider.providerId}:${pades.document_version_id}:${documentDigest}`;
  const created = await supabase
    .from('nom151_constancias_doc')
    .insert({
      documento_id: input.documentId,
      document_version_id: pades.document_version_id,
      document_certification_id: pades.id,
      provider: provider.providerId,
      psc_name: health.pscName,
      environment: health.environment,
      status: 'processing',
      verification_status: 'verifying',
      production_trusted: false,
      digest_algorithm: 'SHA-256',
      document_digest: documentDigest,
      pdf_sha256_local: documentDigest,
      pades_profile: 'PAdES-B-T',
      pades_revision: pades.certification_uuid,
      source_storage_bucket: CERTIFICATION_BUCKET,
      source_storage_path: pades.certified_pdf_path,
      source_artifact_kind: 'PDF_PADES_B_T_VERIFIED',
      artifact_format: 'RFC3161_TIME_STAMP_RESP_DER',
      idempotency_key: idempotencyKey,
      requested_by: input.requestedBy,
      nubarium_request_payload: {
        pdf_sha256: documentDigest,
        pdf_size_bytes: documentBytes.byteLength,
        source_kind: 'pades_bt_verified',
        source_reference: pades.certified_pdf_path,
        certification_uuid: pades.certification_uuid,
        document_version_id: pades.document_version_id,
      },
    })
    .select('id')
    .single();
  if (created.error || !created.data) {
    if (created.error?.code === '23505') {
      throw new Nom151ServiceError(
        'NOM151_DUPLICATE_REQUEST',
        'La certificación NOM-151 de esta versión ya existe.',
        409
      );
    }
    throw new Nom151ServiceError(
      'NOM151_RECORD_CREATE_FAILED',
      created.error?.message || 'No se pudo reservar la operación NOM-151.'
    );
  }
  const recordId = created.data.id;

  try {
    const certified = await provider.certify({
      documentId: input.documentId,
      documentVersionId: pades.document_version_id,
      documentDigest,
      digestAlgorithm: 'SHA-256',
      documentBytes,
      idempotencyKey,
    });
    const artifactSha256 = sha256(certified.artifact);
    const issuedAt = certified.verification.issuedAt || new Date().toISOString();
    const date = new Date(issuedAt);
    const artifactPath = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${input.documentId}/${pades.document_version_id}/${recordId}-${artifactSha256}.asn1`;
    const uploaded = await supabase.storage
      .from(NOM151_BUCKET)
      .upload(artifactPath, certified.artifact, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    if (uploaded.error) {
      throw new Nom151ServiceError('NOM151_ARTIFACT_STORAGE_FAILED', uploaded.error.message);
    }
    const updated = await supabase
      .from('nom151_constancias_doc')
      .update({
        status: 'issued',
        verification_status: 'verified',
        verified_at: new Date().toISOString(),
        issued_at: issuedAt,
        provider: certified.provider,
        psc_name: certified.pscName,
        environment: certified.environment,
        operation_id: certified.operationId,
        folio: certified.folio,
        nubarium_codigo_validacion: certified.operationId,
        nubarium_hash: certified.providerDocumentDigest,
        nubarium_estatus: certified.providerStatus,
        nubarium_clave_mensaje:
          certified.providerMessageCode == null || certified.providerMessageCode === ''
            ? null
            : Number(certified.providerMessageCode),
        constancia_path: artifactPath,
        constancia_storage_path: artifactPath,
        constancia_sha256: artifactSha256,
        constancia_size_bytes: certified.artifact.byteLength,
        certificate_subject: certified.verification.certificateSubject,
        certificate_issuer: certified.verification.certificateIssuer,
        certificate_serial: certified.verification.certificateSerial,
        certificate_fingerprint: certified.verification.certificateFingerprintSha256,
        certificate_valid_from: certified.verification.certificateValidFrom,
        certificate_valid_to: certified.verification.certificateValidTo,
        certificate_key_usage: certified.verification.certificateKeyUsages,
        certificate_extended_key_usage: certified.verification.certificateExtendedKeyUsageOids,
        certificate_policy_oids: certified.verification.certificatePolicyOids,
        tst_policy_oid: certified.verification.policyOid,
        trust_bundle_version: certified.verification.trustBundleVersion,
        trust_root_fingerprint: certified.verification.trustRootFingerprintSha256,
        chain_fingerprints: certified.verification.chainFingerprintsSha256,
        production_trusted: certified.verification.productionTrusted,
        provider_metadata: {
          ...certified.providerMetadata,
          verification: certified.verification,
          artifact_role: 'ORIGINAL_PSC',
          docubox_pdf_role: 'REPRESENTATION_ONLY',
        },
        nubarium_response_payload: {
          codigoValidacion: certified.operationId,
          hash: certified.providerDocumentDigest,
          estatus: certified.providerStatus,
          claveMensaje: certified.providerMessageCode,
          artifact_sha256: artifactSha256,
          artifact_size_bytes: certified.artifact.byteLength,
          issued_at: issuedAt,
        },
        error_detail: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordId)
      .eq('status', 'processing')
      .select('id')
      .maybeSingle();
    if (updated.error || !updated.data) {
      throw new Nom151ServiceError(
        'NOM151_RECORD_FINALIZE_FAILED',
        updated.error?.message || 'No se pudo finalizar el registro NOM-151.'
      );
    }
    await setAggregateStatus(supabase, pades.id, true, certified.verification.productionTrusted);
    return {
      alreadyIssued: false,
      recordId,
      status: 'issued',
      verificationStatus: 'verified',
      environment: certified.environment,
      productionTrusted: certified.verification.productionTrusted,
      provider: certified.provider,
      pscName: certified.pscName,
      operationId: certified.operationId,
      folio: certified.folio,
      documentDigest,
      artifactSha256,
      artifactPath,
      verification: certified.verification,
    };
  } catch (error) {
    const rawFailure = error instanceof Error ? error.message : 'NOM151_FAILED';
    const [providerCode, providerMessageCode, ...providerDetailParts] = rawFailure.split(':');
    const code = error instanceof Nom151ServiceError ? error.code : providerCode || 'NOM151_FAILED';
    const providerDetail = providerDetailParts.join(':').trim().slice(0, 240) || null;
    await supabase
      .from('nom151_constancias_doc')
      .update({
        status: 'failed',
        verification_status: 'failed',
        error_detail: {
          code,
          message: 'La operación NOM-151 no superó la emisión o verificación técnica.',
          provider_message_code: providerMessageCode || null,
          provider_detail: providerDetail,
          failed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordId);
    await setAggregateStatus(supabase, pades.id, false);
    if (error instanceof Nom151ServiceError) throw error;
    throw new Nom151ServiceError(
      code,
      code === 'NOM151_PROVIDER_REJECTED'
        ? `El PSC rechazó la solicitud (${providerMessageCode || 'sin código'}): ${providerDetail || 'sin detalle'}.`
        : 'La operación NOM-151 falló de forma segura.',
      502
    );
  }
}

export async function revalidateNom151(
  supabase: SupabaseClient,
  certificationId: string,
  provider: Nom151Provider = createNom151Provider()
) {
  const result = await supabase
    .from('nom151_constancias_doc')
    .select(
      'id,documento_id,document_version_id,document_certification_id,provider,environment,document_digest,pdf_sha256_local,constancia_path,constancia_sha256,source_storage_bucket,source_storage_path,nubarium_request_payload,status,verification_status,provider_metadata,production_trusted'
    )
    .eq('id', certificationId)
    .single();
  if (result.error || !result.data) {
    throw new Nom151ServiceError('NOM151_NOT_FOUND', 'No se encontró la constancia NOM-151.', 404);
  }
  const row = result.data as Nom151Row;
  if (!row.constancia_path || !row.constancia_sha256) {
    throw new Nom151ServiceError(
      'NOM151_ARTIFACT_MISSING',
      'La constancia no tiene artefacto original.',
      409
    );
  }
  const sourceBucket = row.source_storage_bucket || 'documents';
  const sourcePath =
    row.source_storage_path || String(row.nubarium_request_payload?.source_reference || '');
  if (!sourcePath) {
    throw new Nom151ServiceError(
      'NOM151_SOURCE_MISSING',
      'No se registró el PDF certificado.',
      409
    );
  }
  const [artifact, documentBytes] = await Promise.all([
    downloadObject(supabase, NOM151_BUCKET, row.constancia_path, 'NOM151_ARTIFACT_STORAGE_MISSING'),
    downloadObject(supabase, sourceBucket, sourcePath, 'NOM151_SOURCE_STORAGE_MISSING'),
  ]);
  const expectedDigest = String(row.document_digest || row.pdf_sha256_local || '').toLowerCase();
  const artifactIntegrityValid = sha256(artifact) === row.constancia_sha256.toLowerCase();
  const documentIntegrityValid = sha256(documentBytes) === expectedDigest;
  const verification =
    artifactIntegrityValid && documentIntegrityValid
      ? await provider.verifyArtifact(artifact, documentBytes, expectedDigest)
      : {
          ...failedRevalidation(),
          detail: artifactIntegrityValid
            ? 'NOM151_DIGEST_MISMATCH'
            : 'NOM151_ARTIFACT_INTEGRITY_FAILED',
        };
  const valid = artifactIntegrityValid && documentIntegrityValid && verification.valid;
  const health = await provider.healthCheck();
  const storedEndpointHost = String(row.provider_metadata?.endpoint_id || '');
  const storedEndpointFingerprint = String(
    row.provider_metadata?.endpoint_fingerprint_sha256 || ''
  );
  const endpointMatches = storedEndpointFingerprint
    ? storedEndpointFingerprint === health.endpointFingerprintSha256
    : !storedEndpointHost || storedEndpointHost === health.endpointHost;
  const resolvedEnvironment = endpointMatches ? health.environment : 'unknown';
  const productionTrusted = Boolean(
    valid && endpointMatches && health.productionReady && verification.productionTrusted
  );
  await supabase
    .from('nom151_constancias_doc')
    .update({
      verification_status: valid ? 'verified' : 'failed',
      environment: resolvedEnvironment,
      production_trusted: productionTrusted,
      verified_at: valid ? new Date().toISOString() : null,
      certificate_valid_from: verification.certificateValidFrom,
      certificate_valid_to: verification.certificateValidTo,
      certificate_key_usage: verification.certificateKeyUsages,
      certificate_extended_key_usage: verification.certificateExtendedKeyUsageOids,
      certificate_policy_oids: verification.certificatePolicyOids,
      tst_policy_oid: verification.policyOid,
      trust_bundle_version: verification.trustBundleVersion,
      trust_root_fingerprint: verification.trustRootFingerprintSha256,
      chain_fingerprints: verification.chainFingerprintsSha256,
      provider_metadata: {
        ...(row.provider_metadata || {}),
        verification,
        artifact_integrity_valid: artifactIntegrityValid,
        document_integrity_valid: documentIntegrityValid,
        revalidated_at: new Date().toISOString(),
        artifact_role: 'ORIGINAL_PSC',
      },
      error_detail: valid ? null : { code: verification.detail || 'NOM151_REVALIDATION_FAILED' },
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  await setAggregateStatus(supabase, row.document_certification_id, valid, productionTrusted);
  return {
    valid,
    productionTrusted,
    environment: resolvedEnvironment,
    artifactIntegrityValid,
    documentIntegrityValid,
    verification,
  };
}

function failedRevalidation(): Nom151ArtifactVerification {
  return {
    valid: false,
    artifactParseValid: false,
    providerStatusValid: false,
    digestBindingValid: false,
    cmsSignatureValid: false,
    certificateValid: false,
    chainValid: null,
    chainStatus: 'not_available',
    digestAlgorithm: null,
    documentDigest: null,
    policyOid: null,
    serialNumber: null,
    issuedAt: null,
    certificateSubject: null,
    certificateIssuer: null,
    certificateSerial: null,
    certificateFingerprintSha256: null,
    certificateValidFrom: null,
    certificateValidTo: null,
    certificateKeyUsages: [],
    certificateExtendedKeyUsageOids: [],
    certificatePolicyOids: [],
    certificateProfileValid: false,
    tstPolicyValid: false,
    rootTrusted: false,
    productionTrusted: false,
    trustBundleVersion: null,
    trustRootFingerprintSha256: null,
    chainFingerprintsSha256: [],
    pscName: null,
    detail: 'NOM151_REVALIDATION_FAILED',
  };
}
