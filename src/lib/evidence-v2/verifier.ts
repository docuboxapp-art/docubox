import { constants, createPublicKey, verify, X509Certificate } from 'node:crypto';
import { sha256Hex } from '@/lib/certification/canonical';
import {
  buildEvidenceV2Chain,
  evidenceV2LegacyPackageDigest,
  evidenceV2PackageDigest,
  evidenceV2SigningPayload,
} from './canonical';
import { parseEvidenceV2Xml } from './parser';
import { deriveEvidenceV2Verification } from './generator';
import type { EvidenceV2Package } from './types';
import { validateEvidenceV2Xml } from './xml';
import { validateEvidenceV2XmlAgainstXsd } from './xsd';

const SHA256 = /^[a-f0-9]{64}$/i;

function text(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)<\\/${name}>`));
  return match?.[1]?.trim() || null;
}

export type EvidenceV2Verification = {
  valid: boolean;
  overall: 'valid' | 'valid_with_pending_certifications' | 'invalid' | 'incomplete';
  xmlIntegrity: 'valid' | 'invalid';
  packageIntegrity: 'valid' | 'invalid';
  chainIntegrity: 'valid' | 'invalid';
  docuboxSignature: 'valid' | 'invalid' | 'not_applied';
  documentIntegrity?: 'valid' | 'invalid' | 'not_checked';
  schema?: 'valid' | 'invalid';
  artifacts?: Array<{ type: string; integrity: 'valid' | 'invalid' }>;
  certifications: {
    rfc3161: string;
    openTimestamps: string;
    nom151: string;
  };
  pades?: 'valid' | 'invalid' | 'unavailable' | 'not_checked';
  efirma?: 'valid' | 'invalid' | 'unavailable' | 'not_applicable';
  errors: string[];
};

function invalidResult(errors: string[]): EvidenceV2Verification {
  return {
    valid: false,
    overall: 'invalid',
    xmlIntegrity: 'invalid',
    packageIntegrity: 'invalid',
    chainIntegrity: 'invalid',
    docuboxSignature: 'invalid',
    certifications: {
      rfc3161: 'unavailable',
      openTimestamps: 'unavailable',
      nom151: 'unavailable',
    },
    errors,
  };
}

function verifyChain(value: EvidenceV2Package) {
  try {
    const rebuilt = buildEvidenceV2Chain({
      documentId: value.document.documentId,
      documentVersionId: value.document.versionId,
      events: value.events.map((event) => ({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        result: event.result,
        occurredAt: event.occurredAt,
        actorRef: event.actorRef,
        objectRef: event.objectRef,
        sourceEventHash: event.sourceEventHash,
      })),
    });
    return (
      rebuilt.chain.genesisHash === value.chain.genesisHash &&
      rebuilt.chain.rootHash === value.chain.rootHash &&
      rebuilt.chain.totalEvents === value.chain.totalEvents &&
      rebuilt.events.every((event, index) => {
        const declared = value.events[index];
        return (
          declared &&
          event.canonicalHash === declared.canonicalHash &&
          event.previousHash === declared.previousHash &&
          event.chainedHash === declared.chainedHash
        );
      })
    );
  } catch {
    return false;
  }
}

function verifyDocuboxSignature(value: EvidenceV2Package, packageIntegrity: boolean) {
  const signature = value.docuboxSignature;
  if (!signature) return 'not_applied' as const;
  try {
    if (!packageIntegrity || !SHA256.test(signature.signatureSha256)) return 'invalid' as const;
    const signatureBytes = Buffer.from(signature.signatureBase64, 'base64');
    if (sha256Hex(signatureBytes) !== signature.signatureSha256.toLowerCase())
      return 'invalid' as const;
    if (sha256Hex(signature.publicKeyPem) !== signature.publicKeyFingerprintSha256.toLowerCase())
      return 'invalid' as const;
    const payload = evidenceV2SigningPayload(value);
    const publicKey = createPublicKey(signature.publicKeyPem);
    const valid =
      signature.algorithm === 'RSA-PSS-SHA256'
        ? verify(
            'sha256',
            Buffer.from(payload.canonical, 'utf8'),
            {
              key: publicKey,
              padding: constants.RSA_PKCS1_PSS_PADDING,
              saltLength: 32,
            },
            signatureBytes
          )
        : signature.algorithm === 'RSA-PKCS1-SHA256'
          ? verify(
              'sha256',
              Buffer.from(payload.canonical, 'utf8'),
              {
                key: publicKey,
                padding: constants.RSA_PKCS1_PADDING,
              },
              signatureBytes
            )
          : false;
    return valid ? ('valid' as const) : ('invalid' as const);
  } catch {
    return 'invalid' as const;
  }
}

export function verifyEvidenceV2Xml(xml: string): EvidenceV2Verification {
  const errors = [...validateEvidenceV2Xml(xml).errors];
  let value: EvidenceV2Package;
  try {
    value = parseEvidenceV2Xml(xml);
  } catch {
    return invalidResult([...errors, 'Evidence XML is not well formed']);
  }

  const storedXmlHash = text(xml, 'HashXML');
  const canonicalXml = xml.replace(/(<HashXML[^>]*>)[^<]*(<\/HashXML>)/, '$1$2');
  const xmlIntegrity =
    storedXmlHash &&
    SHA256.test(storedXmlHash) &&
    sha256Hex(canonicalXml) === storedXmlHash.toLowerCase()
      ? ('valid' as const)
      : ('invalid' as const);
  if (xmlIntegrity === 'invalid') errors.push('XML digest does not match the serialized package');

  let packageIntegrity = 'invalid' as 'valid' | 'invalid';
  try {
    packageIntegrity = [
      evidenceV2PackageDigest(value),
      evidenceV2LegacyPackageDigest(value),
    ].includes(value.packageDigest.toLowerCase())
      ? 'valid'
      : 'invalid';
  } catch {
    packageIntegrity = 'invalid';
  }
  if (packageIntegrity === 'invalid')
    errors.push('EvidencePackageDigest does not match the XML semantic content');

  const chainIntegrity = verifyChain(value) ? ('valid' as const) : ('invalid' as const);
  if (chainIntegrity === 'invalid')
    errors.push('Evidence events do not match the declared chain and RootHash');

  const docuboxSignature = verifyDocuboxSignature(
    value,
    packageIntegrity === 'valid' && chainIntegrity === 'valid'
  );
  if (docuboxSignature === 'invalid') errors.push('Docubox KMS signature verification failed');

  const derived = deriveEvidenceV2Verification(
    value,
    docuboxSignature === 'valid'
      ? 'valid'
      : docuboxSignature === 'invalid'
        ? 'invalid'
        : 'not_applicable',
    chainIntegrity
  );
  const declaredMatches = Object.entries(derived).every(
    ([key, state]) => value.verification[key as keyof EvidenceV2Package['verification']] === state
  );
  if (!declaredMatches)
    errors.push('Declared verification summary does not match independently derived evidence');
  const externalStates = [
    derived.timestamp,
    derived.openTimestamps,
    derived.nom151,
    derived.certificates,
    derived.participantSignatures,
  ];
  const invalid =
    xmlIntegrity === 'invalid' ||
    packageIntegrity === 'invalid' ||
    chainIntegrity === 'invalid' ||
    docuboxSignature === 'invalid' ||
    !declaredMatches ||
    externalStates.includes('invalid');
  const overall = invalid
    ? ('invalid' as const)
    : docuboxSignature !== 'valid'
      ? ('incomplete' as const)
      : externalStates.some((state) => state === 'pending' || state === 'unavailable')
        ? ('valid_with_pending_certifications' as const)
        : ('valid' as const);
  return {
    valid: errors.length === 0 && overall !== 'incomplete',
    overall,
    xmlIntegrity,
    packageIntegrity,
    chainIntegrity,
    docuboxSignature,
    certifications: {
      rfc3161: derived.timestamp,
      openTimestamps: derived.openTimestamps,
      nom151: derived.nom151,
    },
    errors: [...new Set(errors)],
  };
}

export async function verifyEvidenceV2Package(input: {
  xml: string;
  pdfBytes?: Uint8Array | null;
  artifacts?: Array<{
    type: string;
    bytes: Uint8Array;
    expectedSha256: string;
    metadata?: Record<string, unknown>;
  }>;
  padesVerifier?: (pdfBytes: Uint8Array) => Promise<{
    valid: boolean;
    profile?: string | null;
    timestamp?: { valid?: boolean } | null;
  }>;
  externalVerifiers?: {
    rfc3161?: (
      bytes: Uint8Array,
      expectedDigest: string | null
    ) => Promise<'valid' | 'invalid' | 'unavailable'>;
    openTimestamps?: (
      bytes: Uint8Array,
      manifestHash: string | null
    ) => Promise<'valid' | 'pending' | 'invalid' | 'unavailable'>;
    nom151?: (
      bytes: Uint8Array,
      pdfBytes: Uint8Array,
      documentHash: string
    ) => Promise<'valid' | 'invalid' | 'unavailable'>;
  };
}) {
  const base = verifyEvidenceV2Xml(input.xml);
  const xsd = await validateEvidenceV2XmlAgainstXsd(input.xml);
  const errors = [...base.errors, ...xsd.errors.map((error) => `XSD: ${error}`)];
  let finalHash: string | null = null;
  try {
    finalHash = parseEvidenceV2Xml(input.xml).document.finalHash;
  } catch {
    // The base verifier already records malformed XML.
  }
  const documentIntegrity = input.pdfBytes
    ? finalHash && SHA256.test(finalHash) && sha256Hex(input.pdfBytes) === finalHash.toLowerCase()
      ? ('valid' as const)
      : ('invalid' as const)
    : ('not_checked' as const);
  if (documentIntegrity === 'invalid') errors.push('PDF SHA-256 does not match HashFinal');

  const artifacts = (input.artifacts || []).map((artifact) => {
    const expected = String(artifact.expectedSha256 || '').toLowerCase();
    const integrity =
      SHA256.test(expected) && sha256Hex(artifact.bytes) === expected
        ? ('valid' as const)
        : ('invalid' as const);
    if (integrity === 'invalid')
      errors.push(`${artifact.type} SHA-256 does not match its manifest`);
    return { type: artifact.type, integrity };
  });
  let parsed: EvidenceV2Package | null = null;
  try {
    parsed = parseEvidenceV2Xml(input.xml);
  } catch {
    // The base verifier already records malformed XML.
  }
  let artifactBindingInvalid = false;
  for (const artifact of input.artifacts || []) {
    let semanticHash: string | null = null;
    const recognized = [
      'pades_pdf',
      'rfc3161_token',
      'opentimestamps_proof',
      'nom151_constancia',
      'efirma_signature_bundle',
      'autograph_signature_image',
      'autograph_signature_strokes',
    ].includes(artifact.type);
    if (artifact.type === 'pades_pdf') semanticHash = parsed?.document.finalHash || null;
    if (artifact.type === 'rfc3161_token')
      semanticHash =
        parsed?.timestamps.find((item) => item.type === 'rfc3161')?.artifactHash || null;
    if (artifact.type === 'opentimestamps_proof')
      semanticHash =
        parsed?.timestamps.find((item) => item.type === 'opentimestamps')?.artifactHash || null;
    if (artifact.type === 'nom151_constancia') semanticHash = parsed?.nom151.constanciaHash || null;
    if (artifact.type === 'efirma_signature_bundle') {
      const signatureRef = String(artifact.metadata?.signature_ref || '');
      semanticHash =
        parsed?.signatures.find((item) => item.signatureRef === signatureRef)?.cryptographicEvidence
          ?.artifactHash || null;
    }
    if (
      artifact.type === 'autograph_signature_image' ||
      artifact.type === 'autograph_signature_strokes'
    ) {
      const signatureRef = String(artifact.metadata?.signature_ref || '');
      const autograph = parsed?.signatures.find(
        (item) => item.signatureRef === signatureRef
      )?.autograph;
      semanticHash =
        artifact.type === 'autograph_signature_image'
          ? autograph?.imageHash || null
          : autograph?.strokesHash || null;
    }
    const externallyBoundOpenTimestamp =
      artifact.type === 'opentimestamps_proof' &&
      !semanticHash &&
      Boolean(parsed?.timestamps.find((item) => item.type === 'opentimestamps')?.manifestHash);
    if (
      recognized &&
      !externallyBoundOpenTimestamp &&
      semanticHash !== String(artifact.expectedSha256 || '').toLowerCase()
    ) {
      artifactBindingInvalid = true;
      errors.push(`${artifact.type} is not bound to the immutable XML digest`);
    }
  }
  let pades: EvidenceV2Verification['pades'] = 'not_checked';
  if (input.pdfBytes && input.padesVerifier) {
    try {
      const checked = await input.padesVerifier(input.pdfBytes);
      pades =
        checked.valid && checked.profile === 'PAdES-B-T' && checked.timestamp?.valid === true
          ? 'valid'
          : 'invalid';
    } catch {
      pades = 'unavailable';
    }
    if (pades === 'invalid')
      errors.push('The final PDF did not pass independent PAdES-B-T verification');
    if (pades === 'unavailable') errors.push('Independent PAdES-B-T verification is unavailable');
  }
  const efirmaSignatures =
    parsed?.signatures.filter(
      (signature) => signature.method === 'efirma_sat' || signature.method === 'certificado_digital'
    ) || [];
  let efirma: EvidenceV2Verification['efirma'] = efirmaSignatures.length
    ? 'unavailable'
    : 'not_applicable';
  if (efirmaSignatures.length) {
    const bundleArtifacts = (input.artifacts || []).filter(
      (artifact) => artifact.type === 'efirma_signature_bundle'
    );
    const results = efirmaSignatures.map((signature) => {
      const bundle = bundleArtifacts.find((artifact) => {
        const signatureRef = String(artifact.metadata?.signature_ref || '');
        return (
          signatureRef === signature.signatureRef ||
          (signature.cryptographicEvidence?.signatureHash &&
            artifact.metadata?.signature_sha256 === signature.cryptographicEvidence.signatureHash)
        );
      });
      return bundle ? verifyEfirmaBundle(bundle.bytes, signature) : null;
    });
    efirma = results.some((result) => result === false)
      ? 'invalid'
      : results.every((result) => result === true)
        ? 'valid'
        : 'unavailable';
    if (efirma === 'invalid')
      errors.push('An e.firma evidence bundle failed cryptographic verification');
    if (efirma === 'unavailable')
      errors.push('An e.firma signature lacks an independently verifiable evidence bundle');
  }
  const certifications = { ...base.certifications };
  const rfcArtifact = (input.artifacts || []).find((artifact) => artifact.type === 'rfc3161_token');
  const otsArtifact = (input.artifacts || []).find(
    (artifact) => artifact.type === 'opentimestamps_proof'
  );
  const nomArtifact = (input.artifacts || []).find(
    (artifact) => artifact.type === 'nom151_constancia'
  );
  const [rfcResult, otsResult, nomResult] = await Promise.all([
    rfcArtifact && input.externalVerifiers?.rfc3161
      ? input.externalVerifiers
          .rfc3161(
            rfcArtifact.bytes,
            parsed?.timestamps.find((item) => item.type === 'rfc3161')?.messageImprint || null
          )
          .catch(() => 'unavailable' as const)
      : Promise.resolve(null),
    otsArtifact && input.externalVerifiers?.openTimestamps
      ? input.externalVerifiers
          .openTimestamps(
            otsArtifact.bytes,
            parsed?.timestamps.find((item) => item.type === 'opentimestamps')?.manifestHash || null
          )
          .catch(() => 'unavailable' as const)
      : Promise.resolve(null),
    nomArtifact && input.pdfBytes && input.externalVerifiers?.nom151 && parsed
      ? input.externalVerifiers
          .nom151(nomArtifact.bytes, input.pdfBytes, parsed.document.finalHash)
          .catch(() => 'unavailable' as const)
      : Promise.resolve(null),
  ]);
  if (rfcResult) certifications.rfc3161 = rfcResult;
  if (otsResult) certifications.openTimestamps = otsResult;
  if (nomResult) certifications.nom151 = nomResult;
  for (const [name, state] of Object.entries(certifications)) {
    if (state === 'invalid') errors.push(`${name} failed independent verification`);
    if (state === 'unavailable') errors.push(`${name} independent verification is unavailable`);
  }
  const invalid =
    base.overall === 'invalid' ||
    !xsd.valid ||
    documentIntegrity === 'invalid' ||
    artifacts.some((artifact) => artifact.integrity === 'invalid') ||
    artifactBindingInvalid ||
    pades === 'invalid' ||
    efirma === 'invalid' ||
    Object.values(certifications).includes('invalid');
  const incomplete = pades === 'unavailable' || efirma === 'unavailable';
  const pending = Object.values(certifications).some(
    (state) => state === 'pending' || state === 'unavailable'
  );
  const overall = invalid
    ? ('invalid' as const)
    : incomplete || base.docuboxSignature !== 'valid'
      ? ('incomplete' as const)
      : pending
        ? ('valid_with_pending_certifications' as const)
        : ('valid' as const);
  return {
    ...base,
    valid: !invalid && !incomplete && base.valid && documentIntegrity !== 'not_checked',
    overall,
    documentIntegrity,
    schema: xsd.valid ? ('valid' as const) : ('invalid' as const),
    artifacts,
    pades,
    efirma,
    certifications,
    errors: [...new Set(errors)],
  };
}

function verifyEfirmaBundle(bytes: Uint8Array, signature: EvidenceV2Package['signatures'][number]) {
  try {
    const bundle = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
    if (bundle.schema !== 'docubox-efirma-evidence-bundle-v1') return false;
    const payload = Buffer.from(String(bundle.payload_utf8_base64 || ''), 'base64');
    const signatureBytes = Buffer.from(String(bundle.signature_base64 || ''), 'base64');
    const certificateBytes = Buffer.from(String(bundle.certificate_der_base64 || ''), 'base64');
    const payloadHash = sha256Hex(payload);
    const signatureHash = sha256Hex(signatureBytes);
    const certificateHash = sha256Hex(certificateBytes);
    if (
      payloadHash !== String(bundle.payload_sha256 || '').toLowerCase() ||
      signatureHash !== String(bundle.signature_sha256 || '').toLowerCase() ||
      certificateHash !== String(bundle.certificate_fingerprint_sha256 || '').toLowerCase() ||
      payloadHash !== signature.cryptographicEvidence?.signedPayloadHash ||
      signatureHash !== signature.cryptographicEvidence?.signatureHash ||
      certificateHash !== signature.certificate?.fingerprintSha256 ||
      bundle.signature_verified !== true ||
      bundle.certificate_chain_valid !== true ||
      String(bundle.revocation_status || '').toUpperCase() !== 'GOOD'
    )
      return false;
    const certificate = new X509Certificate(certificateBytes);
    const capturedAt = signature.capturedAt ? new Date(signature.capturedAt).getTime() : Number.NaN;
    if (
      !Number.isFinite(capturedAt) ||
      capturedAt < new Date(certificate.validFrom).getTime() ||
      capturedAt > new Date(certificate.validTo).getTime()
    )
      return false;
    const algorithm = String(bundle.signature_algorithm || '').toUpperCase();
    const options = algorithm.includes('PSS')
      ? {
          key: certificate.publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_AUTO,
        }
      : { key: certificate.publicKey, padding: constants.RSA_PKCS1_PADDING };
    return verify('sha256', payload, options, signatureBytes);
  } catch {
    return false;
  }
}
