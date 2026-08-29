import { createHash, randomBytes, timingSafeEqual, X509Certificate, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as asn1js from 'asn1js';
import {
  AlgorithmIdentifier,
  Certificate,
  CertificateChainValidationEngine,
  ContentInfo,
  CryptoEngine,
  MessageImprint,
  PKIStatus,
  SignedData,
  TSTInfo,
  TimeStampReq,
  TimeStampResp,
} from 'pkijs';
import { sha256Hex } from './canonical';
import type { ProviderHealth } from './key-management';
import { CertificationError } from './types';

export const RFC3161_SHA256_OID = '2.16.840.1.101.3.4.2.1';
export const DEFAULT_DEVELOPMENT_TSA_POLICY_OID = '1.3.6.1.4.1.55555.1.1';
const RFC3161_SIGNING_CERT_V2_OID = '1.2.840.113549.1.9.16.2.47';
const EKU_TIMESTAMPING_OID = '1.3.6.1.5.5.7.3.8';

export type TimestampDigestInput = {
  digest: Uint8Array;
  digestAlgorithm?: 'SHA-256';
  /** Original bytes whose SHA-256 is supplied in digest (for CMS verification). */
  messageImprintData?: Uint8Array;
  nonce?: string;
  policyOid?: string;
};

export type TimestampVerificationInput = {
  expectedDigest?: Uint8Array;
  /** Original bytes that produced expectedDigest. Required for full CMS verification. */
  messageImprintData?: Uint8Array;
  expectedNonce?: string | null;
  expectedPolicyOid?: string | null;
};

export type TimestampVerificationResult = {
  valid: boolean;
  status: 'valid' | 'invalid';
  messageImprintValid: boolean;
  nonceValid: boolean;
  policyValid: boolean;
  cmsValid: boolean;
  certificateValid: boolean;
  chainValid: boolean;
  tsaEkuValid: boolean;
  policyOid: string | null;
  serialNumber: string | null;
  genTime: string | null;
  nonce: string | null;
  messageImprintSha256: string | null;
  tsaCertificateFingerprintSha256: string | null;
  tsaCertificateSerialNumber: string | null;
  tsaCertificateSubject: string | null;
  tsaIssuer: string | null;
  detail: string | null;
};

export type TimestampResult = {
  provider: string;
  request: Uint8Array;
  response: Uint8Array;
  token: Uint8Array;
  requestSha256: string;
  responseSha256: string;
  tokenSha256: string;
  messageImprintSha256: string;
  messageImprintAlgorithm: 'SHA-256';
  nonce: string;
  policyOid: string;
  serialNumber: string;
  genTime: string;
  tsaCertificateFingerprintSha256: string;
  tsaCertificateSerialNumber: string;
  tsaCertificateSubject: string;
  tsaIssuer: string;
  providerRole?: 'PRIMARY' | 'FALLBACK';
  endpointId?: string;
  trustBundleId?: string;
  trustRootFingerprintSha256?: string;
  trustChainFingerprintsSha256?: string[];
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  primaryFailureCode?: string | null;
  primaryFailureClass?: 'TEMPORARY_FAILURE' | 'SECURITY_VALIDATION_FAILURE' | null;
  verification: TimestampVerificationResult;
};

export interface TimestampAuthorityProvider {
  timestampDigest(input: TimestampDigestInput): Promise<TimestampResult>;
  verifyTimestamp(
    token: Uint8Array,
    input?: TimestampVerificationInput
  ): Promise<TimestampVerificationResult>;
  healthCheck(): Promise<ProviderHealth>;
}

export type Rfc3161HttpOptions = {
  url: string;
  policyOid?: string;
  timeoutMs: number;
  internalToken?: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  tsaCertificatePem: string;
  trustRootPem: string;
  tsaChainPems?: string[];
  trustRootPems?: string[];
  fetchImpl?: typeof fetch;
};

type LocalRfc3161Options = Rfc3161HttpOptions;

function retryAfterMilliseconds(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

type ParsedTimestamp = {
  token: Uint8Array;
  tstInfo: TSTInfo;
  tstInfoBytes: Uint8Array;
  signedData: SignedData;
};

function validOid(value: string) {
  const parts = value.split('.');
  if (parts.length < 2 || parts.some((part) => !/^(?:0|[1-9]\d*)$/.test(part))) return false;
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  return first >= 0 && first <= 2 && (first === 2 || second <= 39);
}

const nodeWebCrypto = webcrypto as unknown as Crypto;

function toArrayBuffer(value: Uint8Array) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function fromPem(pem: string) {
  return Buffer.from(
    pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''),
    'base64'
  );
}

function splitPemCertificates(value: string) {
  return value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

async function environmentPem(valueName: string, pathName: string) {
  const direct = process.env[valueName]?.trim();
  if (direct) return direct.replace(/\\n/g, '\n');
  const path = process.env[pathName]?.trim();
  return path ? readFile(path, 'utf8') : null;
}

function pkijsCertificate(pem: string) {
  const parsed = asn1js.fromBER(toArrayBuffer(fromPem(pem)));
  if (parsed.offset === -1)
    throw new CertificationError(
      'TSA_CERTIFICATE_INVALID',
      'No se pudo interpretar un certificado de la TSA.',
      503
    );
  return new Certificate({ schema: parsed.result });
}

function toPem(der: Uint8Array) {
  const base64 =
    Buffer.from(der)
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') || '';
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

function asHex(value: ArrayBuffer | Uint8Array) {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value))
    .toString('hex')
    .toUpperCase();
}

function normalizedNonce(hex: string) {
  const normalized = hex.replace(/^00+(?=[0-9A-F]{2})/i, '');
  return normalized || '00';
}

function nonceInteger(hex: string) {
  if (!/^[a-f0-9]{2,}$/i.test(hex) || hex.length % 2) {
    throw new CertificationError(
      'RFC3161_NONCE_INVALID',
      'El nonce RFC 3161 debe ser hexadecimal y tener longitud par.',
      422
    );
  }
  const bytes = Buffer.from(hex, 'hex');
  return new asn1js.Integer({
    valueHex: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function timestampFailure(detail: string): TimestampVerificationResult {
  return {
    valid: false,
    status: 'invalid',
    messageImprintValid: false,
    nonceValid: false,
    policyValid: false,
    cmsValid: false,
    certificateValid: false,
    chainValid: false,
    tsaEkuValid: false,
    policyOid: null,
    serialNumber: null,
    genTime: null,
    nonce: null,
    messageImprintSha256: null,
    tsaCertificateFingerprintSha256: null,
    tsaCertificateSerialNumber: null,
    tsaIssuer: null,
    detail,
    tsaCertificateSubject: null,
  };
}

function parseTimestampResponse(response: Uint8Array): ParsedTimestamp {
  const parsed = asn1js.fromBER(toArrayBuffer(response));
  if (parsed.offset === -1)
    throw new CertificationError(
      'RFC3161_RESPONSE_PARSE_FAILED',
      'La respuesta RFC 3161 no contiene ASN.1 DER valido.',
      502
    );
  const timestampResponse = new TimeStampResp({ schema: parsed.result });
  const status = timestampResponse.status.status;
  if (status !== PKIStatus.granted && status !== PKIStatus.grantedWithMods) {
    throw new CertificationError(
      'RFC3161_TSA_REJECTED',
      `La TSA rechazo la solicitud RFC 3161 con estatus ${status}.`,
      502
    );
  }
  if (!timestampResponse.timeStampToken)
    throw new CertificationError(
      'RFC3161_TOKEN_MISSING',
      'La TSA no devolvio un TimeStampToken.',
      502
    );
  const token = new Uint8Array(timestampResponse.timeStampToken.toSchema().toBER(false));
  return parseTimestampToken(token);
}

function parseTimestampToken(token: Uint8Array): ParsedTimestamp {
  const tokenAsn = asn1js.fromBER(toArrayBuffer(token));
  if (tokenAsn.offset === -1)
    throw new CertificationError(
      'RFC3161_TOKEN_PARSE_FAILED',
      'El TimeStampToken no contiene ASN.1 DER valido.',
      422
    );
  const contentInfo = new ContentInfo({ schema: tokenAsn.result });
  if (contentInfo.contentType !== ContentInfo.SIGNED_DATA || !contentInfo.content) {
    throw new CertificationError(
      'RFC3161_TOKEN_TYPE_INVALID',
      'El TimeStampToken no contiene CMS SignedData.',
      422
    );
  }
  const signedData = new SignedData({ schema: contentInfo.content });
  const eContent = signedData.encapContentInfo.eContent;
  if (!eContent)
    throw new CertificationError(
      'RFC3161_TSTINFO_MISSING',
      'El TimeStampToken no contiene TSTInfo.',
      422
    );
  const tstInfoBytes = new Uint8Array(eContent.valueBlock.valueHexView);
  const tstInfoAsn = asn1js.fromBER(toArrayBuffer(tstInfoBytes));
  if (tstInfoAsn.offset === -1)
    throw new CertificationError(
      'RFC3161_TSTINFO_PARSE_FAILED',
      'No se pudo interpretar el TSTInfo de la TSA.',
      422
    );
  return { token, tstInfo: new TSTInfo({ schema: tstInfoAsn.result }), tstInfoBytes, signedData };
}

async function verifyTsaChain(
  signer: Certificate,
  chainPems: string[],
  trustRootPems: string[],
  checkDate: Date
) {
  try {
    const trustedCerts = trustRootPems.map(pkijsCertificate);
    const certs = [signer, ...chainPems.map(pkijsCertificate)];
    const result = await new CertificateChainValidationEngine({
      trustedCerts,
      certs,
      checkDate,
    }).verify();
    return result.result === true;
  } catch {
    return false;
  }
}

/** RFC 3161 provider for the internal, explicitly non-production Docubox TSA. */
export class LocalRfc3161Provider implements TimestampAuthorityProvider {
  readonly providerId: string;

  constructor(
    private readonly options: LocalRfc3161Options,
    providerId = 'local-rfc3161-development'
  ) {
    this.providerId = providerId;
  }

  static async fromEnvironment() {
    const certificatePem = await environmentPem(
      'DOCUBOX_TSA_CERTIFICATE',
      'DOCUBOX_TSA_CERTIFICATE_PATH'
    );
    const chainPem = await environmentPem('DOCUBOX_TSA_CHAIN', 'DOCUBOX_TSA_CHAIN_PATH');
    const rootPem = await environmentPem('DOCUBOX_TSA_ROOT_CA', 'DOCUBOX_TSA_TRUST_ROOT_PATH');
    if (!certificatePem || !rootPem || !process.env.DOCUBOX_TSA_URL) return null;
    const configuredAlgorithm = (process.env.DOCUBOX_TSA_DIGEST_ALGORITHM || 'sha256')
      .trim()
      .toLowerCase();
    if (configuredAlgorithm !== 'sha256') {
      throw new CertificationError(
        'TSA_DIGEST_ALGORITHM_UNSUPPORTED',
        'Docubox solo admite SHA-256 para RFC 3161.',
        503
      );
    }
    return new LocalRfc3161Provider({
      url: process.env.DOCUBOX_TSA_URL,
      policyOid: process.env.DOCUBOX_TSA_POLICY_OID || DEFAULT_DEVELOPMENT_TSA_POLICY_OID,
      timeoutMs: Math.max(500, Number(process.env.DOCUBOX_TSA_TIMEOUT_MS || 8_000)),
      internalToken: process.env.DOCUBOX_TSA_INTERNAL_TOKEN,
      username: process.env.DOCUBOX_TSA_USERNAME,
      password: process.env.DOCUBOX_TSA_PASSWORD,
      bearerToken: process.env.DOCUBOX_TSA_TOKEN,
      tsaCertificatePem: certificatePem,
      trustRootPem: rootPem,
      tsaChainPems: chainPem ? splitPemCertificates(chainPem) : [],
      trustRootPems: splitPemCertificates(rootPem),
    });
  }

  async timestampDigest(input: TimestampDigestInput): Promise<TimestampResult> {
    const digest = new Uint8Array(input.digest);
    if (
      digest.byteLength !== 32 ||
      (input.digestAlgorithm && input.digestAlgorithm !== 'SHA-256')
    ) {
      throw new CertificationError(
        'RFC3161_DIGEST_INVALID',
        'La TSA de desarrollo solo acepta un digest SHA-256 de 32 bytes.',
        422
      );
    }
    const nonce = normalizedNonce((input.nonce || randomBytes(16).toString('hex')).toUpperCase());
    const requestedPolicyOid = input.policyOid || this.options.policyOid;
    if (requestedPolicyOid && !validOid(requestedPolicyOid)) {
      throw new CertificationError(
        'TSA_POLICY_INVALID',
        'La policy RFC 3161 configurada no es un OID ASN.1 valido.',
        503
      );
    }
    const request = new TimeStampReq({
      version: 1,
      messageImprint: new MessageImprint({
        hashAlgorithm: new AlgorithmIdentifier({ algorithmId: RFC3161_SHA256_OID }),
        hashedMessage: new asn1js.OctetString({ valueHex: toArrayBuffer(digest) }),
      }),
      ...(requestedPolicyOid ? { reqPolicy: requestedPolicyOid } : {}),
      nonce: nonceInteger(nonce),
      certReq: true,
    });
    const requestBytes = new Uint8Array(request.toSchema().toBER(false));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const bearerToken = this.options.bearerToken || this.options.internalToken;
      const basicAuth =
        this.options.username && this.options.password
          ? Buffer.from(`${this.options.username}:${this.options.password}`, 'utf8').toString(
              'base64'
            )
          : null;
      const response = await (this.options.fetchImpl || fetch)(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/timestamp-query',
          accept: 'application/timestamp-reply',
          ...(bearerToken
            ? { authorization: `Bearer ${bearerToken}` }
            : basicAuth
              ? { authorization: `Basic ${basicAuth}` }
              : {}),
        },
        body: Buffer.from(requestBytes),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new CertificationError(
          response.status === 429
            ? 'TSA_RATE_LIMITED'
            : response.status >= 500
              ? 'TSA_TEMPORARY_UNAVAILABLE'
              : 'TSA_HTTP_ERROR',
          `La TSA devolvio HTTP ${response.status}.`,
          503
        );
        const retryAfterMs = retryAfterMilliseconds(response.headers.get('retry-after'));
        if (retryAfterMs !== null) {
          Object.defineProperty(error, 'retryAfterMs', {
            value: retryAfterMs,
            enumerable: false,
          });
        }
        throw error;
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== 'application/timestamp-reply') {
        throw new CertificationError(
          'TSA_PROTOCOL_ERROR',
          'La TSA no devolvio application/timestamp-reply.',
          502
        );
      }
      const responseBytes = new Uint8Array(await response.arrayBuffer());
      if (!responseBytes.byteLength) {
        throw new CertificationError(
          'TSA_RESPONSE_EMPTY',
          'La TSA devolvio una respuesta vacia.',
          502
        );
      }
      const parsed = parseTimestampResponse(responseBytes);
      const verification = await this.verifyParsed(parsed, {
        expectedDigest: digest,
        messageImprintData: input.messageImprintData,
        expectedNonce: nonce,
        expectedPolicyOid: requestedPolicyOid || null,
      });
      if (
        !verification.valid ||
        !verification.serialNumber ||
        !verification.genTime ||
        !verification.policyOid ||
        !verification.tsaCertificateFingerprintSha256 ||
        !verification.tsaCertificateSerialNumber ||
        !verification.tsaIssuer
      ) {
        const failureCode = !verification.messageImprintValid
          ? 'TSA_IMPRINT_MISMATCH'
          : !verification.nonceValid
            ? 'TSA_NONCE_MISMATCH'
            : !verification.policyValid
              ? 'TSA_POLICY_MISMATCH'
              : !verification.cmsValid
                ? 'TSA_SIGNATURE_INVALID'
                : !verification.certificateValid
                  ? 'TSA_CERTIFICATE_INVALID'
                  : !verification.chainValid
                    ? 'TSA_CHAIN_INVALID'
                    : 'TSA_PROTOCOL_ERROR';
        throw new CertificationError(
          failureCode,
          verification.detail ||
            `Validacion RFC 3161 incompleta (CMS=${verification.cmsValid}, certificado=${verification.certificateValid}, imprint=${verification.messageImprintValid}, nonce=${verification.nonceValid}, politica=${verification.policyValid}).`,
          502
        );
      }
      return {
        provider: this.providerId,
        request: requestBytes,
        response: responseBytes,
        token: parsed.token,
        requestSha256: sha256Hex(requestBytes),
        responseSha256: sha256Hex(responseBytes),
        tokenSha256: sha256Hex(parsed.token),
        messageImprintSha256: Buffer.from(digest).toString('hex'),
        messageImprintAlgorithm: 'SHA-256',
        nonce,
        policyOid: verification.policyOid,
        serialNumber: verification.serialNumber,
        genTime: verification.genTime,
        tsaCertificateFingerprintSha256: verification.tsaCertificateFingerprintSha256,
        tsaCertificateSerialNumber: verification.tsaCertificateSerialNumber,
        tsaCertificateSubject: verification.tsaCertificateSubject || '',
        tsaIssuer: verification.tsaIssuer,
        verification,
      };
    } catch (error) {
      if (error instanceof CertificationError) throw error;
      if (process.env.DOCUBOX_TSA_DEBUG === '1') {
        console.error('[DOCUBOX][TSA] Internal verification failure:', error);
      }
      const code =
        error instanceof Error && error.name === 'AbortError' ? 'TSA_HTTP_ERROR' : 'TSA_HTTP_ERROR';
      throw new CertificationError(
        code,
        'No fue posible obtener una estampa RFC 3161 de la TSA configurada.',
        503
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async verifyTimestamp(token: Uint8Array, input: TimestampVerificationInput = {}) {
    try {
      return await this.verifyParsed(parseTimestampToken(token), input);
    } catch (error) {
      return timestampFailure(
        error instanceof CertificationError ? error.code : 'RFC3161_TIMESTAMP_INVALID'
      );
    }
  }

  private async verifyParsed(
    parsed: ParsedTimestamp,
    input: TimestampVerificationInput
  ): Promise<TimestampVerificationResult> {
    const signerCertificate = parsed.signedData.certificates?.find(
      (entry): entry is Certificate => entry instanceof Certificate
    );
    if (!signerCertificate) return timestampFailure('RFC3161_TSA_CERTIFICATE_MISSING');
    const signerPem = toPem(new Uint8Array(signerCertificate.toSchema().toBER(false)));
    const signer = new X509Certificate(signerPem);
    const configuredSigner = new X509Certificate(this.options.tsaCertificatePem);
    const certificateFingerprint = signer.fingerprint256.replace(/:/g, '').toLowerCase();
    const configuredFingerprint = configuredSigner.fingerprint256.replace(/:/g, '').toLowerCase();
    const tsaEkuValid = signer.keyUsage.some(
      (usage) => usage === EKU_TIMESTAMPING_OID || usage.toLowerCase().includes('time stamping')
    );
    const genTime = parsed.tstInfo.genTime;
    const trustRootPems = this.options.trustRootPems?.length
      ? this.options.trustRootPems
      : splitPemCertificates(this.options.trustRootPem);
    const chainValid =
      certificateFingerprint === configuredFingerprint &&
      (await verifyTsaChain(
        signerCertificate,
        this.options.tsaChainPems || [],
        trustRootPems,
        genTime
      ));
    const certificateValid =
      tsaEkuValid &&
      chainValid &&
      new Date(signer.validFrom) <= genTime &&
      new Date(signer.validTo) >= genTime;
    const cmsResult = input.messageImprintData
      ? await parsed.signedData.verify(
          {
            signer: 0,
            data: toArrayBuffer(input.messageImprintData),
            checkChain: false,
            extendedMode: true,
          },
          new CryptoEngine({ name: 'docubox-rfc3161-verify', crypto: nodeWebCrypto })
        )
      : null;
    const cmsValid = cmsResult?.signatureVerified === true;
    const messageImprint = new Uint8Array(
      parsed.tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView
    );
    // The RFC 3161 message imprint is already a SHA-256 digest. Persist and
    // expose that exact value, never a second hash of the digest.
    const messageImprintSha256 = Buffer.from(messageImprint).toString('hex');
    const digestAlgorithmValid =
      parsed.tstInfo.messageImprint.hashAlgorithm.algorithmId === RFC3161_SHA256_OID;
    const messageImprintValid =
      digestAlgorithmValid &&
      (!input.expectedDigest || equalBytes(messageImprint, input.expectedDigest));
    const nonce = parsed.tstInfo.nonce ? asHex(parsed.tstInfo.nonce.valueBlock.valueHexView) : null;
    const nonceValid =
      !input.expectedNonce || nonce === normalizedNonce(input.expectedNonce.toUpperCase());
    const policyOid = parsed.tstInfo.policy;
    const policyValid =
      validOid(policyOid) && (!input.expectedPolicyOid || policyOid === input.expectedPolicyOid);
    const serialNumber = asHex(parsed.tstInfo.serialNumber.valueBlock.valueHexView);
    const genTimeIso = genTime.toISOString();
    return {
      valid: cmsValid && certificateValid && messageImprintValid && nonceValid && policyValid,
      status:
        cmsValid && certificateValid && messageImprintValid && nonceValid && policyValid
          ? 'valid'
          : 'invalid',
      messageImprintValid,
      nonceValid,
      policyValid,
      cmsValid,
      certificateValid,
      chainValid,
      tsaEkuValid,
      policyOid,
      serialNumber,
      genTime: genTimeIso,
      nonce,
      messageImprintSha256,
      tsaCertificateFingerprintSha256: certificateFingerprint,
      tsaCertificateSerialNumber: signer.serialNumber.replace(/:/g, '').toUpperCase(),
      tsaCertificateSubject: signer.subject,
      tsaIssuer: signer.issuer,
      detail:
        cmsValid && certificateValid && messageImprintValid && nonceValid && policyValid
          ? null
          : `RFC3161_INVALID(cms=${cmsValid},certificate=${certificateValid},imprint=${messageImprintValid},nonce=${nonceValid},policy=${policyValid})`,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const missing: string[] = [];
    if (!this.options.url) missing.push('DOCUBOX_TSA_URL');
    if (!this.options.tsaCertificatePem) missing.push('DOCUBOX_TSA_CERTIFICATE_PATH');
    if (!this.options.trustRootPem) missing.push('DOCUBOX_TSA_TRUST_ROOT_PATH');
    if (missing.length) return { ready: false, missing, provider: this.providerId };
    try {
      const certificate = new X509Certificate(this.options.tsaCertificatePem);
      const timestampingEku = certificate.keyUsage.some(
        (usage) => usage === EKU_TIMESTAMPING_OID || usage.toLowerCase().includes('time stamping')
      );
      const chainValid = await verifyTsaChain(
        pkijsCertificate(this.options.tsaCertificatePem),
        this.options.tsaChainPems || [],
        this.options.trustRootPems?.length
          ? this.options.trustRootPems
          : splitPemCertificates(this.options.trustRootPem),
        new Date()
      );
      const active =
        new Date(certificate.validFrom) <= new Date() &&
        new Date(certificate.validTo) >= new Date();
      return {
        ready: timestampingEku && chainValid && active,
        missing: [
          ...(timestampingEku ? [] : ['TSA certificate EKU timeStamping']),
          ...(chainValid ? [] : ['TSA certificate chain']),
          ...(active ? [] : ['TSA certificate validity']),
        ],
        provider: this.providerId,
        keyId: 'docubox-development-tsa',
        keyVersion: '1',
      };
    } catch {
      return {
        ready: false,
        missing: ['TSA certificate configuration invalid'],
        provider: this.providerId,
      };
    }
  }
}

/**
 * Remote RFC 3161 adapter for a production TSA. It shares the strict ASN.1,
 * CMS, chain, policy and nonce verification of the development implementation,
 * but never reads development configuration and only permits HTTPS endpoints.
 */
export class ProductionTimestampAuthorityProvider implements TimestampAuthorityProvider {
  readonly providerId = 'production-rfc3161' as const;
  private readonly delegate: LocalRfc3161Provider | null;
  private readonly missing: string[];

  private constructor(delegate: LocalRfc3161Provider | null, missing: string[]) {
    this.delegate = delegate;
    this.missing = missing;
  }

  static async fromEnvironment() {
    const required = [
      'DOCUBOX_PRODUCTION_TSA_URL',
      'DOCUBOX_PRODUCTION_TSA_CERTIFICATE_PATH',
      'DOCUBOX_PRODUCTION_TSA_TRUST_ROOT_PATH',
    ] as const;
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length) return new ProductionTimestampAuthorityProvider(null, missing);
    const url = process.env.DOCUBOX_PRODUCTION_TSA_URL!.trim();
    if (new URL(url).protocol !== 'https:') {
      return new ProductionTimestampAuthorityProvider(null, [
        'DOCUBOX_PRODUCTION_TSA_URL must use HTTPS',
      ]);
    }
    const timeout = Number(process.env.DOCUBOX_PRODUCTION_TSA_TIMEOUT_MS || 8_000);
    const provider = new LocalRfc3161Provider(
      {
        url,
        policyOid: process.env.DOCUBOX_PRODUCTION_TSA_POLICY_OID || undefined,
        timeoutMs: Number.isFinite(timeout) && timeout >= 500 ? timeout : 8_000,
        internalToken: process.env.DOCUBOX_PRODUCTION_TSA_SERVICE_TOKEN,
        tsaCertificatePem: await readFile(
          process.env.DOCUBOX_PRODUCTION_TSA_CERTIFICATE_PATH!,
          'utf8'
        ),
        trustRootPem: await readFile(process.env.DOCUBOX_PRODUCTION_TSA_TRUST_ROOT_PATH!, 'utf8'),
      },
      'production-rfc3161'
    );
    return new ProductionTimestampAuthorityProvider(provider, []);
  }

  async timestampDigest(input: TimestampDigestInput) {
    if (!this.delegate)
      throw new CertificationError(
        'PRODUCTION_TSA_NOT_CONFIGURED',
        'La TSA RFC 3161 de produccion no esta configurada.',
        503
      );
    return this.delegate.timestampDigest(input);
  }

  async verifyTimestamp(token: Uint8Array, input: TimestampVerificationInput = {}) {
    if (!this.delegate) return timestampFailure('PRODUCTION_TSA_NOT_CONFIGURED');
    return this.delegate.verifyTimestamp(token, input);
  }

  async healthCheck() {
    if (!this.delegate) return { ready: false, missing: this.missing, provider: this.providerId };
    const health = await this.delegate.healthCheck();
    return { ...health, provider: this.providerId };
  }
}

/** Explicit rollback state: B-B remains possible, but no timestamp can be claimed. */
export class UnavailableTimestampAuthorityProvider implements TimestampAuthorityProvider {
  readonly providerId = 'rfc3161-not-configured' as const;
  async timestampDigest(): Promise<TimestampResult> {
    throw new CertificationError(
      'RFC3161_TSA_NOT_CONFIGURED',
      'No existe una TSA RFC 3161 configurada. El documento solo puede emitirse como PAdES-B-B.',
      503
    );
  }
  async verifyTimestamp(): Promise<TimestampVerificationResult> {
    return timestampFailure('RFC3161_TSA_NOT_CONFIGURED');
  }
  async healthCheck(): Promise<ProviderHealth> {
    return {
      ready: false,
      missing: ['DOCUBOX_TSA_URL', 'DOCUBOX_TSA_CERTIFICATE_PATH', 'DOCUBOX_TSA_TRUST_ROOT_PATH'],
      provider: this.providerId,
    };
  }
}

export function timestampSignatureDigest(signatureValue: Uint8Array) {
  return createHash('sha256').update(signatureValue).digest();
}

export { RFC3161_SIGNING_CERT_V2_OID };
