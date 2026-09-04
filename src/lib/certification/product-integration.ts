import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CertificationOrchestrator } from './orchestrator';
import { IndependentPadesVerificationProvider } from './independent-verification';
import { PadesBbPdfSignatureProvider } from './pades';
import { createCertificationProviderSet, type CertificationProviderSet } from './providers';
import { UnavailableTimestampAuthorityProvider, type TimestampResult } from './timestamp';
import { CertificationError } from './types';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

const DOCUMENT_BUCKET = 'documents';
const CERTIFICATION_BUCKET = 'certification-artifacts';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type FinalDocumentInput = {
  documentId: string;
  documentOwnerId: string;
  workspaceId: string;
  triggeredBy: string;
  visualPdfBytes: Uint8Array;
  visualPdfSha256: string;
  completedAt: string;
  signaturesApplied: number;
};

export type PadesBbProductResult = {
  alreadyVerified: boolean;
  certificationUuid: string;
  documentVersionId: string;
  storagePath: string;
  sha256: string;
  profile: 'PAdES-B-B';
  certificateFingerprintSha256: string;
  verifiedAt: string;
};

export type PadesProductResult = Omit<PadesBbProductResult, 'profile'> & {
  profile: 'PAdES-B-B' | 'PAdES-B-T';
  timestamp?: {
    provider: string;
    policyOid: string;
    serialNumber: string;
    genTime: string;
    tokenSha256: string;
    certificateFingerprintSha256: string;
    providerRole?: 'PRIMARY' | 'FALLBACK' | null;
    endpointId?: string | null;
    trustBundleId?: string | null;
    trustRootFingerprintSha256?: string | null;
    trustChainFingerprintsSha256?: string[];
    fallbackUsed?: boolean;
    fallbackReason?: string | null;
    primaryFailureCode?: string | null;
    primaryFailureClass?: 'TEMPORARY_FAILURE' | 'SECURITY_VALIDATION_FAILURE' | null;
  } | null;
};

export type PadesRequiredLevel = 'B-B' | 'B-T';

type CertificationTechnicalRow = {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  document_id: string;
  certification_uuid: string;
  document_version_id: string;
  status: string;
  execution_status: string;
  certified_pdf_path: string | null;
  certified_pdf_sha256: string | null;
  pades_profile: string | null;
  pades_signature_algorithm: string | null;
  pades_digest_algorithm: string | null;
  pades_certificate_serial: string | null;
  pades_certificate_fingerprint_sha256: string | null;
  pades_byte_range: number[] | null;
  pades_cms_sha256: string | null;
  pades_pdf_hash_after_signature: string | null;
  pades_signing_time_declared: string | null;
  pades_verification_result: Record<string, any> | null;
  pades_verified_at: string | null;
  provider_metadata: Record<string, any> | null;
  pdf_signature_status: string;
  certificate_status: string;
  verification_status: string;
  timestamp_status: string;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function getRequiredPadesLevel(
  value = process.env.PADES_REQUIRED_LEVEL
): PadesRequiredLevel {
  const normalized = String(value || 'B-B')
    .trim()
    .toUpperCase();
  if (normalized === 'B-B' || normalized === 'PADES-B-B') return 'B-B';
  if (normalized === 'B-T' || normalized === 'PADES-B-T') return 'B-T';
  throw new CertificationError(
    'PADES_REQUIRED_LEVEL_INVALID',
    'PADES_REQUIRED_LEVEL debe ser B-B o B-T.',
    503
  );
}

/**
 * Product finalization deliberately disables TSA even when one is configured.
 * This work package promotes only PAdES-B-B and leaves B-T to its own rollout.
 */
export function createPadesBbProductProviderSet(
  base: CertificationProviderSet = createCertificationProviderSet()
): CertificationProviderSet {
  const timestampAuthority = new UnavailableTimestampAuthorityProvider();
  const pdfSignature = new PadesBbPdfSignatureProvider(
    base.keyManagement,
    base.certificate,
    timestampAuthority
  );
  const independentVerification = new IndependentPadesVerificationProvider(
    new PadesBbPdfSignatureProvider(base.keyManagement, base.certificate, timestampAuthority)
  );

  return {
    ...base,
    timestampAuthority,
    pdfSignature,
    independentVerification,
    healthCheck: async () => {
      const [key, certificate, pades, independent] = await Promise.all([
        base.keyManagement.healthCheck(),
        base.certificate.healthCheck(),
        pdfSignature.healthCheck(),
        independentVerification.healthCheck(),
      ]);
      const productionReady = base.mode !== 'production' || base.productionEnabled;
      return {
        ready:
          productionReady && key.ready && certificate.ready && pades.ready && independent.ready,
        missing: unique([
          ...(productionReady ? [] : ['PRODUCTION_CERTIFICATION_ENABLED']),
          ...key.missing,
          ...certificate.missing,
          ...pades.missing,
          ...independent.missing,
        ]),
        provider: key.provider,
        keyId: key.keyId,
        keyVersion: key.keyVersion,
      };
    },
  };
}

async function uploadImmutablePdf(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  expectedSha256: string
) {
  const upload = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: 'application/pdf',
    cacheControl: 'private, max-age=0',
    upsert: false,
  });
  if (!upload.error) return;

  const existing = await supabase.storage.from(bucket).download(path);
  if (!existing.error && existing.data) {
    const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
    if (sha256(existingBytes) === expectedSha256) return;
  }
  throw new CertificationError('FINAL_PDF_IMMUTABLE_WRITE_FAILED', upload.error.message, 500);
}

async function uploadImmutableArtifact(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string
) {
  const expectedSha256 = sha256(bytes);
  const upload = await supabase.storage.from(CERTIFICATION_BUCKET).upload(path, bytes, {
    contentType,
    cacheControl: 'private, max-age=0',
    upsert: false,
  });
  if (!upload.error) return path;
  const existing = await supabase.storage.from(CERTIFICATION_BUCKET).download(path);
  if (!existing.error && existing.data) {
    const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
    if (sha256(existingBytes) === expectedSha256) return path;
  }
  throw new CertificationError('PADES_BT_IMMUTABLE_WRITE_FAILED', upload.error.message, 500);
}

async function storeCertificationArtifact(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    documentId: string;
    documentVersionId: string;
    actorId: string;
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }
) {
  if (!documentEncryptionPolicy().enabled) {
    return uploadImmutableArtifact(supabase, input.path, input.bytes, input.contentType);
  }
  await encryptAndUploadDocumentObject({
    service: supabase,
    plaintext: input.bytes,
    tenantId: input.tenantId,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    artifactKind: 'evidence',
    storageBucket: CERTIFICATION_BUCKET,
    storagePath: input.path,
    originalFileName: input.path.split('/').at(-1) || null,
    originalMimeType: input.contentType,
    userId: input.actorId,
  });
  return input.path;
}

async function ensureVisualVersion(
  supabase: SupabaseClient,
  input: FinalDocumentInput,
  visualStoragePath: string,
  requestedVersionId?: string | null
) {
  const versions = await supabase
    .from('document_versions')
    .select('id,version_number,sha256,storage_path,metadata')
    .eq('document_id', input.documentId)
    .eq('workspace_id', input.workspaceId)
    .order('version_number', { ascending: false });
  if (versions.error) {
    throw new CertificationError('FINAL_DOCUMENT_VERSION_READ_FAILED', versions.error.message, 500);
  }

  const reusable = (versions.data || []).find(
    (version) =>
      version.sha256 === input.visualPdfSha256 &&
      version.storage_path === visualStoragePath &&
      version.metadata?.source === 'product_final_visual_pdf'
  );
  if (reusable) return { id: reusable.id, versionNumber: reusable.version_number };

  const nextVersion =
    Math.max(0, ...(versions.data || []).map((version) => Number(version.version_number))) + 1;
  const inserted = await supabase
    .from('document_versions')
    .insert({
      ...(requestedVersionId ? { id: requestedVersionId } : {}),
      workspace_id: input.workspaceId,
      document_id: input.documentId,
      version_number: nextVersion,
      status: 'signed',
      file_url: null,
      storage_path: visualStoragePath,
      mime_type: 'application/pdf',
      byte_size: input.visualPdfBytes.byteLength,
      sha256: input.visualPdfSha256,
      change_reason: 'PDF visual final previo a la firma PAdES-B-B',
      created_by: input.documentOwnerId,
      frozen_at: input.completedAt,
      signed_at: input.completedAt,
      metadata: {
        source: 'product_final_visual_pdf',
        storage_bucket: DOCUMENT_BUCKET,
        immutable_source: true,
        immutable_source_sha256: input.visualPdfSha256,
        pades_profile_target: 'PAdES-B-B',
      },
    })
    .select('id,version_number')
    .single();
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      const concurrent = await supabase
        .from('document_versions')
        .select('id,version_number')
        .eq('document_id', input.documentId)
        .eq('workspace_id', input.workspaceId)
        .eq('sha256', input.visualPdfSha256)
        .eq('storage_path', visualStoragePath)
        .maybeSingle();
      if (!concurrent.error && concurrent.data) {
        return { id: concurrent.data.id, versionNumber: concurrent.data.version_number };
      }
    }
    throw new CertificationError(
      'FINAL_DOCUMENT_VERSION_CREATE_FAILED',
      inserted.error?.message || 'No se pudo registrar la version visual final.',
      500
    );
  }
  return { id: inserted.data.id, versionNumber: inserted.data.version_number };
}

async function storeVersionPdf(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    documentId: string;
    documentVersionId: string;
    artifactKind: 'visual_pdf' | 'signed_pdf' | 'certified_pdf';
    storageBucket: string;
    storagePath: string;
    bytes: Uint8Array;
    sha256: string;
    actorId: string;
  }
) {
  if (!documentEncryptionPolicy().enabled) {
    await uploadImmutablePdf(
      supabase,
      input.storageBucket,
      input.storagePath,
      input.bytes,
      input.sha256
    );
    return;
  }
  const encrypted = await encryptAndUploadDocumentObject({
    service: supabase,
    plaintext: input.bytes,
    tenantId: input.tenantId,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    artifactKind: input.artifactKind,
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    originalFileName: 'documento.pdf',
    originalMimeType: 'application/pdf',
    userId: input.actorId,
  });
  if (encrypted.metadata.plaintext_sha256 !== input.sha256) {
    throw new CertificationError(
      'DOCUMENT_ENCRYPTION_HASH_MISMATCH',
      'La capa de cifrado no preservo la huella logica del PDF.',
      500
    );
  }
}

async function readVersionPdf(
  supabase: SupabaseClient,
  input: {
    storageBucket: string;
    storagePath: string;
    sha256: string | null;
    actorId: string;
  }
) {
  if (!documentEncryptionPolicy().enabled) {
    const downloaded = await supabase.storage.from(input.storageBucket).download(input.storagePath);
    if (downloaded.error || !downloaded.data) {
      throw new CertificationError(
        'PADES_PDF_READ_FAILED',
        downloaded.error?.message || 'No se pudo recuperar el PDF.',
        500
      );
    }
    return new Uint8Array(await downloaded.data.arrayBuffer());
  }
  const decrypted = await readDocumentStorageObject({
    service: supabase,
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    expectedPlaintextSha256: input.sha256,
    userId: input.actorId,
  });
  return new Uint8Array(decrypted.plaintext);
}

async function appendFinalizationEvidence(
  supabase: SupabaseClient,
  input: FinalDocumentInput,
  visualStoragePath: string
) {
  const evidence = await supabase.rpc('append_legal_evidence_event', {
    p_document_id: input.documentId,
    p_event_type: 'FINAL_PDF_RENDERED',
    p_event_category: 'LIFECYCLE',
    p_event_result: 'SUCCESS',
    p_actor_id: input.triggeredBy,
    p_actor_type: 'USER',
    p_payload: {
      pades_profile_target: 'PAdES-B-B',
      signatures_applied: input.signaturesApplied,
      visual_pdf_sha256: input.visualPdfSha256,
      visual_storage_path: visualStoragePath,
    },
    p_document_sha256: input.visualPdfSha256,
    p_idempotency_key: `final-pdf-rendered:${input.visualPdfSha256}`,
    p_source_system: 'DOCUBOX_FINALIZATION',
    p_occurred_at: input.completedAt,
  });
  if (evidence.error) {
    throw new CertificationError('FINALIZATION_EVIDENCE_WRITE_FAILED', evidence.error.message, 500);
  }
}

async function appendExternalTimestampTransition(
  supabase: SupabaseClient,
  certification: CertificationTechnicalRow,
  timestamp: TimestampResult,
  actorId: string
) {
  if (!timestamp.fallbackUsed) return;
  const inserted = await supabase.from('certification_state_transitions').insert({
    tenant_id: certification.tenant_id,
    certification_id: certification.id,
    from_status: 'REQUESTING_TIMESTAMP',
    to_status: 'VALIDATING_TIMESTAMP',
    actor_id: actorId,
    result: 'SUCCESS',
    error_code:
      timestamp.primaryFailureCode || timestamp.fallbackReason || 'TSA_PRIMARY_UNAVAILABLE',
    metadata: {
      event_type:
        timestamp.primaryFailureClass === 'SECURITY_VALIDATION_FAILURE'
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
  if (inserted.error) {
    // The immutable timestamp row already preserves the full failure provenance.
    // Do not request a second external timestamp merely because the secondary
    // transition log was temporarily unavailable.
    console.error('[certification] TSA failover transition could not be persisted', {
      code: 'TSA_FAILOVER_AUDIT_WRITE_FAILED',
      certificationId: certification.id,
    });
  }
}

function requireVerifiedPades(row: CertificationTechnicalRow) {
  const primary = row.pades_verification_result?.primary || {};
  const independent = row.pades_verification_result?.independent || {};
  const verified =
    row.status === 'COMPLETED' &&
    row.execution_status === 'completed' &&
    row.pades_profile === 'PAdES-B-B' &&
    row.pdf_signature_status === 'valid' &&
    row.certificate_status === 'valid' &&
    row.verification_status === 'valid' &&
    primary.valid === true &&
    primary.byteRangeValid === true &&
    primary.digestValid === true &&
    primary.cmsValid === true &&
    primary.certificateValid === true &&
    primary.certificateKeyMatches === true &&
    independent.valid === true &&
    independent.byteRangeValid === true &&
    independent.digestValid === true &&
    independent.cmsValid === true &&
    independent.certificateValid === true &&
    independent.certificateKeyMatches === true &&
    Boolean(row.certified_pdf_path) &&
    SHA256_PATTERN.test(String(row.certified_pdf_sha256 || '')) &&
    row.certified_pdf_sha256 === row.pades_pdf_hash_after_signature &&
    SHA256_PATTERN.test(String(row.pades_certificate_fingerprint_sha256 || '')) &&
    Boolean(row.pades_verified_at);
  if (!verified) {
    throw new CertificationError(
      'PADES_FAILED',
      'La firma PAdES-B-B no supero todas las verificaciones requeridas para publicar el PDF definitivo.',
      502
    );
  }
}

async function certificationRow(supabase: SupabaseClient, documentId: string, versionId: string) {
  const result = await supabase
    .from('document_certifications')
    .select(
      'id,tenant_id,workspace_id,document_id,certification_uuid,document_version_id,status,execution_status,certified_pdf_path,certified_pdf_sha256,pades_profile,pades_signature_algorithm,pades_digest_algorithm,pades_certificate_serial,pades_certificate_fingerprint_sha256,pades_byte_range,pades_cms_sha256,pades_pdf_hash_after_signature,pades_signing_time_declared,pades_verification_result,pades_verified_at,provider_metadata,pdf_signature_status,certificate_status,verification_status,timestamp_status,lease_owner,lease_expires_at'
    )
    .eq('document_id', documentId)
    .eq('document_version_id', versionId)
    .maybeSingle();
  if (result.error || !result.data) {
    throw new CertificationError(
      'PADES_CERTIFICATION_RECORD_MISSING',
      result.error?.message || 'No se encontro el registro tecnico de la certificacion.',
      500
    );
  }
  return result.data as CertificationTechnicalRow;
}

function requireVerifiedPadesBt(row: CertificationTechnicalRow) {
  const primary = row.pades_verification_result?.primary || {};
  const independent = row.pades_verification_result?.independent || {};
  const timestampChecks = (verification: Record<string, any>) =>
    verification?.profile === 'PAdES-B-T' &&
    verification?.timestamp?.valid === true &&
    verification?.timestamp?.messageImprintValid === true &&
    verification?.timestamp?.nonceValid === true &&
    verification?.timestamp?.policyValid === true &&
    verification?.timestamp?.cmsValid === true &&
    verification?.timestamp?.certificateValid === true &&
    verification?.timestamp?.chainValid === true &&
    verification?.timestamp?.tsaEkuValid === true;
  if (
    row.status !== 'COMPLETED' ||
    row.execution_status !== 'completed' ||
    row.pades_profile !== 'PAdES-B-T' ||
    row.pdf_signature_status !== 'valid' ||
    row.certificate_status !== 'valid' ||
    row.timestamp_status !== 'valid' ||
    row.verification_status !== 'valid' ||
    primary.valid !== true ||
    independent.valid !== true ||
    !timestampChecks(primary) ||
    !timestampChecks(independent) ||
    !row.certified_pdf_path ||
    !SHA256_PATTERN.test(String(row.certified_pdf_sha256 || '')) ||
    row.certified_pdf_sha256 !== row.pades_pdf_hash_after_signature ||
    !row.pades_verified_at
  ) {
    throw new CertificationError(
      'PADES_BT_FAILED',
      'La firma PAdES-B-T no supero todas las verificaciones RFC 3161 requeridas.',
      502
    );
  }
}

async function claimPadesBtLease(
  supabase: SupabaseClient,
  certification: CertificationTechnicalRow
) {
  const leaseOwner = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  const claim = await supabase
    .from('document_certifications')
    .update({ lease_owner: leaseOwner, lease_expires_at: leaseExpiresAt })
    .eq('id', certification.id)
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`)
    .select('id')
    .maybeSingle();
  if (claim.error) throw new CertificationError('PADES_BT_LEASE_FAILED', claim.error.message, 500);
  if (!claim.data)
    throw new CertificationError(
      'PADES_BT_IN_PROGRESS',
      'Otra operación está incorporando la estampa RFC 3161.',
      409
    );
  return leaseOwner;
}

async function releasePadesBtLease(
  supabase: SupabaseClient,
  certificationId: string,
  leaseOwner: string
) {
  await supabase
    .from('document_certifications')
    .update({ lease_owner: null, lease_expires_at: null })
    .eq('id', certificationId)
    .eq('lease_owner', leaseOwner);
}

async function promoteVerifiedPadesBtDocument(
  supabase: SupabaseClient,
  documentId: string,
  storagePath: string,
  sha256Value: string,
  verifiedAt: string
) {
  const promoted = await supabase
    .from('documentos')
    .update({
      sealed_pdf_path: storagePath,
      sealed_pdf_hash: sha256Value,
      sealed_at: verifiedAt,
    })
    .eq('id', documentId)
    .eq('estado', 'completado')
    .select('id')
    .maybeSingle();
  if (promoted.error || !promoted.data) {
    throw new CertificationError(
      'PADES_BT_PROMOTION_FAILED',
      promoted.error?.message || 'No se pudo promover el PDF B-T verificado como versión final.',
      500
    );
  }
}

export async function upgradePadesBbCertificationToBt(
  supabase: SupabaseClient,
  input: { documentId: string; triggeredBy: string },
  configuredProviders: CertificationProviderSet = createCertificationProviderSet()
): Promise<PadesProductResult> {
  const certificationResult = await supabase
    .from('document_certifications')
    .select('document_version_id')
    .eq('document_id', input.documentId)
    .eq('status', 'COMPLETED')
    .in('pades_profile', ['PAdES-B-B', 'PAdES-B-T'])
    .order('pades_verified_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (certificationResult.error || !certificationResult.data) {
    throw new CertificationError(
      'PADES_BB_CERTIFICATION_MISSING',
      certificationResult.error?.message ||
        'No existe un PAdES-B-B verificado para incorporar la TSA.',
      409
    );
  }
  let certification = await certificationRow(
    supabase,
    input.documentId,
    certificationResult.data.document_version_id
  );
  if (certification.pades_profile === 'PAdES-B-T') {
    requireVerifiedPadesBt(certification);
    const existingPath =
      certification.provider_metadata?.product_integration?.pades_bt?.final_pdf_path;
    if (!existingPath)
      throw new CertificationError(
        'PADES_BT_STORAGE_PATH_MISSING',
        'La certificación B-T no tiene una ruta final registrada.',
        500
      );
    await promoteVerifiedPadesBtDocument(
      supabase,
      input.documentId,
      existingPath,
      certification.certified_pdf_sha256!,
      certification.pades_verified_at!
    );
    return {
      alreadyVerified: true,
      certificationUuid: certification.certification_uuid,
      documentVersionId: certification.document_version_id,
      storagePath: existingPath,
      sha256: certification.certified_pdf_sha256!,
      profile: 'PAdES-B-T',
      certificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256!,
      verifiedAt: certification.pades_verified_at!,
      timestamp: certification.provider_metadata?.product_integration?.pades_bt?.timestamp || null,
    };
  }
  requireVerifiedPades(certification);

  const timestampHealth = await configuredProviders.timestampAuthority.healthCheck();
  if (!timestampHealth.ready) {
    throw new CertificationError(
      'TSA_NOT_CONFIGURED',
      `La TSA RFC 3161 requerida no está lista: ${unique(timestampHealth.missing).join(', ') || 'UNKNOWN'}.`,
      503
    );
  }
  const leaseOwner = await claimPadesBtLease(supabase, certification);
  try {
    certification = await certificationRow(
      supabase,
      input.documentId,
      certification.document_version_id
    );
    if (certification.pades_profile === 'PAdES-B-T') {
      requireVerifiedPadesBt(certification);
      const existingPath =
        certification.provider_metadata?.product_integration?.pades_bt?.final_pdf_path;
      if (!existingPath)
        throw new CertificationError(
          'PADES_BT_STORAGE_PATH_MISSING',
          'La certificación B-T no tiene una ruta final registrada.',
          500
        );
      await promoteVerifiedPadesBtDocument(
        supabase,
        input.documentId,
        existingPath,
        certification.certified_pdf_sha256!,
        certification.pades_verified_at!
      );
      await releasePadesBtLease(supabase, certification.id, leaseOwner);
      return {
        alreadyVerified: true,
        certificationUuid: certification.certification_uuid,
        documentVersionId: certification.document_version_id,
        storagePath: existingPath,
        sha256: certification.certified_pdf_sha256!,
        profile: 'PAdES-B-T',
        certificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256!,
        verifiedAt: certification.pades_verified_at!,
        timestamp:
          certification.provider_metadata?.product_integration?.pades_bt?.timestamp || null,
      };
    }
    const bbBytes = await readVersionPdf(supabase, {
      storageBucket: CERTIFICATION_BUCKET,
      storagePath: certification.certified_pdf_path!,
      sha256: certification.certified_pdf_sha256,
      actorId: input.triggeredBy,
    });
    if (sha256(bbBytes) !== certification.certified_pdf_sha256) {
      throw new CertificationError(
        'PADES_BB_PDF_HASH_MISMATCH',
        'El PDF B-B almacenado no coincide con su huella.',
        409
      );
    }

    const upgraded = await configuredProviders.pdfSignature.upgradeToPadesBt({
      pdfBytes: bbBytes,
      expectedCertificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256,
      policyOid:
        (process.env.TSA_POLICY || '').trim().toLowerCase() === 'external-free'
          ? undefined
          : process.env.DOCUBOX_TSA_POLICY_OID || undefined,
    });
    const independent = await configuredProviders.independentVerification.verifyPdf({
      pdfBytes: upgraded.pdfBytes,
      expectedCertificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256,
    });
    if (
      !independent.valid ||
      independent.profile !== 'PAdES-B-T' ||
      !independent.timestamp?.valid
    ) {
      throw new CertificationError(
        'INDEPENDENT_PADES_BT_VERIFICATION_FAILED',
        independent.detail || 'La verificación independiente B-T falló.',
        502
      );
    }

    const artifactRoot = certification.provider_metadata?.artifact_root;
    if (!artifactRoot)
      throw new CertificationError(
        'CERTIFICATION_ARTIFACT_ROOT_MISSING',
        'La certificación no tiene raíz de artefactos.',
        500
      );
    const storeBtArtifact = (path: string, bytes: Uint8Array, contentType: string) =>
      storeCertificationArtifact(supabase, {
        tenantId: certification.workspace_id || certification.tenant_id,
        documentId: input.documentId,
        documentVersionId: certification.document_version_id,
        actorId: input.triggeredBy,
        path,
        bytes,
        contentType,
      });
    const timestamp = upgraded.timestamp;
    const timestampRoot = `${artifactRoot}/pades-bt/timestamp/${timestamp.tokenSha256}`;
    const bbPreservedPath = await storeBtArtifact(
      `${artifactRoot}/pades-bb/documento-certificado-${certification.certified_pdf_sha256}.pdf`,
      bbBytes,
      'application/pdf'
    );
    const btArtifactPath = await storeBtArtifact(
      `${artifactRoot}/pades-bt/documento-certificado-${upgraded.pdfHashAfterSignature}.pdf`,
      upgraded.pdfBytes,
      'application/pdf'
    );
    const requestPath = await storeBtArtifact(
      `${timestampRoot}/request.tsq`,
      timestamp.request,
      'application/octet-stream'
    );
    const responsePath = await storeBtArtifact(
      `${timestampRoot}/response.tsr`,
      timestamp.response,
      'application/octet-stream'
    );
    const tokenPath = await storeBtArtifact(
      `${timestampRoot}/token.tst`,
      timestamp.token,
      'application/octet-stream'
    );
    await storeBtArtifact(
      `${timestampRoot}/verification.json`,
      Buffer.from(JSON.stringify(timestamp.verification, null, 2)),
      'application/json'
    );

    const storedTimestamp = await supabase
      .from('timestamp_records')
      .upsert(
        {
          tenant_id: certification.tenant_id,
          document_certification_id: certification.id,
          standard: 'RFC3161',
          status: 'VALID',
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
        },
        { onConflict: 'document_certification_id' }
      )
      .select('id')
      .single();
    if (storedTimestamp.error || !storedTimestamp.data) {
      throw new CertificationError(
        'RFC3161_EVIDENCE_WRITE_FAILED',
        storedTimestamp.error?.message || 'No se pudo persistir la evidencia RFC 3161.',
        500
      );
    }
    await appendExternalTimestampTransition(supabase, certification, timestamp, input.triggeredBy);

    const verifiedAt = new Date().toISOString();
    const verificationResult = { primary: upgraded.verification, independent };
    const verificationReport = {
      profile: 'PAdES-B-T',
      status: 'VALID',
      verified_at: verifiedAt,
      document_id: input.documentId,
      document_version_id: certification.document_version_id,
      certification_uuid: certification.certification_uuid,
      pdf_sha256: upgraded.pdfHashAfterSignature,
      byte_range: upgraded.byteRange,
      cms_sha256: upgraded.cmsHashSha256,
      certificate_fingerprint_sha256: certification.pades_certificate_fingerprint_sha256,
      timestamp: {
        standard: 'RFC3161',
        status: 'VALID',
        provider: timestamp.provider,
        policy_oid: timestamp.policyOid,
        serial_number: timestamp.serialNumber,
        gen_time: timestamp.genTime,
        nonce: timestamp.nonce,
        message_imprint_sha256: timestamp.messageImprintSha256,
        token_sha256: timestamp.tokenSha256,
        certificate_subject: timestamp.tsaCertificateSubject,
        certificate_issuer: timestamp.tsaIssuer,
        certificate_fingerprint_sha256: timestamp.tsaCertificateFingerprintSha256,
        provider_role: timestamp.providerRole || null,
        endpoint_id: timestamp.endpointId || null,
        trust_bundle_id: timestamp.trustBundleId || null,
        trust_root_fingerprint_sha256: timestamp.trustRootFingerprintSha256 || null,
        trust_chain_fingerprints_sha256: timestamp.trustChainFingerprintsSha256 || [],
        fallback_used: timestamp.fallbackUsed === true,
        fallback_reason: timestamp.fallbackReason || null,
        primary_failure_code: timestamp.primaryFailureCode || null,
        primary_failure_class: timestamp.primaryFailureClass || null,
      },
      verification: verificationResult,
    };
    const verificationReportPath = await storeBtArtifact(
      `${timestampRoot}/verification-report.json`,
      Buffer.from(JSON.stringify(verificationReport, null, 2)),
      'application/json'
    );
    const signatureEvidence = await supabase.from('document_pdf_signatures').upsert(
      {
        tenant_id: certification.tenant_id,
        document_id: certification.document_id,
        document_certification_id: certification.id,
        timestamp_record_id: storedTimestamp.data.id,
        pades_profile: 'PAdES-B-T',
        status: 'VALID',
        signature_algorithm: certification.pades_signature_algorithm,
        digest_algorithm: certification.pades_digest_algorithm,
        certificate_serial: certification.pades_certificate_serial,
        certificate_fingerprint_sha256: certification.pades_certificate_fingerprint_sha256,
        byte_range: upgraded.byteRange,
        cms_sha256: upgraded.cmsHashSha256,
        pdf_hash_after_signature: upgraded.pdfHashAfterSignature,
        signing_time_declared: certification.pades_signing_time_declared,
        verification_result: verificationResult,
        verified_at: verifiedAt,
      },
      { onConflict: 'document_certification_id' }
    );
    if (signatureEvidence.error)
      throw new CertificationError(
        'PADES_BT_EVIDENCE_WRITE_FAILED',
        signatureEvidence.error.message,
        500
      );

    const finalPath = documentEncryptionPolicy().enabled
      ? `tenants/${certification.workspace_id || certification.tenant_id}/documents/${input.documentId}/versions/${certification.document_version_id}/pades-bt.enc`
      : `documents-signed/${certification.workspace_id || certification.tenant_id}/${input.documentId}/pades-bt/${certification.certification_uuid}-${upgraded.pdfHashAfterSignature}.pdf`;
    await storeVersionPdf(supabase, {
      tenantId: certification.workspace_id || certification.tenant_id,
      documentId: input.documentId,
      documentVersionId: certification.document_version_id,
      artifactKind: 'signed_pdf',
      storageBucket: DOCUMENT_BUCKET,
      storagePath: finalPath,
      bytes: upgraded.pdfBytes,
      sha256: upgraded.pdfHashAfterSignature,
      actorId: input.triggeredBy,
    });
    const timestampPublic = {
      provider: timestamp.provider,
      policyOid: timestamp.policyOid,
      serialNumber: timestamp.serialNumber,
      genTime: timestamp.genTime,
      tokenSha256: timestamp.tokenSha256,
      certificateFingerprintSha256: timestamp.tsaCertificateFingerprintSha256,
      providerRole: timestamp.providerRole || null,
      endpointId: timestamp.endpointId || null,
      trustBundleId: timestamp.trustBundleId || null,
      trustRootFingerprintSha256: timestamp.trustRootFingerprintSha256 || null,
      trustChainFingerprintsSha256: timestamp.trustChainFingerprintsSha256 || [],
      fallbackUsed: timestamp.fallbackUsed === true,
      fallbackReason: timestamp.fallbackReason || null,
      primaryFailureCode: timestamp.primaryFailureCode || null,
      primaryFailureClass: timestamp.primaryFailureClass || null,
    };
    const providerMetadata = {
      ...(certification.provider_metadata || {}),
      tsa: {
        status: 'valid',
        standard: 'RFC3161',
        provider: timestamp.provider,
        policy_oid: timestamp.policyOid,
        serial_number: timestamp.serialNumber,
        gen_time: timestamp.genTime,
        token_sha256: timestamp.tokenSha256,
        certificate_subject: timestamp.tsaCertificateSubject,
        certificate_issuer: timestamp.tsaIssuer,
        certificate_serial: timestamp.tsaCertificateSerialNumber,
        certificate_fingerprint_sha256: timestamp.tsaCertificateFingerprintSha256,
        provider_role: timestamp.providerRole || null,
        endpoint_id: timestamp.endpointId || null,
        trust_bundle_id: timestamp.trustBundleId || null,
        trust_root_fingerprint_sha256: timestamp.trustRootFingerprintSha256 || null,
        trust_chain_fingerprints_sha256: timestamp.trustChainFingerprintsSha256 || [],
        fallback_used: timestamp.fallbackUsed === true,
        fallback_reason: timestamp.fallbackReason || null,
        primary_failure_code: timestamp.primaryFailureCode || null,
        primary_failure_class: timestamp.primaryFailureClass || null,
      },
      pades: {
        ...(certification.provider_metadata?.pades || {}),
        profile: 'PAdES-B-T',
        verified: true,
        byte_range: upgraded.byteRange,
        cms_sha256: upgraded.cmsHashSha256,
        pdf_hash_after_signature: upgraded.pdfHashAfterSignature,
        verification_result: verificationResult,
      },
      product_integration: {
        ...(certification.provider_metadata?.product_integration || {}),
        pades_bb: {
          artifact_path: bbPreservedPath,
          certified_pdf_path: certification.certified_pdf_path,
          sha256: certification.certified_pdf_sha256,
        },
        pades_bt: {
          artifact_path: btArtifactPath,
          final_pdf_path: finalPath,
          verification_report_path: verificationReportPath,
          sha256: upgraded.pdfHashAfterSignature,
          promoted_after_verification: true,
          timestamp: timestampPublic,
        },
      },
    };
    const certificationUpdate = await supabase
      .from('document_certifications')
      .update({
        certified_pdf_path: btArtifactPath,
        certified_pdf_sha256: upgraded.pdfHashAfterSignature,
        pades_profile: 'PAdES-B-T',
        pades_byte_range: upgraded.byteRange,
        pades_cms_sha256: upgraded.cmsHashSha256,
        pades_pdf_hash_after_signature: upgraded.pdfHashAfterSignature,
        pades_verification_result: verificationResult,
        pades_verified_at: verifiedAt,
        timestamp_status: 'valid',
        pdf_signature_status: 'valid',
        certificate_status: 'valid',
        verification_status: 'valid',
        provider_metadata: providerMetadata,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq('id', certification.id)
      .eq('lease_owner', leaseOwner)
      .select('id')
      .maybeSingle();
    if (certificationUpdate.error || !certificationUpdate.data) {
      throw new CertificationError(
        'PADES_BT_CERTIFICATION_WRITE_FAILED',
        certificationUpdate.error?.message || 'Se perdió el lease antes de persistir PAdES-B-T.',
        409
      );
    }
    await promoteVerifiedPadesBtDocument(
      supabase,
      input.documentId,
      finalPath,
      upgraded.pdfHashAfterSignature,
      verifiedAt
    );
    return {
      alreadyVerified: false,
      certificationUuid: certification.certification_uuid,
      documentVersionId: certification.document_version_id,
      storagePath: finalPath,
      sha256: upgraded.pdfHashAfterSignature,
      profile: 'PAdES-B-T',
      certificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256!,
      verifiedAt,
      timestamp: timestampPublic,
    };
  } catch (error) {
    await releasePadesBtLease(supabase, certification.id, leaseOwner);
    throw error;
  }
}

export async function integratePadesFinalDocument(
  supabase: SupabaseClient,
  input: FinalDocumentInput & { requiredLevel?: PadesRequiredLevel },
  configuredProviders?: CertificationProviderSet
): Promise<PadesProductResult> {
  const requiredLevel = input.requiredLevel || getRequiredPadesLevel();
  const bb = await integratePadesBbFinalDocument(supabase, input, configuredProviders);
  if (requiredLevel === 'B-B') return bb;
  return upgradePadesBbCertificationToBt(
    supabase,
    { documentId: input.documentId, triggeredBy: input.triggeredBy },
    configuredProviders || createCertificationProviderSet()
  );
}

export async function integratePadesBbFinalDocument(
  supabase: SupabaseClient,
  input: FinalDocumentInput,
  configuredProviders?: CertificationProviderSet
): Promise<PadesBbProductResult> {
  const actualVisualHash = sha256(input.visualPdfBytes);
  if (actualVisualHash !== input.visualPdfSha256 || !SHA256_PATTERN.test(input.visualPdfSha256)) {
    throw new CertificationError(
      'FINAL_VISUAL_PDF_HASH_MISMATCH',
      'La huella del PDF visual final no coincide con sus bytes.',
      409
    );
  }

  const providers = createPadesBbProductProviderSet(configuredProviders);
  const health = await providers.healthCheck();
  if (!health.ready) {
    throw new CertificationError(
      'PADES_PROVIDER_NOT_READY',
      `La infraestructura PAdES-B-B no esta lista: ${unique(health.missing).join(', ') || 'UNKNOWN'}.`,
      503
    );
  }

  const requestedVersionId = documentEncryptionPolicy().enabled ? randomUUID() : null;
  const visualStoragePath = requestedVersionId
    ? `tenants/${input.workspaceId}/documents/${input.documentId}/versions/${requestedVersionId}/visual.enc`
    : `documents-signed/${input.workspaceId}/${input.documentId}/visual/${input.visualPdfSha256}.pdf`;
  const version = await ensureVisualVersion(
    supabase,
    input,
    visualStoragePath,
    requestedVersionId
  );
  try {
    await storeVersionPdf(supabase, {
      tenantId: input.workspaceId,
      documentId: input.documentId,
      documentVersionId: version.id,
      artifactKind: 'visual_pdf',
      storageBucket: DOCUMENT_BUCKET,
      storagePath: visualStoragePath,
      bytes: input.visualPdfBytes,
      sha256: input.visualPdfSha256,
      actorId: input.triggeredBy,
    });
  } catch (error) {
    if (requestedVersionId && version.id === requestedVersionId) {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([visualStoragePath]);
      await supabase
        .from('document_encryption_metadata')
        .delete()
        .eq('document_version_id', version.id)
        .eq('storage_path', visualStoragePath);
      await supabase.from('document_versions').delete().eq('id', version.id);
    }
    throw error;
  }
  await appendFinalizationEvidence(supabase, input, visualStoragePath);

  const idempotencyKey = `pades-bb-${sha256(Buffer.from(`${input.documentId}:${version.id}:${input.visualPdfSha256}`))}`;
  const orchestrator = new CertificationOrchestrator(supabase, providers);
  await orchestrator.execute({
    documentId: input.documentId,
    actorId: input.documentOwnerId,
    idempotencyKey,
    documentVersionId: version.id,
  });

  const certification = await certificationRow(supabase, input.documentId, version.id);
  requireVerifiedPades(certification);

  const certifiedBytes = await readVersionPdf(supabase, {
    storageBucket: CERTIFICATION_BUCKET,
    storagePath: certification.certified_pdf_path!,
    sha256: certification.certified_pdf_sha256,
    actorId: input.triggeredBy,
  });
  const certifiedSha256 = sha256(certifiedBytes);
  if (certifiedSha256 !== certification.certified_pdf_sha256) {
    throw new CertificationError(
      'PADES_CERTIFIED_PDF_HASH_MISMATCH',
      'El PDF PAdES almacenado no coincide con su huella verificada.',
      409
    );
  }

  const finalPath = documentEncryptionPolicy().enabled
    ? `tenants/${input.workspaceId}/documents/${input.documentId}/versions/${version.id}/pades-bb.enc`
    : `documents-signed/${input.workspaceId}/${input.documentId}/pades/${certification.certification_uuid}-${certifiedSha256}.pdf`;
  await storeVersionPdf(supabase, {
    tenantId: input.workspaceId,
    documentId: input.documentId,
    documentVersionId: version.id,
    artifactKind: 'signed_pdf',
    storageBucket: DOCUMENT_BUCKET,
    storagePath: finalPath,
    bytes: certifiedBytes,
    sha256: certifiedSha256,
    actorId: input.triggeredBy,
  });

  const keyHealth = await providers.keyManagement.healthCheck();
  const kmsResource =
    'resourceName' in providers.keyManagement
      ? String((providers.keyManagement as { resourceName?: unknown }).resourceName || '')
      : null;
  const providerMetadata = {
    ...(certification.provider_metadata || {}),
    product_integration: {
      profile: 'PAdES-B-B',
      provider: keyHealth.provider || 'unknown',
      kms_resource: kmsResource,
      key_id: keyHealth.keyId || null,
      key_version: keyHealth.keyVersion || null,
      visual_pdf_path: visualStoragePath,
      visual_pdf_sha256: input.visualPdfSha256,
      final_pdf_path: finalPath,
      final_pdf_sha256: certifiedSha256,
      promoted_after_verification: true,
    },
  };

  const updatedCertification = await supabase
    .from('document_certifications')
    .update({ provider_metadata: providerMetadata })
    .eq('id', certification.id)
    .eq('status', 'COMPLETED')
    .eq('pdf_signature_status', 'valid');
  if (updatedCertification.error) {
    throw new CertificationError(
      'PADES_PROVIDER_METADATA_WRITE_FAILED',
      updatedCertification.error.message,
      500
    );
  }

  const promoted = await supabase
    .from('documentos')
    .update({
      sealed_pdf_path: finalPath,
      sealed_pdf_hash: certifiedSha256,
      sealed_at: certification.pades_verified_at,
    })
    .eq('id', input.documentId)
    .eq('estado', 'completado');
  if (promoted.error) {
    throw new CertificationError('PADES_FINAL_PDF_PROMOTION_FAILED', promoted.error.message, 500);
  }

  return {
    alreadyVerified: false,
    certificationUuid: certification.certification_uuid,
    documentVersionId: version.id,
    storagePath: finalPath,
    sha256: certifiedSha256,
    profile: 'PAdES-B-B',
    certificateFingerprintSha256: certification.pades_certificate_fingerprint_sha256!,
    verifiedAt: certification.pades_verified_at!,
  };
}
