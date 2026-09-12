import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCertificationProviderSet } from '@/lib/certification/providers';
import { sha256Hex } from '@/lib/certification/canonical';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { createEvidenceV2Package } from './generator';
import { isEvidenceV2KmsSigningEnabled } from './feature-flags';
import { metadataSnapshotDigest } from './canonical';
import { validateEvidenceV21Readiness } from './readiness';
import { registerEvidenceSigningKey, verifyEvidenceSealAgainstRegistry } from './trust-registry';
import type {
  EvidenceNom151,
  EvidenceTimestamp,
  EvidenceV2BuildInput,
  VerificationStatus,
} from './types';

const XML_BUCKET = 'evidence-v2-artifacts';
const CERTIFICATION_BUCKET = 'certification-artifacts';
const EVIDENCE_BUCKET = 'evidence';
const SIGNATURES_BUCKET = 'signatures';
const NOM151_BUCKET = 'nom151-constancias';
const OTS_BUCKET = 'blockchain-evidence';
const SHA256 = /^[a-f0-9]{64}$/i;

interface EvidenceDocumentRow extends Record<string, unknown> {
  estado?: string | null;
  sealed_pdf_hash?: string | null;
  participantes?: unknown;
  metadata?: { pdf_page_count?: number | null } | null;
  origen?: string | null;
  workspace_id?: string | null;
  owner_id?: string | null;
  documento_id?: string | null;
  nombre?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  fecha_completado?: string | null;
  fecha_envio?: string | null;
  file_hash_sha256?: string | null;
}

interface EvidenceCertificationRow extends Record<string, unknown> {
  id: string;
  document_version_id?: string | null;
  document_version?: number | string | null;
  certified_pdf_path: string;
  certified_pdf_sha256?: string | null;
  completed_at?: string | null;
  pades_verified_at?: string | null;
  pades_profile?: string | null;
}

export class EvidenceV2ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500
  ) {
    super(message);
    this.name = 'EvidenceV2ServiceError';
  }
}

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function hashOrNull(value: unknown) {
  const candidate = normalized(value);
  return SHA256.test(candidate) ? candidate : null;
}

function verificationStatus(value: unknown): VerificationStatus {
  const status = normalized(value);
  if (['valid', 'verified', 'good', 'success'].includes(status)) return 'valid';
  if (['invalid', 'revoked', 'failed', 'error'].includes(status)) return 'invalid';
  if (['not_applicable', 'not-applicable'].includes(status)) return 'not_applicable';
  if (['unavailable', 'unknown'].includes(status)) return 'unavailable';
  return 'pending';
}

function optionalMetadataError(error: { message?: string | null; code?: string | null } | null) {
  const detail = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return (
    /document_additional_metadata/.test(detail) &&
    /(does not exist|schema cache|relation|pgrst204)/.test(detail)
  );
}

function participantRef(participant: Record<string, unknown>) {
  const id = String(participant.id || participant.user_id || '').trim();
  if (id) return `participant:${id}`;
  const email = normalized(participant.email);
  return email ? `participant-email-sha256:${sha256Hex(email)}` : 'participant:unresolved';
}

function signatureParticipantRef(
  row: Record<string, unknown>,
  participants: Array<Record<string, unknown>>
) {
  const capturedBy = String(row.captured_by || '').trim();
  const participantRecordId = String(row.participant_record_id || '').trim();
  const participant = participants.find((candidate) => {
    const candidateIds = [candidate.id, candidate.user_id]
      .map((candidateId) => String(candidateId || '').trim())
      .filter(Boolean);
    return (
      (capturedBy && candidateIds.includes(capturedBy)) ||
      (participantRecordId && candidateIds.includes(participantRecordId))
    );
  });
  if (participant) return participantRef(participant);
  if (participantRecordId) return `participant:${participantRecordId}`;
  if (capturedBy) return `participant:${capturedBy}`;
  return 'participant:unresolved';
}

function participantKind(role: unknown) {
  const value = normalized(role);
  if (['signer', 'firmante'].includes(value)) return 'signer' as const;
  if (['approver', 'aprobador'].includes(value)) return 'approver' as const;
  if (['reviewer', 'revisor'].includes(value)) return 'reviewer' as const;
  if (['witness', 'testigo'].includes(value)) return 'witness' as const;
  if (['recipient', 'destinatario'].includes(value)) return 'recipient' as const;
  return 'other' as const;
}

function evidenceMethod(row: Record<string, unknown>) {
  if (row.cert_serial_number || row.cert_rfc) return 'efirma_sat' as const;
  if (normalized(row.evidence_type).includes('biometric')) return 'firma_biometrica' as const;
  if (normalized(row.evidence_type).includes('autograph')) return 'autografa_digital' as const;
  return 'firma_simple' as const;
}

function otsTimestamp(row: Record<string, unknown> | null, fallbackHash: string) {
  if (!row) return null;
  const status = normalized(row.status);
  return {
    type: 'opentimestamps' as const,
    status:
      status === 'verified'
        ? ('verified_bitcoin' as const)
        : status === 'pending_bitcoin' || status === 'anchored' || status === 'submitted'
          ? ('pending_bitcoin' as const)
          : status.includes('failed') || status === 'invalid_proof'
            ? ('failed' as const)
            : ('pending' as const),
    objectType: 'evidence_root' as const,
    objectHash: hashOrNull(row.evidence_hash) || fallbackHash,
    provider: 'OpenTimestamps',
    issuedAt: row.anchored_at ? String(row.anchored_at) : null,
    artifactRef: row.proof_storage_path ? `storage:${String(row.proof_storage_path)}` : null,
    artifactHash: hashOrNull(row.proof_sha256),
    manifestHash: hashOrNull(row.manifest_hash),
    validationStatus:
      status === 'verified'
        ? ('valid' as const)
        : status.includes('failed') || status === 'invalid_proof'
          ? ('invalid' as const)
          : ('pending' as const),
    validatedAt: row.verified_at ? String(row.verified_at) : null,
  } satisfies EvidenceTimestamp;
}

function rfc3161Timestamp(row: Record<string, unknown> | null, fallbackHash: string) {
  if (!row) return null;
  const status = normalized(row.status);
  return {
    type: 'rfc3161' as const,
    status:
      status === 'valid'
        ? ('verified' as const)
        : status === 'invalid'
          ? ('failed' as const)
          : ('pending' as const),
    objectType: 'final_pdf' as const,
    objectHash: hashOrNull(row.message_imprint_sha256) || fallbackHash,
    provider: row.tsa_name ? String(row.tsa_name) : null,
    issuedAt: row.gen_time ? String(row.gen_time) : null,
    serialNumber: row.tsa_serial_number ? String(row.tsa_serial_number) : null,
    policyOid: row.tsa_policy_oid ? String(row.tsa_policy_oid) : null,
    messageImprint: hashOrNull(row.message_imprint_sha256),
    artifactRef: row.token_storage_path ? `storage:${String(row.token_storage_path)}` : null,
    artifactHash: hashOrNull(row.timestamp_token_sha256),
    validationStatus: verificationStatus(row.status),
    validatedAt: row.verified_at ? String(row.verified_at) : null,
  } satisfies EvidenceTimestamp;
}

function nom151Evidence(row: Record<string, unknown> | null): EvidenceNom151 {
  if (!row) return { status: 'not_requested' };
  const issuance = normalized(row.status);
  const verification = normalized(row.verification_status);
  const status: EvidenceNom151['status'] =
    verification === 'verified'
      ? 'verified'
      : issuance === 'issued'
        ? 'issued'
        : issuance === 'failed' || verification === 'failed'
          ? 'failed'
          : 'pending';
  return {
    status,
    requestId: row.id ? String(row.id) : null,
    requestedAt: row.created_at ? String(row.created_at) : null,
    hashSubmitted: hashOrNull(row.document_digest),
    providerName: row.psc_name ? String(row.psc_name) : row.provider ? String(row.provider) : null,
    providerIdentifier: row.provider ? String(row.provider) : null,
    constanciaId: row.folio
      ? String(row.folio)
      : row.operation_id
        ? String(row.operation_id)
        : null,
    issuedAt: row.issued_at ? String(row.issued_at) : null,
    constanciaHash: hashOrNull(row.constancia_sha256),
    serialNumber: row.certificate_serial ? String(row.certificate_serial) : null,
    policy: row.tst_policy_oid ? String(row.tst_policy_oid) : null,
    artifactRef: row.constancia_storage_path
      ? `storage:${String(row.constancia_storage_path)}`
      : row.constancia_path
        ? `storage:${String(row.constancia_path)}`
        : null,
  };
}

type ArtifactInput = {
  artifact_type:
    | 'rfc3161_token'
    | 'opentimestamps_proof'
    | 'nom151_constancia'
    | 'pades_pdf'
    | 'efirma_signature_bundle'
    | 'autograph_signature_image'
    | 'autograph_signature_strokes';
  artifact_status: 'pending' | 'issued' | 'verified' | 'failed';
  object_sha256: string;
  storage_bucket: string;
  storage_path: string;
  provider: string | null;
  issued_at: string | null;
  validated_at: string | null;
  source_table: string;
  source_record_id: string;
  metadata: Record<string, unknown>;
};

async function synchronizeArtifacts(
  service: SupabaseClient,
  packageDatabaseId: string,
  createdBy: string | null,
  rows: ArtifactInput[]
) {
  for (const row of rows) {
    const result = await service.from('evidence_package_artifacts').insert({
      package_id: packageDatabaseId,
      ...row,
      created_by: createdBy,
    });
    if (result.error && result.error.code !== '23505') throw result.error;
  }
}

async function appendPackageClosedEvent(
  service: SupabaseClient,
  input: {
    documentId: string;
    actorId: string | null;
    certificationId: string;
    packageDatabaseId: string;
    evidenceId: string;
    packageId: string;
    finalHash: string;
    rootHash: string;
    packageDigest: string;
    xmlHash: string;
  }
) {
  const { error } = await service.rpc('append_legal_evidence_event', {
    p_document_id: input.documentId,
    p_event_type: 'EVIDENCE_V2_CLOSED',
    p_event_category: 'CERTIFICATION',
    p_event_result: 'SUCCESS',
    p_actor_id: input.actorId,
    p_actor_type: input.actorId ? 'USER' : 'SERVICE',
    p_payload: {
      evidence_id: input.evidenceId,
      package_id: input.packageId,
      evidence_root_sha256: input.rootHash,
      package_digest_sha256: input.packageDigest,
      xml_sha256: input.xmlHash,
    },
    p_document_sha256: input.finalHash,
    p_idempotency_key: `evidence-v2-closed:${input.certificationId}`,
    p_source_system: 'DOCUBOX_EVIDENCE_V2',
    p_source_record_id: input.packageDatabaseId,
  });
  if (error) throw error;
}

async function packageArtifacts(
  certification: Record<string, unknown>,
  timestamp: Record<string, unknown> | null,
  nom151: Record<string, unknown> | null,
  ots: Record<string, unknown> | null,
  finalHash: string,
  signatures: Array<Record<string, unknown>>
) {
  const rows: ArtifactInput[] = [];
  const certificationId = String(certification.id || '');
  const certifiedPath = String(certification.certified_pdf_path || '');
  if (certificationId && certifiedPath) {
    rows.push({
      artifact_type: 'pades_pdf',
      artifact_status: 'verified',
      object_sha256: finalHash,
      storage_bucket: CERTIFICATION_BUCKET,
      storage_path: certifiedPath,
      provider: 'Docubox PAdES',
      issued_at: certification.completed_at ? String(certification.completed_at) : null,
      validated_at: certification.pades_verified_at
        ? String(certification.pades_verified_at)
        : null,
      source_table: 'document_certifications',
      source_record_id: certificationId,
      metadata: { profile: certification.pades_profile || null },
    });
  }
  const timestampHash = hashOrNull(timestamp?.timestamp_token_sha256);
  const timestampPath = String(timestamp?.token_storage_path || '');
  if (timestamp?.id && timestampHash && timestampPath) {
    rows.push({
      artifact_type: 'rfc3161_token',
      artifact_status: normalized(timestamp.status) === 'valid' ? 'verified' : 'pending',
      object_sha256: timestampHash,
      storage_bucket: CERTIFICATION_BUCKET,
      storage_path: timestampPath,
      provider: timestamp.tsa_name ? String(timestamp.tsa_name) : null,
      issued_at: timestamp.gen_time ? String(timestamp.gen_time) : null,
      validated_at: timestamp.verified_at ? String(timestamp.verified_at) : null,
      source_table: 'timestamp_records',
      source_record_id: String(timestamp.id),
      metadata: {
        policy_oid: timestamp.tsa_policy_oid || null,
        serial_number: timestamp.tsa_serial_number || null,
      },
    });
  }
  const nomHash = hashOrNull(nom151?.constancia_sha256);
  const nomPath = String(nom151?.constancia_storage_path || nom151?.constancia_path || '');
  if (nom151?.id && nomHash && nomPath) {
    rows.push({
      artifact_type: 'nom151_constancia',
      artifact_status:
        normalized(nom151.verification_status) === 'verified' ? 'verified' : 'issued',
      object_sha256: nomHash,
      storage_bucket: NOM151_BUCKET,
      storage_path: nomPath,
      provider: nom151.psc_name
        ? String(nom151.psc_name)
        : nom151.provider
          ? String(nom151.provider)
          : null,
      issued_at: nom151.issued_at ? String(nom151.issued_at) : null,
      validated_at: nom151.verified_at ? String(nom151.verified_at) : null,
      source_table: 'nom151_constancias_doc',
      source_record_id: String(nom151.id),
      metadata: {
        environment: nom151.environment || null,
        production_trusted: nom151.production_trusted === true,
      },
    });
  }
  const otsHash = hashOrNull(ots?.proof_sha256);
  const otsPath = String(ots?.proof_storage_path || '');
  if (ots?.id && otsHash && otsPath) {
    rows.push({
      artifact_type: 'opentimestamps_proof',
      artifact_status: normalized(ots.status) === 'verified' ? 'verified' : 'pending',
      object_sha256: otsHash,
      storage_bucket: OTS_BUCKET,
      storage_path: otsPath,
      provider: 'OpenTimestamps',
      issued_at: ots.anchored_at ? String(ots.anchored_at) : null,
      validated_at: ots.verified_at ? String(ots.verified_at) : null,
      source_table: 'document_blockchain_evidence',
      source_record_id: String(ots.id),
      metadata: {
        bitcoin_block_height: ots.bitcoin_block_height || null,
        manifest_hash: hashOrNull(ots.manifest_hash),
      },
    });
  }
  for (const signature of signatures) {
    const bundleHash = hashOrNull(signature.efirma_bundle_sha256);
    const bundlePath = String(signature.efirma_bundle_path || '');
    if (!signature.id || !bundleHash || !bundlePath) continue;
    rows.push({
      artifact_type: 'efirma_signature_bundle',
      artifact_status: 'verified',
      object_sha256: bundleHash,
      storage_bucket: String(signature.bundle_storage_bucket || EVIDENCE_BUCKET),
      storage_path: bundlePath,
      provider: signature.validation_provider ? String(signature.validation_provider) : null,
      issued_at: signature.signed_at
        ? String(signature.signed_at)
        : signature.captured_at
          ? String(signature.captured_at)
          : null,
      validated_at: signature.ocsp_checked_at ? String(signature.ocsp_checked_at) : null,
      source_table: 'signature_evidence',
      source_record_id: String(signature.id),
      metadata: {
        signature_ref: `signature:${String(signature.id)}`,
        signed_payload_sha256: hashOrNull(signature.signed_payload_sha256),
        signature_sha256: hashOrNull(signature.digital_seal_sha256),
        certificate_fingerprint_sha256: hashOrNull(signature.cert_fingerprint_sha256),
        signature_algorithm: signature.sign_algorithm || null,
      },
    });
  }
  for (const signature of signatures) {
    const signatureId = String(signature.id || '');
    if (!signatureId) continue;
    const imageHash = hashOrNull(signature.image_sha256);
    const imagePath = String(signature.storage_image_path || '');
    if (imageHash && imagePath)
      rows.push({
        artifact_type: 'autograph_signature_image',
        artifact_status: 'verified',
        object_sha256: imageHash,
        storage_bucket: String(signature.image_storage_bucket || SIGNATURES_BUCKET),
        storage_path: imagePath,
        provider: 'Docubox signature capture',
        issued_at: signature.captured_at ? String(signature.captured_at) : null,
        validated_at: signature.captured_at ? String(signature.captured_at) : null,
        source_table: 'signature_evidence',
        source_record_id: signatureId,
        metadata: { signature_ref: `signature:${signatureId}` },
      });
    const strokesHash = hashOrNull(signature.strokes_sha256);
    const strokesPath = String(signature.storage_strokes_path || '');
    if (strokesHash && strokesPath)
      rows.push({
        artifact_type: 'autograph_signature_strokes',
        artifact_status: 'verified',
        object_sha256: strokesHash,
        storage_bucket: String(signature.strokes_storage_bucket || EVIDENCE_BUCKET),
        storage_path: strokesPath,
        provider: 'Docubox signature capture',
        issued_at: signature.captured_at ? String(signature.captured_at) : null,
        validated_at: signature.captured_at ? String(signature.captured_at) : null,
        source_table: 'signature_evidence',
        source_record_id: signatureId,
        metadata: { signature_ref: `signature:${signatureId}` },
      });
  }
  return rows;
}

export async function generateEvidenceV2ForDocument(
  service: SupabaseClient,
  input: {
    documentId: string;
    actorId: string | null;
    allowNom151Pending?: boolean;
    onStage?: (stage: 'SIGNING_EVIDENCE' | 'STORING_EVIDENCE') => Promise<void>;
  }
) {
  const documentResult = await service
    .from('documentos')
    .select('*')
    .eq('id', input.documentId)
    .maybeSingle();
  if (documentResult.error) throw documentResult.error;
  const document = documentResult.data as EvidenceDocumentRow | null;
  if (!document)
    throw new EvidenceV2ServiceError(
      'EVIDENCE_V2_DOCUMENT_NOT_FOUND',
      'Documento no encontrado.',
      404
    );
  if (document.estado !== 'completado') {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_V2_DOCUMENT_NOT_CLOSED',
      'El documento debe estar completado para cerrar Evidence Package v2.',
      409
    );
  }

  const certificationResult = await service
    .from('document_certifications')
    .select(
      'id,document_version_id,document_version,certified_pdf_path,certified_pdf_sha256,completed_at,status,execution_status,pades_profile,pdf_signature_status,certificate_status,timestamp_status,verification_status,pades_verified_at,pades_certificate_fingerprint_sha256,source_document_hash,provider_metadata'
    )
    .eq('document_id', input.documentId)
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
  if (certificationResult.error) throw certificationResult.error;
  const certification = certificationResult.data as EvidenceCertificationRow | null;
  if (!certification) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_V2_PADES_BT_REQUIRED',
      'No existe una certificación PAdES-B-T verificada para cerrar el paquete.',
      409
    );
  }
  const finalHash = hashOrNull(certification.certified_pdf_sha256 || document.sealed_pdf_hash);
  if (!finalHash || !certification.certified_pdf_path) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_V2_FINAL_HASH_REQUIRED',
      'No existe una huella SHA-256 del PDF final verificable.',
      409
    );
  }

  const existingResult = await service
    .from('evidence_packages')
    .select(
      'id,evidence_id,package_id,public_verification_token,xml_sha256,xml_storage_path,status,generated_at,closed_at,document_final_sha256,evidence_root_sha256,package_digest_sha256,verification_summary'
    )
    .eq('document_id', input.documentId)
    .eq('evidence_version', '2.1')
    .not('closed_at', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingResult.error) throw existingResult.error;

  const [timestampResult, nom151Result, otsResult, signaturesResult, responsesResult] =
    await Promise.all([
      service
        .from('timestamp_records')
        .select(
          'id,status,message_imprint_sha256,timestamp_token_sha256,gen_time,tsa_name,tsa_policy_oid,tsa_serial_number,token_storage_path,verified_at'
        )
        .eq('document_certification_id', certification.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('nom151_constancias_doc')
        .select(
          'id,status,verification_status,provider,psc_name,environment,production_trusted,operation_id,folio,document_digest,constancia_sha256,constancia_path,constancia_storage_path,issued_at,verified_at,certificate_serial,tst_policy_oid,created_at'
        )
        .eq('documento_id', input.documentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('document_blockchain_evidence')
        .select(
          'id,status,evidence_hash,manifest_hash,proof_sha256,proof_storage_path,anchored_at,verified_at,bitcoin_block_height'
        )
        .eq('document_id', input.documentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      service
        .from('signature_evidence')
        .select(
          'id,capture_id,signature_id,participant_record_id,document_version_id,evidence_role,captured_by,participant_email,evidence_type,image_sha256,strokes_sha256,combined_sha256,storage_image_path,storage_strokes_path,image_storage_bucket,strokes_storage_bucket,captured_at,document_sha256,cert_serial_number,cert_rfc,cert_curp,cert_subject,cert_issuer,cert_not_before,cert_not_after,cert_fingerprint_sha256,ocsp_status,ocsp_checked_at,signed_at,signed_payload_sha256,digital_seal,digital_seal_sha256,digital_seal_path,sign_algorithm,validation_provider,provider_reference,efirma_bundle_path,efirma_bundle_sha256,bundle_storage_bucket,consent_text_version,consent_text_sha256,consent_accepted,consent_accepted_at,ip_address,user_agent,timezone,geo_latitude,geo_longitude,geo_accuracy_m,city,region,country,country_code,device_type,screen_resolution,context_ip_status,context_geo_status,context_user_agent_status'
        )
        .eq('document_id', input.documentId)
        .eq('is_voided', false)
        .order('captured_at', { ascending: true }),
      service
        .from('participation_responses')
        .select(
          'id,participante_id,participant_record_id,participante_email,firma_completada_at,respondido_at,signature_evidence_id,consent_text_version,consent_text_sha256,consent_accepted,consent_accepted_at'
        )
        .eq('documento_id', input.documentId),
    ]);
  for (const result of [
    timestampResult,
    nom151Result,
    otsResult,
    signaturesResult,
    responsesResult,
  ])
    if (result.error) throw result.error;
  const timestamp = timestampResult.data as Record<string, unknown> | null;
  const nom151 = nom151Result.data as Record<string, unknown> | null;
  const ots = otsResult.data as Record<string, unknown> | null;
  const signatures = ((signaturesResult.data || []) as Array<Record<string, unknown>>).filter(
    (row) => row.evidence_role === 'FINAL_SIGNATURE'
  );
  const responses = (responsesResult.data || []) as Array<Record<string, unknown>>;

  if (existingResult.data) {
    if (normalized(existingResult.data.document_final_sha256) !== finalHash) {
      throw new EvidenceV2ServiceError(
        'EVIDENCE_V2_CLOSED_HASH_CONFLICT',
        'Ya existe un paquete v2 cerrado para otra huella final.',
        409
      );
    }
    return { ...existingResult.data, alreadyGenerated: true };
  }

  const verifiedPdf = await readDocumentStorageObject({
    service,
    storageBucket: CERTIFICATION_BUCKET,
    storagePath: certification.certified_pdf_path,
    expectedPlaintextSha256: finalHash,
    userId: input.actorId || undefined,
  });
  const actualFinalHash = sha256Hex(new Uint8Array(verifiedPdf.plaintext));
  new Uint8Array(verifiedPdf.plaintext).fill(0);
  if (actualFinalHash !== finalHash) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_V2_FINAL_PDF_HASH_MISMATCH',
      'El PDF final almacenado no coincide con su huella certificada.',
      409
    );
  }

  await service
    .rpc('append_legal_evidence_event', {
      p_document_id: input.documentId,
      p_event_type: 'EVIDENCE_V2_CLOSING',
      p_event_category: 'CERTIFICATION',
      p_event_result: 'SUCCESS',
      p_actor_id: input.actorId,
      p_actor_type: input.actorId ? 'USER' : 'SERVICE',
      p_payload: { evidence_version: '2.1', document_final_sha256: finalHash },
      p_document_sha256: finalHash,
      p_idempotency_key: `evidence-v2.1-closing:${certification.id}`,
      p_source_system: 'DOCUBOX_EVIDENCE_V2',
      p_source_record_id: certification.id,
    })
    .then(({ error }) => {
      if (error) throw error;
    });

  const [eventsResult, metadataResult, versionResult] = await Promise.all([
    service
      .from('legal_evidence_events')
      .select(
        'event_uuid,sequence_number,event_type,event_category,event_result,event_hash,previous_event_hash,payload_sha256,chain_material,document_sha256,occurred_at,actor_id,actor_type,source_record_id'
      )
      .eq('document_id', input.documentId)
      .order('sequence_number', { ascending: true }),
    service
      .from('document_additional_metadata')
      .select('id,name,data_type,snapshot_value,snapshot_hash,created_at,created_by,metadata_scope')
      .eq('document_id', input.documentId)
      .eq('metadata_scope', 'document')
      .order('created_at', { ascending: true }),
    certification.document_version_id
      ? service
          .from('document_versions')
          .select('id,version_number,sha256,created_at,evidence_version,evidence_schema_version')
          .eq('id', certification.document_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (eventsResult.error || versionResult.error) throw eventsResult.error || versionResult.error;
  if (metadataResult.error && !optionalMetadataError(metadataResult.error))
    throw metadataResult.error;

  const participants = Array.isArray(document.participantes)
    ? (document.participantes as Array<Record<string, unknown>>)
    : [];
  const timestamps = [rfc3161Timestamp(timestamp, finalHash), otsTimestamp(ots, finalHash)].filter(
    Boolean
  ) as EvidenceTimestamp[];
  const nom =
    input.allowNom151Pending && (!nom151 || normalized(nom151.status) === 'failed')
      ? ({ status: 'pending' } satisfies EvidenceNom151)
      : nom151Evidence(nom151);
  const openTimestamp = timestamps.find((item) => item.type === 'opentimestamps');
  const runtimeEnvironment = String(
    process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown'
  ).toUpperCase();
  const nom151EnvironmentTrusted =
    runtimeEnvironment !== 'PRODUCTION' || nom151?.production_trusted === true;
  const externalValid =
    timestamps.some((item) => item.type === 'rfc3161' && item.validationStatus === 'valid') &&
    ['verified', 'pending', 'not_requested'].includes(nom.status) &&
    (nom.status !== 'verified' || nom151EnvironmentTrusted) &&
    (!openTimestamp || Boolean(openTimestamp.artifactHash));
  const signatureEvidenceReady = signatures.every((row) => {
    const method = evidenceMethod(row);
    return (
      row.evidence_role === 'FINAL_SIGNATURE' &&
      Boolean(row.signed_at) &&
      row.consent_accepted === true &&
      Boolean(row.consent_text_version && row.consent_text_sha256 && row.consent_accepted_at) &&
      (method !== 'efirma_sat' || Boolean(row.efirma_bundle_sha256 && row.efirma_bundle_path))
    );
  });
  const generatedAt = new Date().toISOString();
  const closedAt = String(
    certification.completed_at || document.fecha_completado || document.updated_at || generatedAt
  );
  const versionRow = versionResult.data as Record<string, unknown> | null;
  if (!versionRow) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_V2_VERSION_REQUIRED',
      'No existe una versión documental final.',
      409
    );
  }
  if (
    versionRow.evidence_version !== null &&
    versionRow.evidence_version !== undefined &&
    (Number(versionRow.evidence_version) !== 2 ||
      String(versionRow.evidence_schema_version) !== '2.1')
  ) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_VERSION_CONFLICT',
      'La versión documental ya tiene otro contrato de evidencia.',
      409
    );
  }
  const metadata = (metadataResult.error ? [] : metadataResult.data || []).map(
    (item: Record<string, unknown>) => ({
      id: String(item.id),
      key: String(item.name),
      name: String(item.name),
      type: String(item.data_type || 'text'),
      value: ['string', 'number', 'boolean'].includes(typeof item.snapshot_value)
        ? (item.snapshot_value as string | number | boolean)
        : null,
      source: 'user' as const,
      createdByRef: item.created_by ? `user:${String(item.created_by)}` : null,
      recordedAt: item.created_at ? String(item.created_at) : null,
      snapshotHash: hashOrNull(item.snapshot_hash),
    })
  );
  const metadataHash = metadataSnapshotDigest(metadata);
  const policySnapshot = {
    schema: 'docubox-evidence-policy-v1',
    evidence_version: 2,
    schema_version: '2.1',
    nom151: nom.status === 'not_requested' ? 'not_applicable' : 'required_with_pending_supplement',
    opentimestamps: openTimestamp ? 'required_with_pending_upgrade' : 'not_applicable',
    rfc3161: 'required',
  };
  const versionSelection = await service
    .from('document_versions')
    .update({
      evidence_version: 2,
      evidence_schema_version: '2.1',
      evidence_selected_at: generatedAt,
      evidence_policy_snapshot: policySnapshot,
      evidence_policy_sha256: sha256Hex(JSON.stringify(policySnapshot)),
    })
    .eq('id', String(versionRow.id))
    .is('evidence_version', null);
  if (versionSelection.error) throw versionSelection.error;

  const responseForParticipant = (participant: Record<string, unknown>) => {
    const stableIds = [participant.id, participant.user_id]
      .map((value) => String(value || ''))
      .filter(Boolean);
    return responses.find(
      (response) =>
        stableIds.includes(String(response.participant_record_id || '')) ||
        stableIds.includes(String(response.participante_id || ''))
    );
  };
  const packageInput: EvidenceV2BuildInput = {
    evidenceId: randomUUID(),
    packageId: randomUUID(),
    version: '2.1',
    schemaVersion: '2.1',
    generatedAt,
    closedAt,
    environment: runtimeEnvironment,
    platform: 'Docubox',
    platformVersion: String(process.env.npm_package_version || 'unknown'),
    jurisdiction: 'MX',
    workspaceId: document.workspace_id || null,
    organizationId: null,
    status: isEvidenceV2KmsSigningEnabled()
      ? externalValid && signatureEvidenceReady
        ? 'certified'
        : 'partially_certified'
      : 'closed',
    document: {
      documentId: input.documentId,
      externalId: document.documento_id || null,
      name: document.nombre || null,
      fileName: document.file_name || document.nombre || null,
      mimeType: document.file_type || 'application/pdf',
      sizeBytes: document.file_size || null,
      pageCount: document.metadata?.pdf_page_count || null,
      originType:
        document.origen &&
        ['upload', 'template', 'form', 'editor', 'api', 'integration'].includes(document.origen)
          ? (document.origen as 'upload' | 'template' | 'form' | 'editor' | 'api' | 'integration')
          : null,
      createdByRef: document.owner_id ? `user:${document.owner_id}` : null,
      createdAt: document.created_at || null,
      versionId: certification.document_version_id
        ? String(certification.document_version_id)
        : null,
      version: certification.document_version ? Number(certification.document_version) : null,
      originalHash: hashOrNull(document.file_hash_sha256),
      preparedHash: hashOrNull((versionResult.data as Record<string, unknown> | null)?.sha256),
      finalHash,
      preparedAt: (versionResult.data as Record<string, unknown> | null)?.created_at
        ? String((versionResult.data as Record<string, unknown>).created_at)
        : null,
      flowStartedAt: document.fecha_envio || null,
      metadata,
      metadataSnapshotHash: metadataHash,
      extract: null,
      workflow: { status: 'COMPLETED', completedAt: closedAt },
      relations: certification.document_version_id
        ? [{ type: 'document_version', ref: String(certification.document_version_id) }]
        : [],
    },
    participants: participants.map((participant, index) => {
      const response = responseForParticipant(participant);
      const stableId = String(participant.id || participant.user_id || '');
      return {
        participantRef: participantRef(participant),
        firmanteId: stableId || null,
        name: participant.nombre
          ? String(participant.nombre)
          : participant.name
            ? String(participant.name)
            : null,
        email: participant.email ? String(participant.email) : null,
        role: String(participant.rol || participant.role || 'participant'),
        participantType: participantKind(participant.rol || participant.role),
        order: index + 1,
        required:
          participant.required === undefined
            ? participantKind(participant.rol || participant.role) === 'signer'
            : Boolean(participant.required),
        expectedMethod: participant.metodo_firma
          ? String(participant.metodo_firma)
          : participant.signature_method
            ? String(participant.signature_method)
            : null,
        participationStatus: participant.estado ? String(participant.estado) : null,
        invitationAt: participant.fecha_invitacion ? String(participant.fecha_invitacion) : null,
        firstAccessAt: participant.fecha_primer_acceso
          ? String(participant.fecha_primer_acceso)
          : null,
        signedAt: response?.firma_completada_at
          ? String(response.firma_completada_at)
          : response?.respondido_at
            ? String(response.respondido_at)
            : participant.fecha_firma || participant.fecha_participacion
              ? String(participant.fecha_firma || participant.fecha_participacion)
              : null,
      };
    }),
    signatures: signatures.map((row: Record<string, unknown>) => {
      const method = evidenceMethod(row);
      const certificatePresent = Boolean(row.cert_serial_number || row.cert_rfc);
      const response = responses.find(
        (candidate) =>
          String(candidate.signature_evidence_id || '') === String(row.id) ||
          String(candidate.participant_record_id || '') ===
            String(row.participant_record_id || '') ||
          String(candidate.participante_id || '') === String(row.captured_by || '')
      );
      const signedAt = row.signed_at
        ? String(row.signed_at)
        : response?.firma_completada_at
          ? String(response.firma_completada_at)
          : null;
      return {
        signatureRef: `signature:${String(row.signature_id || row.id)}`,
        participantRef: signatureParticipantRef(row, participants),
        participantId: row.participant_record_id ? String(row.participant_record_id) : null,
        documentVersionRef: certification.document_version_id
          ? String(certification.document_version_id)
          : null,
        method,
        signedObjectHash: hashOrNull(row.document_sha256),
        capturedAt: row.signed_at
          ? String(row.signed_at)
          : row.captured_at
            ? String(row.captured_at)
            : null,
        signedAt,
        evidenceRole: 'FINAL_SIGNATURE' as const,
        context: {
          ipStatus: (row.context_ip_status || (row.ip_address ? 'available' : 'unavailable')) as
            'available' | 'unavailable' | 'denied' | 'not_applicable',
          ipAddress: row.ip_address ? String(row.ip_address) : null,
          geolocationStatus: (row.context_geo_status ||
            (row.geo_latitude !== null && row.geo_longitude !== null
              ? 'available'
              : 'unavailable')) as 'available' | 'unavailable' | 'denied' | 'not_applicable',
          latitude:
            row.geo_latitude === null || row.geo_latitude === undefined
              ? null
              : Number(row.geo_latitude),
          longitude:
            row.geo_longitude === null || row.geo_longitude === undefined
              ? null
              : Number(row.geo_longitude),
          accuracyMeters:
            row.geo_accuracy_m === null || row.geo_accuracy_m === undefined
              ? null
              : Number(row.geo_accuracy_m),
          city: row.city ? String(row.city) : null,
          region: row.region ? String(row.region) : null,
          country: row.country ? String(row.country) : null,
          countryCode: row.country_code ? String(row.country_code) : null,
          userAgentStatus: (row.context_user_agent_status ||
            (row.user_agent ? 'available' : 'unavailable')) as
            'available' | 'unavailable' | 'denied' | 'not_applicable',
          userAgent: row.user_agent ? String(row.user_agent) : null,
          deviceInfo: [row.device_type, row.screen_resolution].filter(Boolean).join('; ') || null,
        },
        consent:
          row.consent_text_version && row.consent_text_sha256 && row.consent_accepted_at
            ? {
                textVersion: String(row.consent_text_version),
                textHash: String(row.consent_text_sha256),
                accepted: row.consent_accepted === true,
                acceptedAt: String(row.consent_accepted_at),
              }
            : undefined,
        autograph:
          method === 'autografa_digital'
            ? {
                captureId: row.capture_id ? String(row.capture_id) : null,
                strokesHash: hashOrNull(row.strokes_sha256),
                imageHash: hashOrNull(row.image_sha256),
                combinedHash: hashOrNull(row.combined_sha256),
                evidenceObjectId: `signature:${String(row.id)}`,
                imageArtifactRef: row.storage_image_path
                  ? `storage:${SIGNATURES_BUCKET}/${String(row.storage_image_path)}`
                  : null,
                strokesArtifactRef: row.storage_strokes_path
                  ? `storage:${EVIDENCE_BUCKET}/${String(row.storage_strokes_path)}`
                  : null,
              }
            : undefined,
        certificate: certificatePresent
          ? {
              serialNumber: row.cert_serial_number ? String(row.cert_serial_number) : null,
              rfc: row.cert_rfc ? String(row.cert_rfc) : null,
              curp: row.cert_curp ? String(row.cert_curp) : null,
              subject: row.cert_subject ? String(row.cert_subject) : null,
              issuer: row.cert_issuer ? String(row.cert_issuer) : null,
              validFrom: row.cert_not_before ? String(row.cert_not_before) : null,
              validTo: row.cert_not_after ? String(row.cert_not_after) : null,
              fingerprintSha256: hashOrNull(row.cert_fingerprint_sha256),
              validationStatus: verificationStatus(row.ocsp_status),
            }
          : undefined,
        cryptographicEvidence:
          method === 'efirma_sat'
            ? {
                signatureValue: row.digital_seal ? String(row.digital_seal) : null,
                signedPayloadHash: hashOrNull(row.signed_payload_sha256),
                signatureHash: hashOrNull(row.digital_seal_sha256),
                signatureAlgorithm: row.sign_algorithm ? String(row.sign_algorithm) : null,
                artifactRef: row.efirma_bundle_sha256
                  ? `artifact:efirma-bundle:${String(row.id)}`
                  : null,
                artifactHash: hashOrNull(row.efirma_bundle_sha256),
                validationStatus:
                  row.efirma_bundle_sha256 && row.efirma_bundle_path
                    ? verificationStatus(row.ocsp_status)
                    : 'unavailable',
                validationProvider: row.validation_provider
                  ? String(row.validation_provider)
                  : null,
                validatedAt: row.ocsp_checked_at ? String(row.ocsp_checked_at) : null,
              }
            : undefined,
      };
    }),
    events: (eventsResult.data || []).map((event: Record<string, unknown>) => ({
      eventId: String(event.event_uuid),
      sequence: Number(event.sequence_number),
      type: String(event.event_type),
      result: String(event.event_result),
      occurredAt: String(event.occurred_at),
      actorRef: event.actor_id ? `user:${String(event.actor_id)}` : null,
      objectRef: event.source_record_id
        ? `record:${String(event.source_record_id)}`
        : `document:${input.documentId}`,
      eventCategory: event.event_category ? String(event.event_category) : null,
      actorType: event.actor_type ? String(event.actor_type) : null,
      documentHash: hashOrNull(event.document_sha256),
      payloadHash: hashOrNull(event.payload_sha256),
      chainMaterial: event.chain_material ? String(event.chain_material) : null,
      previousSourceHash: hashOrNull(event.previous_event_hash) || '0'.repeat(64),
      sourceEventHash: hashOrNull(event.event_hash),
    })),
    timestamps,
    nom151: nom,
  };

  if (!isEvidenceV2KmsSigningEnabled()) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_SEAL_KMS_NOT_ENABLED',
      'La firma KMS dedicada EVIDENCE_SEAL no está habilitada para Evidence V2.1.',
      503
    );
  }
  const signer = createCertificationProviderSet().keyManagement;
  await input.onStage?.('SIGNING_EVIDENCE');
  const built = await createEvidenceV2Package(packageInput, signer);
  const readiness = validateEvidenceV21Readiness(built.package, { requireSeal: true });
  if (readiness.status !== 'READY') {
    throw new EvidenceV2ServiceError(
      `EVIDENCE_V2_${readiness.status}`,
      `Evidence V2.1 no está listo: ${readiness.codes.join(', ')}`,
      readiness.status === 'ERROR' ? 422 : 409
    );
  }
  await registerEvidenceSigningKey(service, built.package.docuboxSignature!);
  if (!(await verifyEvidenceSealAgainstRegistry(service, built.package))) {
    throw new EvidenceV2ServiceError(
      'EVIDENCE_SEAL_UNTRUSTED',
      'El sello de evidencia no coincide con el registro de confianza.',
      422
    );
  }
  await input.onStage?.('STORING_EVIDENCE');
  const storagePath = `${document.workspace_id || document.owner_id}/${input.documentId}/${packageInput.document.versionId || 'legacy'}/evidence-v2/${built.package.packageId}/evidence.xml`;
  const upload = await service.storage
    .from(XML_BUCKET)
    .upload(storagePath, Buffer.from(built.xml, 'utf8'), {
      contentType: 'application/xml',
      upsert: false,
    });
  if (upload.error) throw upload.error;
  const readBack = await service.storage.from(XML_BUCKET).download(storagePath);
  if (readBack.error) {
    await service.storage.from(XML_BUCKET).remove([storagePath]);
    throw readBack.error;
  }
  const persistedXmlHash = sha256Hex(new Uint8Array(await readBack.data.arrayBuffer()));
  if (persistedXmlHash !== built.xmlSha256) {
    await service.storage.from(XML_BUCKET).remove([storagePath]);
    throw new EvidenceV2ServiceError(
      'EVIDENCE_XML_READBACK_HASH_MISMATCH',
      'El XML persistido no superó la verificación de lectura.',
      500
    );
  }
  const insert = await service
    .from('evidence_packages')
    .insert({
      evidence_id: built.package.evidenceId,
      package_id: built.package.packageId,
      tenant_id: document.workspace_id || document.owner_id,
      workspace_id: document.workspace_id || null,
      document_id: input.documentId,
      document_version_id: packageInput.document.versionId,
      source_certification_id: certification.id,
      evidence_version: '2.1',
      schema_version: '2.1',
      canonicalization_version: 'docubox-evidence-root-v2.1',
      status: 'closing',
      document_final_sha256: finalHash,
      evidence_root_sha256: built.package.evidenceRoot!.value,
      package_digest_sha256: built.package.packageDigest,
      xml_sha256: built.xmlSha256,
      xml_storage_bucket: XML_BUCKET,
      xml_storage_path: storagePath,
      docubox_signature: built.package.docuboxSignature,
      verification_summary: built.package.verification,
      generated_at: built.package.generatedAt,
      closed_at: null,
      created_by: input.actorId,
    })
    .select(
      'id,evidence_id,package_id,public_verification_token,xml_sha256,xml_storage_path,status,generated_at,closed_at,document_final_sha256,verification_summary'
    )
    .single();
  if (insert.error) {
    await service.storage.from(XML_BUCKET).remove([storagePath]);
    throw insert.error;
  }
  await synchronizeArtifacts(
    service,
    insert.data.id,
    input.actorId,
    await packageArtifacts(certification, timestamp, nom151, ots, finalHash, signatures)
  );
  const closeResult = await service
    .from('evidence_packages')
    .update({
      status: built.package.status,
      closed_at: built.package.closedAt,
      verification_summary: { ...built.package.verification, readiness },
    })
    .eq('id', insert.data.id)
    .is('closed_at', null)
    .select(
      'id,evidence_id,package_id,public_verification_token,xml_sha256,xml_storage_path,status,generated_at,closed_at,document_final_sha256,verification_summary'
    )
    .single();
  if (closeResult.error) throw closeResult.error;
  await appendPackageClosedEvent(service, {
    documentId: input.documentId,
    actorId: input.actorId,
    certificationId: String(certification.id),
    packageDatabaseId: String(insert.data.id),
    evidenceId: built.package.evidenceId,
    packageId: built.package.packageId,
    finalHash,
    rootHash: built.package.evidenceRoot!.value,
    packageDigest: built.package.packageDigest,
    xmlHash: built.xmlSha256,
  });
  return { ...closeResult.data, alreadyGenerated: false, readiness };
}

export async function getEvidenceV2ForDocument(service: SupabaseClient, documentId: string) {
  const result = await service
    .from('evidence_packages')
    .select(
      'id,evidence_id,package_id,public_verification_token,evidence_version,schema_version,status,source_certification_id,document_final_sha256,evidence_root_sha256,package_digest_sha256,xml_sha256,xml_storage_bucket,xml_storage_path,generated_at,closed_at,verification_summary'
    )
    .eq('document_id', documentId)
    .in('evidence_version', ['2.0', '2.1'])
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  const artifacts = await service
    .from('evidence_package_artifacts')
    .select(
      'id,artifact_type,artifact_status,object_sha256,storage_bucket,storage_path,provider,issued_at,validated_at,metadata,created_at'
    )
    .eq('package_id', result.data.id)
    .order('created_at', { ascending: true });
  if (artifacts.error) throw artifacts.error;
  return { ...result.data, artifacts: artifacts.data || [] };
}

export async function getManagementSnapshot(service: SupabaseClient, documentId: string) {
  const result = await service
    .from('document_additional_metadata')
    .select('id,name,data_type,value_json,value_display,created_by,created_at,updated_at')
    .eq('document_id', documentId)
    .eq('metadata_scope', 'management')
    .order('created_at', { ascending: true });
  if (result.error && !optionalMetadataError(result.error)) throw result.error;
  return {
    nature: 'administrative',
    affectsDocumentIntegrity: false,
    generatedAt: new Date().toISOString(),
    metadata: result.error ? [] : result.data || [],
  };
}
