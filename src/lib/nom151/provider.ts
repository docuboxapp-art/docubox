import 'server-only';

import { createHash, timingSafeEqual, webcrypto, X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import {
  Certificate,
  CertificateChainValidationEngine,
  CryptoEngine,
  PKIStatus,
  SignedData,
  TSTInfo,
  TimeStampResp,
} from 'pkijs';
import {
  endpointFingerprint,
  loadNom151TrustBundle,
  resolveNom151Environment,
  type Nom151Environment,
} from './trust';

const SHA256_OID = '2.16.840.1.101.3.4.2.1';
const DEFAULT_NUBARIUM_ENDPOINT = 'https://firma.nubarium.com/nom151/v1/obtener-nom151';

export type Nom151ProviderHealth = {
  ready: boolean;
  productionReady: boolean;
  provider: string;
  pscName: string;
  environment: Nom151Environment;
  environmentExplicit: boolean;
  endpointHost: string;
  endpointFingerprintSha256: string;
  environmentMismatch: boolean;
  trustBundleLoaded: boolean;
  trustBundleVersion: string | null;
  rootTrusted: boolean;
  certificatesWithinValidity: boolean;
  certificates: Array<{
    subject: string;
    issuer: string;
    serial: string;
    fingerprintSha256: string;
    validFrom: string;
    validTo: string;
    status: 'valid' | 'expired_or_not_yet_valid';
  }>;
  missing: string[];
  errors: string[];
  failureCode: string | null;
};

export type Nom151CertificationInput = {
  documentId: string;
  documentVersionId: string;
  documentDigest: string;
  digestAlgorithm: 'SHA-256';
  documentBytes: Uint8Array;
  idempotencyKey: string;
};

export type Nom151ArtifactVerification = {
  valid: boolean;
  artifactParseValid: boolean;
  providerStatusValid: boolean;
  digestBindingValid: boolean;
  cmsSignatureValid: boolean;
  certificateValid: boolean;
  chainValid: boolean | null;
  chainStatus: 'valid' | 'invalid' | 'not_available';
  digestAlgorithm: 'SHA-256' | null;
  documentDigest: string | null;
  policyOid: string | null;
  serialNumber: string | null;
  issuedAt: string | null;
  certificateSubject: string | null;
  certificateIssuer: string | null;
  certificateSerial: string | null;
  certificateFingerprintSha256: string | null;
  certificateValidFrom: string | null;
  certificateValidTo: string | null;
  certificateKeyUsages: string[];
  certificateExtendedKeyUsageOids: string[];
  certificatePolicyOids: string[];
  certificateProfileValid: boolean;
  tstPolicyValid: boolean;
  rootTrusted: boolean;
  productionTrusted: boolean;
  trustBundleVersion: string | null;
  trustRootFingerprintSha256: string | null;
  chainFingerprintsSha256: string[];
  pscName: string | null;
  detail: string | null;
};

export type Nom151CertificationResult = {
  provider: string;
  pscName: string;
  environment: Nom151Environment;
  operationId: string;
  folio: string;
  artifact: Uint8Array;
  artifactFormat: 'RFC3161_TIME_STAMP_RESP_DER';
  providerDocumentDigest: string;
  providerStatus: string;
  providerMessageCode: string | number | null;
  verification: Nom151ArtifactVerification;
  providerMetadata: Record<string, unknown>;
};

export interface Nom151Provider {
  readonly providerId: string;
  healthCheck(): Promise<Nom151ProviderHealth>;
  certify(input: Nom151CertificationInput): Promise<Nom151CertificationResult>;
  verifyArtifact(
    artifact: Uint8Array,
    documentBytes: Uint8Array,
    expectedDigest: string
  ): Promise<Nom151ArtifactVerification>;
}

type NubariumResponse = {
  codigoValidacion?: string;
  nom151?: string;
  hash?: string;
  estatus?: string;
  claveMensaje?: string | number;
  mensaje?: string;
};

function toArrayBuffer(value: Uint8Array) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSha256(value: unknown) {
  const candidate = String(value ?? '').trim();
  if (/^[a-f0-9]{64}$/i.test(candidate)) return candidate.toLowerCase();
  if (!/^[a-z0-9+/]{43}=$/i.test(candidate)) return null;
  try {
    const decoded = Buffer.from(candidate, 'base64');
    return decoded.byteLength === 32 ? decoded.toString('hex') : null;
  } catch {
    return null;
  }
}

function equalHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function safeProviderDetail(value: unknown) {
  return String(value ?? '')
    .replace(/(?:basic|bearer)\s+[a-z0-9+/_=.-]+/gi, '[redacted]')
    .replace(/((?:password|secret|token|authorization))\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function pkijsCertificate(pem: string) {
  const der = Buffer.from(
    pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
    'base64'
  );
  const parsed = asn1js.fromBER(toArrayBuffer(der));
  if (parsed.offset === -1) throw new Error('NOM151_TRUST_ROOT_INVALID');
  return new Certificate({ schema: parsed.result });
}

function extension(certificate: Certificate, id: string) {
  return certificate.extensions?.find((candidate) => candidate.extnID === id);
}

function keyUsages(certificate: Certificate) {
  const parsed = extension(certificate, '2.5.29.15')?.parsedValue as
    { valueBlock?: { valueHexView?: Uint8Array } } | undefined;
  const bytes = parsed?.valueBlock?.valueHexView;
  if (!bytes?.length) return [];
  const names = [
    'digitalSignature',
    'contentCommitment',
    'keyEncipherment',
    'dataEncipherment',
    'keyAgreement',
    'keyCertSign',
    'cRLSign',
    'encipherOnly',
    'decipherOnly',
  ];
  return names.filter((_, index) => {
    const byte = bytes[Math.floor(index / 8)] || 0;
    return (byte & (0x80 >> (index % 8))) !== 0;
  });
}

function extendedKeyUsageOids(certificate: Certificate) {
  const parsed = extension(certificate, '2.5.29.37')?.parsedValue as
    { keyPurposes?: string[] } | undefined;
  return parsed?.keyPurposes || [];
}

function certificatePolicyOids(certificate: Certificate) {
  const parsed = extension(certificate, '2.5.29.32')?.parsedValue as
    { certificatePolicies?: Array<{ policyIdentifier?: string }> } | undefined;
  return (parsed?.certificatePolicies || [])
    .map((policy) => policy.policyIdentifier)
    .filter((value): value is string => Boolean(value));
}

function isCaCertificate(certificate: Certificate) {
  const parsed = extension(certificate, '2.5.29.19')?.parsedValue as { cA?: boolean } | undefined;
  return parsed?.cA === true;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function extractOrganization(subject: string) {
  return (
    subject
      .split(/\r?\n/)
      .find((part) => part.startsWith('O='))
      ?.slice(2)
      .trim() || null
  );
}

function failedVerification(detail: string): Nom151ArtifactVerification {
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
    detail,
  };
}

export class NubariumNom151Provider implements Nom151Provider {
  readonly providerId = 'nubarium-nom151';

  constructor(
    private readonly options: {
      endpoint: string;
      username: string;
      password: string;
      environment: Nom151Environment;
      environmentExplicit: boolean;
      productionEndpoint: string;
      timeoutMs: number;
      maxRetries: number;
      fetchImpl?: typeof fetch;
    }
  ) {}

  static fromEnvironment() {
    const username = process.env.NUBARIUM_USER || process.env.NUBARIUM_API_KEY || '';
    const password = process.env.NUBARIUM_PASS || process.env.NUBARIUM_API_SECRET || '';
    const environment = resolveNom151Environment();
    return new NubariumNom151Provider({
      endpoint: process.env.NOM151_NUBARIUM_ENDPOINT || DEFAULT_NUBARIUM_ENDPOINT,
      username,
      password,
      environment: environment.environment,
      environmentExplicit: environment.explicit,
      productionEndpoint: process.env.NOM151_PRODUCTION_ENDPOINT || '',
      timeoutMs: Math.max(1_000, Number(process.env.NOM151_PROVIDER_TIMEOUT_MS || 45_000)),
      maxRetries: Math.max(1, Math.min(3, Number(process.env.NOM151_PROVIDER_MAX_RETRIES || 3))),
    });
  }

  async healthCheck(): Promise<Nom151ProviderHealth> {
    const trust = await loadNom151TrustBundle();
    const endpoint = new URL(this.options.endpoint);
    const productionEndpoint = this.options.productionEndpoint.trim();
    const endpointProfileMismatch = Boolean(
      trust.manifest && trust.manifest.endpointHost !== endpoint.hostname
    );
    const environmentMismatch =
      endpointProfileMismatch ||
      (this.options.environment === 'production' &&
        (!productionEndpoint || productionEndpoint !== this.options.endpoint));
    const missing = [
      !this.options.username && 'NUBARIUM_USER',
      !this.options.password && 'NUBARIUM_PASS',
      !this.options.environmentExplicit && 'NOM151_ENVIRONMENT',
      ...trust.missing,
      this.options.environment === 'production' &&
        !productionEndpoint &&
        'NOM151_PRODUCTION_ENDPOINT',
    ].filter(Boolean) as string[];
    const errors = [
      ...trust.errors,
      environmentMismatch && 'NOM151_PROVIDER_ENVIRONMENT_MISMATCH',
    ].filter(Boolean) as string[];
    const ready = Boolean(
      this.options.username &&
      this.options.password &&
      this.options.environmentExplicit &&
      trust.loaded &&
      trust.rootTrusted &&
      trust.certificatesWithinValidity &&
      !errors.length
    );
    const productionReady =
      ready && this.options.environment === 'production' && !environmentMismatch;
    return {
      ready,
      productionReady,
      provider: this.providerId,
      pscName: 'PSC World S.A. de C.V.',
      environment: this.options.environment,
      environmentExplicit: this.options.environmentExplicit,
      endpointHost: endpoint.hostname,
      endpointFingerprintSha256: endpointFingerprint(this.options.endpoint),
      environmentMismatch,
      trustBundleLoaded: trust.loaded,
      trustBundleVersion: trust.version,
      rootTrusted: trust.rootTrusted,
      certificatesWithinValidity: trust.certificatesWithinValidity,
      certificates: [...trust.roots, ...trust.intermediates].map((certificate) => ({
        subject: certificate.subject,
        issuer: certificate.issuer,
        serial: certificate.serial,
        fingerprintSha256: certificate.fingerprintSha256,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
        status: certificate.validNow ? 'valid' : 'expired_or_not_yet_valid',
      })),
      missing: unique(missing),
      errors: unique(errors),
      failureCode: environmentMismatch
        ? 'NOM151_PROVIDER_ENVIRONMENT_MISMATCH'
        : errors[0] || (missing.length ? 'NOM151_PROVIDER_NOT_CONFIGURED' : null),
    };
  }

  async certify(input: Nom151CertificationInput): Promise<Nom151CertificationResult> {
    const localDigest = sha256(input.documentBytes);
    if (input.digestAlgorithm !== 'SHA-256' || !equalHex(localDigest, input.documentDigest)) {
      throw new Error('NOM151_DIGEST_MISMATCH');
    }
    const health = await this.healthCheck();
    if (!health.ready) throw new Error(health.failureCode || 'NOM151_PROVIDER_NOT_CONFIGURED');

    let responsePayload: NubariumResponse | null = null;
    let lastFailure = 'NOM151_PROVIDER_UNAVAILABLE';
    for (let attempt = 1; attempt <= this.options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await (this.options.fetchImpl || fetch)(this.options.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Basic ${Buffer.from(`${this.options.username}:${this.options.password}`, 'utf8').toString('base64')}`,
            'x-docubox-idempotency-key': input.idempotencyKey,
          },
          // Nubarium's real protocol requires the complete PDF. No participant
          // credentials or private signing material are included.
          body: JSON.stringify({ pdf: Buffer.from(input.documentBytes).toString('base64') }),
          signal: controller.signal,
        });
        const raw = await response.text();
        let parsed: NubariumResponse;
        try {
          parsed = JSON.parse(raw) as NubariumResponse;
        } catch {
          throw new Error('NOM151_PROVIDER_RESPONSE_INVALID');
        }
        if (!response.ok) throw new Error(`NOM151_PROVIDER_HTTP_${response.status}`);
        if (String(parsed.estatus || '').toUpperCase() !== 'OK') {
          const code = safeProviderDetail(parsed.claveMensaje || 'UNKNOWN');
          const detail = safeProviderDetail(parsed.mensaje || 'Solicitud rechazada por el PSC');
          throw new Error(`NOM151_PROVIDER_REJECTED:${code}:${detail}`);
        }
        responsePayload = parsed;
        break;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : 'NOM151_PROVIDER_UNAVAILABLE';
        const retryable = /AbortError|HTTP_5\d\d|UNAVAILABLE|TIMEOUT/i.test(lastFailure);
        if (!retryable || attempt === this.options.maxRetries) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!responsePayload) throw new Error(lastFailure);
    if (!responsePayload.codigoValidacion || !responsePayload.nom151 || !responsePayload.hash) {
      throw new Error('NOM151_PROVIDER_FIELDS_MISSING');
    }
    const providerDigest = normalizeSha256(responsePayload.hash);
    if (!providerDigest || !equalHex(providerDigest, localDigest)) {
      throw new Error('NOM151_DIGEST_MISMATCH');
    }
    let artifact: Uint8Array;
    try {
      artifact = new Uint8Array(Buffer.from(responsePayload.nom151, 'base64'));
    } catch {
      throw new Error('NOM151_ARTIFACT_DECODE_FAILED');
    }
    if (!artifact.byteLength) throw new Error('NOM151_ARTIFACT_EMPTY');

    const verification = await this.verifyArtifact(artifact, input.documentBytes, localDigest);
    if (!verification.valid) throw new Error(verification.detail || 'NOM151_ARTIFACT_INVALID');
    const folio = verification.serialNumber || responsePayload.codigoValidacion;
    return {
      provider: this.providerId,
      pscName: verification.pscName || health.pscName,
      environment: this.options.environment,
      operationId: responsePayload.codigoValidacion,
      folio,
      artifact,
      artifactFormat: 'RFC3161_TIME_STAMP_RESP_DER',
      providerDocumentDigest: providerDigest,
      providerStatus: String(responsePayload.estatus || ''),
      providerMessageCode: responsePayload.claveMensaje ?? null,
      verification,
      providerMetadata: {
        endpoint_id: new URL(this.options.endpoint).hostname,
        endpoint_fingerprint_sha256: endpointFingerprint(this.options.endpoint),
        environment: this.options.environment,
        protocol_requires_full_pdf: true,
        artifact_sha256: sha256(artifact),
        trust_bundle_version: verification.trustBundleVersion,
        trust_root_fingerprint_sha256: verification.trustRootFingerprintSha256,
      },
    };
  }

  async verifyArtifact(
    artifact: Uint8Array,
    documentBytes: Uint8Array,
    expectedDigest: string
  ): Promise<Nom151ArtifactVerification> {
    try {
      const parsed = asn1js.fromBER(toArrayBuffer(artifact));
      if (parsed.offset !== artifact.byteLength)
        return failedVerification('NOM151_ARTIFACT_PARSE_FAILED');
      const response = new TimeStampResp({ schema: parsed.result });
      const providerStatusValid =
        response.status.status === PKIStatus.granted ||
        response.status.status === PKIStatus.grantedWithMods;
      if (!providerStatusValid || !response.timeStampToken) {
        return failedVerification('NOM151_PROVIDER_STATUS_INVALID');
      }
      const signedData = new SignedData({ schema: response.timeStampToken.content });
      const embedded = signedData.encapContentInfo.eContent;
      if (!embedded) return failedVerification('NOM151_TSTINFO_MISSING');
      const tstInfoBytes = new Uint8Array(embedded.valueBlock.valueHexView);
      const tstInfoAsn = asn1js.fromBER(toArrayBuffer(tstInfoBytes));
      if (tstInfoAsn.offset !== tstInfoBytes.byteLength) {
        return failedVerification('NOM151_TSTINFO_PARSE_FAILED');
      }
      const tstInfo = new TSTInfo({ schema: tstInfoAsn.result });
      const documentDigest = Buffer.from(
        tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView
      ).toString('hex');
      const calculatedDigest = sha256(documentBytes);
      const digestBindingValid =
        tstInfo.messageImprint.hashAlgorithm.algorithmId === SHA256_OID &&
        equalHex(documentDigest, calculatedDigest) &&
        equalHex(calculatedDigest, expectedDigest);

      const signerCertificate = signedData.certificates?.find(
        (entry): entry is Certificate => entry instanceof Certificate
      );
      if (!signerCertificate) return failedVerification('NOM151_CERTIFICATE_MISSING');
      const signerDer = new Uint8Array(signerCertificate.toSchema().toBER(false));
      const signer = new X509Certificate(signerDer);
      const issuedAt = tstInfo.genTime.toISOString();
      const certificateValidFrom = new Date(signer.validFrom).toISOString();
      const certificateValidTo = new Date(signer.validTo).toISOString();
      const certificateValid =
        new Date(signer.validFrom) <= tstInfo.genTime &&
        new Date(signer.validTo) >= tstInfo.genTime;
      const cmsResult = await signedData.verify(
        {
          signer: 0,
          data: toArrayBuffer(documentBytes),
          checkChain: false,
          extendedMode: true,
        },
        new CryptoEngine({ name: 'docubox-nom151-verify', crypto: webcrypto as unknown as Crypto })
      );
      const cmsSignatureValid = cmsResult.signatureVerified === true;

      const trust = await loadNom151TrustBundle();
      const trustRoots = trust.rootsPem.map(pkijsCertificate);
      const configuredIntermediates = trust.intermediatesPem.map(pkijsCertificate);
      const embeddedIntermediates = (signedData.certificates || []).filter(
        (entry): entry is Certificate => entry instanceof Certificate && entry !== signerCertificate
      );
      let chainValid: boolean | null = null;
      if (trustRoots.length && trust.rootTrusted) {
        try {
          const chainResult = await new CertificateChainValidationEngine({
            trustedCerts: trustRoots,
            certs: [signerCertificate, ...embeddedIntermediates, ...configuredIntermediates],
            checkDate: tstInfo.genTime,
          }).verify();
          chainValid = chainResult.result === true;
        } catch {
          chainValid = false;
        }
      }
      const certificateKeyUsages = keyUsages(signerCertificate);
      const certificateExtendedKeyUsageOids = extendedKeyUsageOids(signerCertificate);
      const certificatePolicyIdentifiers = certificatePolicyOids(signerCertificate);
      const manifest = trust.manifest;
      const certificateProfileValid = Boolean(
        manifest &&
        extractOrganization(signer.subject) === manifest.psc &&
        isCaCertificate(signerCertificate) === manifest.signerMustBeCa &&
        manifest.requiredKeyUsages.every((usage) => certificateKeyUsages.includes(usage)) &&
        manifest.requiredExtendedKeyUsageOids.every((oid) =>
          certificateExtendedKeyUsageOids.includes(oid)
        ) &&
        manifest.expectedSignerPolicyOids.every((oid) => certificatePolicyIdentifiers.includes(oid))
      );
      const tstPolicyValid = Boolean(
        manifest && manifest.expectedTstPolicyOids.includes(tstInfo.policy)
      );
      const productionEndpointMatches = Boolean(
        this.options.productionEndpoint && this.options.productionEndpoint === this.options.endpoint
      );
      const productionTrusted = Boolean(
        this.options.environment === 'production' &&
        this.options.environmentExplicit &&
        productionEndpointMatches &&
        trust.loaded &&
        trust.rootTrusted &&
        chainValid === true &&
        certificateValid &&
        certificateProfileValid &&
        tstPolicyValid &&
        cmsSignatureValid &&
        digestBindingValid
      );
      const valid =
        providerStatusValid &&
        digestBindingValid &&
        cmsSignatureValid &&
        certificateValid &&
        certificateProfileValid &&
        tstPolicyValid &&
        trust.rootTrusted &&
        chainValid === true;
      const detail = !providerStatusValid
        ? 'NOM151_PROVIDER_STATUS_INVALID'
        : !digestBindingValid
          ? 'NOM151_DIGEST_MISMATCH'
          : !cmsSignatureValid
            ? 'NOM151_CMS_INVALID'
            : !certificateValid || !certificateProfileValid || !tstPolicyValid
              ? 'NOM151_SIGNING_CERT_INVALID'
              : !trust.rootTrusted
                ? 'NOM151_UNTRUSTED_ROOT'
                : chainValid !== true
                  ? 'NOM151_CHAIN_INVALID'
                  : null;
      const embeddedFingerprints = [
        signer,
        ...embeddedIntermediates.map(
          (certificate) => new X509Certificate(new Uint8Array(certificate.toSchema().toBER(false)))
        ),
      ].map((certificate) => certificate.fingerprint256.replace(/:/g, '').toLowerCase());
      return {
        valid,
        artifactParseValid: true,
        providerStatusValid,
        digestBindingValid,
        cmsSignatureValid,
        certificateValid,
        chainValid,
        chainStatus: chainValid === null ? 'not_available' : chainValid ? 'valid' : 'invalid',
        digestAlgorithm: 'SHA-256',
        documentDigest,
        policyOid: tstInfo.policy,
        serialNumber: Buffer.from(tstInfo.serialNumber.valueBlock.valueHexView).toString('hex'),
        issuedAt,
        certificateSubject: signer.subject,
        certificateIssuer: signer.issuer,
        certificateSerial: signer.serialNumber,
        certificateFingerprintSha256: signer.fingerprint256.replace(/:/g, '').toLowerCase(),
        certificateValidFrom,
        certificateValidTo,
        certificateKeyUsages,
        certificateExtendedKeyUsageOids,
        certificatePolicyOids: certificatePolicyIdentifiers,
        certificateProfileValid,
        tstPolicyValid,
        rootTrusted: trust.rootTrusted,
        productionTrusted,
        trustBundleVersion: trust.version,
        trustRootFingerprintSha256: trust.roots[0]?.fingerprintSha256 || null,
        chainFingerprintsSha256: unique([
          ...embeddedFingerprints,
          ...trust.intermediates.map((certificate) => certificate.fingerprintSha256),
          ...trust.roots.map((certificate) => certificate.fingerprintSha256),
        ]),
        pscName: extractOrganization(signer.subject),
        detail,
      };
    } catch (error) {
      return failedVerification(
        error instanceof Error ? error.message : 'NOM151_ARTIFACT_VERIFICATION_FAILED'
      );
    }
  }
}

export function createNom151Provider(): Nom151Provider {
  return NubariumNom151Provider.fromEnvironment();
}
