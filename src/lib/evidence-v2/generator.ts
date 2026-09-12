import { randomUUID } from 'node:crypto';
import type { KeyManagementProvider } from '@/lib/certification/key-management';
import {
  buildEvidenceRoot,
  evidenceV2PackageDigest,
  evidenceV2SigningPayload,
  buildEvidenceV2Chain,
} from './canonical';
import type { EvidenceV2BuildInput, EvidenceV2Package, VerificationStatus } from './types';
import { renderAndDigestEvidenceV2Xml, validateEvidenceV2Xml } from './xml';
import { validateEvidenceV2XmlAgainstXsd } from './xsd';

function statusForTimestamps(
  value: EvidenceV2BuildInput['timestamps'],
  type: 'rfc3161' | 'opentimestamps'
): VerificationStatus {
  const matching = value.filter((item) => item.type === type);
  if (!matching.length) return 'not_applicable';
  if (matching.some((item) => item.validationStatus === 'invalid' || item.status === 'failed'))
    return 'invalid';
  if (
    matching.some(
      (item) =>
        item.validationStatus === 'pending' ||
        item.status === 'pending' ||
        item.status === 'pending_bitcoin'
    )
  )
    return 'pending';
  if (matching.every((item) => item.validationStatus === 'valid' && item.artifactHash))
    return 'valid';
  return 'unavailable';
}

export function deriveEvidenceV2Verification(
  input: EvidenceV2BuildInput,
  signatureStatus: VerificationStatus,
  chainStatus: VerificationStatus
): EvidenceV2Package['verification'] {
  const certificates = input.signatures.some((signature) => signature.certificate)
    ? input.signatures.every(
        (signature) => !signature.certificate || signature.certificate.validationStatus === 'valid'
      )
      ? 'valid'
      : input.signatures.some((signature) => signature.certificate?.validationStatus === 'invalid')
        ? 'invalid'
        : 'pending'
    : 'not_applicable';
  const cryptographicSignatures = input.signatures.filter(
    (signature) => signature.method === 'efirma_sat' || signature.method === 'certificado_digital'
  );
  const signatureEvidence: VerificationStatus = !input.signatures.length
    ? 'not_applicable'
    : input.signatures.some((signature) => !signature.signedObjectHash)
      ? 'pending'
      : cryptographicSignatures.some(
            (signature) => signature.cryptographicEvidence?.validationStatus === 'invalid'
          )
        ? 'invalid'
        : cryptographicSignatures.some(
              (signature) =>
                !signature.cryptographicEvidence ||
                signature.cryptographicEvidence.validationStatus !== 'valid'
            )
          ? 'unavailable'
          : 'valid';
  const timestamp = statusForTimestamps(input.timestamps, 'rfc3161');
  const openTimestamps = statusForTimestamps(input.timestamps, 'opentimestamps');
  const nom151 =
    input.nom151.status === 'verified'
      ? input.nom151.constanciaHash && input.nom151.artifactRef
        ? 'valid'
        : 'unavailable'
      : input.nom151.status === 'failed' || input.nom151.status === 'revoked'
        ? 'invalid'
        : input.nom151.status === 'pending' || input.nom151.status === 'issued'
          ? 'pending'
          : 'not_applicable';
  const states = [
    signatureEvidence,
    certificates,
    chainStatus,
    signatureStatus,
    timestamp,
    openTimestamps,
    nom151,
  ];
  const overall = states.includes('invalid')
    ? 'invalid'
    : signatureStatus !== 'valid' || chainStatus !== 'valid'
      ? 'incomplete'
      : states.includes('pending') || states.includes('unavailable')
        ? 'valid_with_pending_certifications'
        : 'valid';
  return {
    documentIntegrity: 'valid',
    participantSignatures: signatureEvidence,
    certificates,
    evidenceChain: chainStatus,
    docuboxSignature: signatureStatus,
    timestamp,
    openTimestamps,
    nom151,
    overall,
  };
}

export async function createEvidenceV2Package(
  input: EvidenceV2BuildInput,
  signer?: KeyManagementProvider | null
) {
  const generatedAt = new Date(input.generatedAt).toISOString();
  const closedAt = new Date(input.closedAt).toISOString();
  const identifiers = {
    evidenceId: input.evidenceId || randomUUID(),
    packageId: input.packageId || randomUUID(),
  };
  const { events, chain } = buildEvidenceV2Chain({
    documentId: input.document.documentId,
    documentVersionId: input.document.versionId,
    events: input.events,
  });
  const unsigned: EvidenceV2Package = {
    ...input,
    ...identifiers,
    generatedAt,
    closedAt,
    version: input.version,
    schemaVersion: input.schemaVersion,
    events,
    chain,
    packageDigest: '',
    docuboxSignature: null,
    verification: deriveEvidenceV2Verification(
      input,
      signer ? 'pending' : 'not_applicable',
      'valid'
    ),
  };
  if (unsigned.schemaVersion === '2.1') {
    unsigned.evidenceRoot = buildEvidenceRoot(unsigned);
    if (!signer) {
      throw new TypeError('Evidence v2.1 requires a KMS-backed EVIDENCE_SEAL signature');
    }
  }
  unsigned.packageDigest = evidenceV2PackageDigest(unsigned);

  if (signer) {
    const payload = evidenceV2SigningPayload(unsigned);
    const signed = await signer.signDigest({
      purpose: 'EVIDENCE_SEAL',
      canonicalBytes: Buffer.from(payload.canonical, 'utf8'),
      digestSha256: payload.digestSha256,
      idempotencyKey: `evidence-v2:${unsigned.packageId}`,
    });
    unsigned.docuboxSignature = {
      algorithm: signed.algorithm,
      keyId: signed.keyId,
      keyVersion: signed.keyVersion,
      publicKeyPem: signed.publicKeyPem,
      publicKeyFingerprintSha256: signed.publicKeyFingerprintSha256,
      signatureBase64: signed.signatureBase64,
      signatureSha256: signed.signatureSha256,
      signedAt: signed.signedAt,
    };
    unsigned.verification = deriveEvidenceV2Verification(input, 'valid', 'valid');
  }
  const rendered = renderAndDigestEvidenceV2Xml(unsigned);
  const schema = validateEvidenceV2Xml(rendered.xml);
  if (!schema.valid)
    throw new TypeError(
      `Evidence v2 XML does not conform to the v2 profile: ${schema.errors.join('; ')}`
    );
  const xsd = await validateEvidenceV2XmlAgainstXsd(rendered.xml);
  if (!xsd.valid)
    throw new TypeError(`Evidence v2 XML does not validate against XSD: ${xsd.errors.join('; ')}`);
  return { package: unsigned, ...rendered };
}
