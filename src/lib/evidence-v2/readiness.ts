import { buildEvidenceRoot, metadataSnapshotDigest, verifyEvidenceV2Chain } from './canonical';
import { SIGNATURE_CONSENT_SHA256, SIGNATURE_CONSENT_VERSION } from './consent';
import type { EvidenceV2Package } from './types';

export type EvidenceReadiness = {
  status: 'READY' | 'NOT_READY' | 'ERROR';
  codes: string[];
  pendingSupplements: Array<'NOM151' | 'OPENTIMESTAMPS'>;
};

const SHA256 = /^[a-f0-9]{64}$/;

export function validateEvidenceV21Readiness(
  value: EvidenceV2Package,
  options: { requireSeal?: boolean } = {}
): EvidenceReadiness {
  const missing: string[] = [];
  const errors: string[] = [];
  const pendingSupplements: EvidenceReadiness['pendingSupplements'] = [];
  if (value.schemaVersion !== '2.1') errors.push('SCHEMA_VERSION_UNSUPPORTED');
  if (!value.document.versionId) missing.push('DOCUMENT_VERSION_ID_MISSING');
  if (!SHA256.test(value.document.finalHash)) errors.push('DOCUMENT_FINAL_HASH_INVALID');
  const metadataHash = metadataSnapshotDigest(value.document.metadata);
  if (value.document.metadataSnapshotHash !== metadataHash)
    errors.push('METADATA_SNAPSHOT_HASH_MISMATCH');
  if (!value.participants.length) missing.push('PARTICIPANTS_MISSING');

  for (const participant of value.participants) {
    if (!participant.participantRef || !participant.firmanteId)
      errors.push('PARTICIPANT_STABLE_ID_MISSING');
    if (participant.required && participant.participantType === 'signer' && !participant.signedAt)
      missing.push('PARTICIPANT_SIGNED_AT_MISSING');
    if (
      participant.required &&
      participant.participantType === 'signer' &&
      !value.signatures.some((signature) => signature.participantRef === participant.participantRef)
    )
      missing.push('PARTICIPANT_FINAL_SIGNATURE_MISSING');
  }
  for (const signature of value.signatures) {
    if (
      !signature.signatureRef ||
      !signature.participantRef ||
      !signature.documentVersionRef ||
      !signature.signedAt ||
      !signature.signedObjectHash
    )
      missing.push('FINAL_SIGNATURE_BINDING_INCOMPLETE');
    if (signature.evidenceRole !== 'FINAL_SIGNATURE') errors.push('NON_FINAL_SIGNATURE_INCLUDED');
    if (
      !signature.consent ||
      !signature.consent.accepted ||
      signature.consent.textVersion !== SIGNATURE_CONSENT_VERSION ||
      signature.consent.textHash !== SIGNATURE_CONSENT_SHA256 ||
      !signature.consent.acceptedAt
    )
      missing.push('CONSENT_SNAPSHOT_INCOMPLETE');
    if (
      signature.method === 'autografa_digital' &&
      (!signature.autograph?.captureId ||
        !signature.autograph.imageHash ||
        !signature.autograph.strokesHash ||
        !signature.autograph.combinedHash ||
        !signature.autograph.imageArtifactRef ||
        !signature.autograph.strokesArtifactRef)
    )
      missing.push('AUTOGRAPH_EVIDENCE_NOT_CONSOLIDATED');
    if (
      signature.method === 'efirma_sat' &&
      (!signature.cryptographicEvidence?.signatureValue ||
        !signature.cryptographicEvidence.signedPayloadHash ||
        !signature.cryptographicEvidence.signatureHash ||
        !signature.cryptographicEvidence.artifactHash ||
        signature.cryptographicEvidence.validationStatus !== 'valid' ||
        !signature.certificate?.fingerprintSha256)
    )
      missing.push('EFIRMA_FINAL_SIGNATURE_INCOMPLETE');
  }
  try {
    if (!verifyEvidenceV2Chain(value.events, value.chain)) errors.push('LEGAL_EVENT_CHAIN_INVALID');
  } catch {
    errors.push('LEGAL_EVENT_CHAIN_INVALID');
  }
  const rfc3161 = value.timestamps.find((stamp) => stamp.type === 'rfc3161');
  if (!rfc3161 || rfc3161.validationStatus !== 'valid' || !rfc3161.artifactHash)
    missing.push('RFC3161_NOT_VERIFIED');
  const ots = value.timestamps.find((stamp) => stamp.type === 'opentimestamps');
  if (ots && (!ots.artifactHash || ots.status === 'pending'))
    missing.push('OTS_INITIAL_STAMP_MISSING');
  if (ots?.status === 'pending_bitcoin') pendingSupplements.push('OPENTIMESTAMPS');
  if (value.nom151.status === 'pending') pendingSupplements.push('NOM151');
  if (['failed', 'revoked'].includes(value.nom151.status)) errors.push('NOM151_INVALID');

  if (value.evidenceRoot) {
    const expected = buildEvidenceRoot(value);
    if (expected.value !== value.evidenceRoot.value) errors.push('EVIDENCE_ROOT_MISMATCH');
  } else if (options.requireSeal) missing.push('EVIDENCE_ROOT_MISSING');
  if (options.requireSeal && !value.docuboxSignature) missing.push('EVIDENCE_SEAL_MISSING');

  return errors.length
    ? { status: 'ERROR', codes: [...new Set([...errors, ...missing])], pendingSupplements }
    : missing.length
      ? { status: 'NOT_READY', codes: [...new Set(missing)], pendingSupplements }
      : { status: 'READY', codes: [], pendingSupplements };
}
