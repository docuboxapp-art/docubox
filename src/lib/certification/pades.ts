import { webcrypto, X509Certificate } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import * as asn1js from 'asn1js';
import {
  Certificate,
  ContentInfo,
  CryptoEngine,
  EncapsulatedContentInfo,
  IssuerAndSerialNumber,
  SignedData,
  SignerInfo,
  Attribute,
  SignedAndUnsignedAttributes,
} from 'pkijs';
import { sha256Hex } from './canonical';
import type { CertificateProvider } from './certificates';
import type { KeyManagementProvider, KeyMetadata, ProviderHealth } from './key-management';
import { CertificationError } from './types';
import type {
  TimestampAuthorityProvider,
  TimestampResult,
  TimestampVerificationResult,
} from './timestamp';
import { timestampSignatureDigest } from './timestamp';

export type PadesProfile = 'PAdES-B-B' | 'PAdES-B-T';
const RFC3161_SIGNATURE_TIMESTAMP_OID = '1.2.840.113549.1.9.16.2.14';

export type PreparePdfInput = {
  pdfBytes: Uint8Array;
  reason?: string;
  signerName?: string;
  contactInfo?: string;
  location?: string;
};

export type PreparedPdf = {
  pdfBytes: Uint8Array;
  byteRange: [number, number, number, number];
  signedBytes: Uint8Array;
  documentDigestSha256: string;
  contentsStart: number;
  contentsEnd: number;
  signatureHexLength: number;
};

export type EmbedSignatureInput = {
  prepared: PreparedPdf;
  profile: PadesProfile;
  tenantId?: string;
  idempotencyKey?: string;
};

export type SignedPdfResult = {
  pdfBytes: Uint8Array;
  profile: PadesProfile;
  byteRange: [number, number, number, number];
  cmsBytes: Uint8Array;
  cmsHashSha256: string;
  pdfHashAfterSignature: string;
  certificateSerialNumber: string;
  certificateFingerprintSha256: string;
  signatureAlgorithm: 'RSA-PSS-SHA256' | 'RSA-PKCS1-SHA256';
  digestAlgorithm: 'SHA-256';
  signingTimeDeclared: string;
  keyId: string;
  keyVersion: string;
  timestamp: TimestampResult | null;
};

export type VerifyPdfInput = {
  pdfBytes: Uint8Array;
  expectedCertificateFingerprintSha256?: string | null;
};

export type UpgradePadesBtInput = VerifyPdfInput & {
  nonce?: string;
  policyOid?: string;
};

export type PadesBtUpgradeResult = {
  pdfBytes: Uint8Array;
  profile: 'PAdES-B-T';
  byteRange: [number, number, number, number];
  cmsBytes: Uint8Array;
  cmsHashSha256: string;
  pdfHashAfterSignature: string;
  timestamp: TimestampResult;
  verification: PdfVerificationResult;
};

export type PdfVerificationResult = {
  valid: boolean;
  profile: PadesProfile | null;
  byteRangeValid: boolean;
  digestValid: boolean;
  cmsValid: boolean;
  certificateValid: boolean;
  certificateKeyMatches: boolean;
  signatureAlgorithm: 'RSA-PSS-SHA256' | 'RSA-PKCS1-SHA256' | null;
  certificateSerialNumber: string | null;
  certificateFingerprintSha256: string | null;
  byteRange: [number, number, number, number] | null;
  cmsHashSha256: string | null;
  pdfHashAfterSignature: string;
  timestamp: TimestampVerificationResult | null;
  detail: string | null;
};

export interface PdfSignatureProvider {
  preparePdf(input: PreparePdfInput): Promise<PreparedPdf>;
  embedSignature(input: EmbedSignatureInput): Promise<SignedPdfResult>;
  verifyPdf(input: VerifyPdfInput): Promise<PdfVerificationResult>;
  upgradeToPadesBt(input: UpgradePadesBtInput): Promise<PadesBtUpgradeResult>;
  healthCheck(): Promise<ProviderHealth>;
}

const BYTE_RANGE_PLACEHOLDER = '**********';
const SIGNATURE_RESERVATION_BYTES = 24_000;

function buffer(value: Uint8Array | ArrayBuffer) {
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
}

function toArrayBuffer(value: Uint8Array | ArrayBuffer) {
  if (value instanceof ArrayBuffer) return value;
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

// PKI.js supports the Web Crypto API. Node exposes an equivalent implementation,
// but its TypeScript declaration is slightly narrower than the DOM declaration.
const nodeWebCrypto = webcrypto as unknown as Crypto;

function pemDer(pem: string) {
  const base64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return Buffer.from(base64, 'base64');
}

function certificateFromPem(pem: string) {
  const parsed = asn1js.fromBER(pemDer(pem));
  if (parsed.offset === -1)
    throw new CertificationError(
      'PADES_CERTIFICATE_PARSE_FAILED',
      'No se pudo leer el certificado X.509 del firmante.',
      503
    );
  return new Certificate({ schema: parsed.result });
}

function locateSignature(pdf: Uint8Array) {
  const text = buffer(pdf).toString('latin1');
  const byteRangeMatch = /\/ByteRange\s*\[\s*0\s+([^\s\]]+)\s+([^\s\]]+)\s+([^\s\]]+)\s*\]/.exec(
    text
  );
  if (!byteRangeMatch || byteRangeMatch.index === undefined)
    throw new CertificationError(
      'PADES_BYTERANGE_NOT_FOUND',
      'El PDF no contiene un campo ByteRange de firma.',
      422
    );
  const rangeStart = byteRangeMatch.index;
  const rangeEnd = rangeStart + byteRangeMatch[0].length;
  const contentsIndex = text.indexOf('/Contents <', rangeEnd);
  if (contentsIndex < 0)
    throw new CertificationError(
      'PADES_CONTENTS_NOT_FOUND',
      'El PDF no contiene un contenedor CMS de firma.',
      422
    );
  const contentsStart = contentsIndex + '/Contents <'.length;
  const contentsEnd = text.indexOf('>', contentsStart);
  if (contentsEnd < 0)
    throw new CertificationError(
      'PADES_CONTENTS_NOT_CLOSED',
      'El contenedor CMS de firma es invalido.',
      422
    );
  return { byteRangeMatch, rangeStart, rangeEnd, contentsStart, contentsEnd };
}

function writeByteRange(pdf: Uint8Array) {
  const located = locateSignature(pdf);
  const { byteRangeMatch, rangeStart, contentsStart, contentsEnd } = located;
  // ByteRange excludes the complete hex string, including its < and > delimiters.
  const second = contentsStart - 1;
  const third = contentsEnd + 1;
  const fourth = pdf.byteLength - third;
  const tokens = [byteRangeMatch[1], byteRangeMatch[2], byteRangeMatch[3]];
  const widths = tokens.map((value) => value.replace(/^\//, '').length);
  const numbers = [second, third, fourth];
  if (numbers.some((value, index) => String(value).length > widths[index])) {
    throw new CertificationError(
      'PADES_BYTERANGE_OVERFLOW',
      'El PDF excede la reserva del ByteRange.',
      422
    );
  }
  const original = byteRangeMatch[0];
  // @signpdf prefixes the placeholder with a slash in some PDF serializers.
  // Preserve that exact syntax and replace only the three reserved tokens.
  let replacement = original;
  tokens.forEach((token, index) => {
    const prefix = token.startsWith('/') ? '/' : '';
    replacement = replacement.replace(
      token,
      `${prefix}${String(numbers[index]).padStart(widths[index], '0')}`
    );
  });
  if (replacement.length !== original.length)
    throw new CertificationError(
      'PADES_BYTERANGE_LENGTH_INVALID',
      'No fue posible fijar el ByteRange sin alterar el PDF.',
      500
    );
  const output = Buffer.from(pdf);
  output.write(replacement, rangeStart, 'latin1');
  const signedBytes = Buffer.concat([output.subarray(0, second), output.subarray(third)]);
  return {
    pdfBytes: new Uint8Array(output),
    byteRange: [0, second, third, fourth] as [number, number, number, number],
    signedBytes: new Uint8Array(signedBytes),
    contentsStart,
    contentsEnd,
    signatureHexLength: contentsEnd - contentsStart,
  };
}

function validateByteRange(pdf: Uint8Array, byteRange: [number, number, number, number]) {
  const [start, firstLength, secondStart, secondLength] = byteRange;
  return (
    start === 0 &&
    firstLength >= 0 &&
    secondStart > firstLength &&
    secondLength >= 0 &&
    secondStart + secondLength === pdf.byteLength
  );
}

function parseByteRange(pdf: Uint8Array) {
  const located = locateSignature(pdf);
  const values = [
    located.byteRangeMatch[1],
    located.byteRangeMatch[2],
    located.byteRangeMatch[3],
  ].map((value) => Number(value.replace(/^\//, '')));
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new CertificationError(
      'PADES_BYTERANGE_INVALID',
      'El ByteRange del PDF no es valido.',
      422
    );
  return {
    ...located,
    byteRange: [0, values[0], values[1], values[2]] as [number, number, number, number],
  };
}

function detachedBytes(pdf: Uint8Array, byteRange: [number, number, number, number]) {
  return Buffer.concat([
    buffer(pdf).subarray(byteRange[0], byteRange[0] + byteRange[1]),
    buffer(pdf).subarray(byteRange[2], byteRange[2] + byteRange[3]),
  ]);
}

function cmsFromContents(pdf: Uint8Array, start: number, end: number) {
  const hex = buffer(pdf).subarray(start, end).toString('ascii');
  if (!hex || hex.length % 2 || /[^0-9a-f]/i.test(hex))
    throw new CertificationError(
      'PADES_CMS_INVALID',
      'El contenido CMS del PDF no tiene una codificacion valida.',
      422
    );
  // The fixed-width PDF placeholder is zero padded. ASN.1 tells us where the
  // actual CMS ends, which avoids stripping a legitimate terminal zero byte.
  const value = Buffer.from(hex, 'hex');
  const parsed = asn1js.fromBER(value);
  if (parsed.offset === -1)
    throw new CertificationError(
      'PADES_CMS_PARSE_FAILED',
      'El contenido CMS no puede ser interpretado.',
      422
    );
  return value.subarray(0, parsed.offset);
}

function remoteCryptoEngine(
  keyManagement: KeyManagementProvider,
  keyMetadata: KeyMetadata,
  tenantId?: string,
  idempotencyKey?: string
) {
  let remoteSignature: Awaited<ReturnType<KeyManagementProvider['signDigest']>> | null = null;
  const crypto = new CryptoEngine({ name: 'docubox-remote-kms', crypto: nodeWebCrypto });
  (
    crypto as unknown as { signWithPrivateKey: CryptoEngine['signWithPrivateKey'] }
  ).signWithPrivateKey = async (data) => {
    const bytes = new Uint8Array(toArrayBuffer(data as ArrayBuffer));
    remoteSignature = await keyManagement.signDigest({
      purpose: 'PDF_SIGNATURE',
      canonicalBytes: bytes,
      digestSha256: sha256Hex(bytes),
      tenantId,
      idempotencyKey,
    });
    if (
      remoteSignature.algorithm !== keyMetadata.algorithm ||
      remoteSignature.keyId !== keyMetadata.keyId ||
      remoteSignature.keyVersion !== keyMetadata.keyVersion
    ) {
      throw new CertificationError(
        'PADES_KMS_SIGNATURE_MISMATCH',
        'La firma CMS no corresponde a la llave KMS validada.',
        502
      );
    }
    return toArrayBuffer(Buffer.from(remoteSignature.signatureBase64, 'base64'));
  };
  return { crypto, signature: () => remoteSignature };
}

function remotePrivateKey(keyMetadata: KeyMetadata): CryptoKey {
  const name = keyMetadata.algorithm === 'RSA-PKCS1-SHA256' ? 'RSASSA-PKCS1-v1_5' : 'RSA-PSS';
  return {
    type: 'private',
    extractable: false,
    algorithm: {
      name,
      hash: { name: 'SHA-256' },
      modulusLength: keyMetadata.keySizeBits,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    usages: ['sign'],
  } as unknown as CryptoKey;
}

export class PadesBbPdfSignatureProvider implements PdfSignatureProvider {
  readonly providerId = 'pades-remote-kms' as const;

  constructor(
    private readonly keyManagement: KeyManagementProvider,
    private readonly certificateProvider: CertificateProvider,
    private readonly timestampAuthority?: TimestampAuthorityProvider
  ) {}

  async preparePdf(input: PreparePdfInput): Promise<PreparedPdf> {
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(toArrayBuffer(input.pdfBytes), {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch {
      throw new CertificationError(
        'PADES_SOURCE_PDF_INVALID',
        'El archivo fuente no es un PDF firmable valido.',
        422
      );
    }
    if (pdf.getPageCount() === 0)
      throw new CertificationError(
        'PADES_SOURCE_PDF_EMPTY',
        'El PDF no contiene paginas para firmar.',
        422
      );
    pdflibAddPlaceholder({
      pdfDoc: pdf,
      reason: input.reason || 'Certificacion criptografica Docubox',
      contactInfo: input.contactInfo || 'https://docubox.mx',
      name: input.signerName || 'Docubox',
      location: input.location || 'Mexico',
      signatureLength: SIGNATURE_RESERVATION_BYTES,
      byteRangePlaceholder: BYTE_RANGE_PLACEHOLDER,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      appName: 'Docubox PAdES',
    });
    const serialized = await pdf.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false,
    });
    const prepared = writeByteRange(serialized);
    return { ...prepared, documentDigestSha256: sha256Hex(prepared.signedBytes) };
  }

  async embedSignature(input: EmbedSignatureInput): Promise<SignedPdfResult> {
    const certificateResult = await this.certificateProvider.verifyCertificateChain();
    if (
      (certificateResult.status !== 'valid' && certificateResult.status !== 'expiring_soon') ||
      !certificateResult.certificate ||
      !certificateResult.keyMatches ||
      !certificateResult.chainValid
    ) {
      throw new CertificationError(
        'PADES_CERTIFICATE_INVALID',
        'No existe un certificado X.509 valido vinculado a la llave administrada.',
        503
      );
    }
    const fallbackKeyHealth = certificateResult.keyId
      ? null
      : await this.keyManagement.healthCheck();
    const signingKeyId = certificateResult.keyId || fallbackKeyHealth?.keyId;
    if (!signingKeyId)
      throw new CertificationError(
        'PADES_SIGNING_KEY_ID_MISSING',
        'No se identifico la llave KMS vinculada al certificado.',
        503
      );
    const keyMetadata = await this.keyManagement.getKeyMetadata(signingKeyId);
    const certificate = certificateResult.certificate;
    const pkijsCertificate = certificateFromPem(certificate.pem);
    const signedData = new SignedData({
      version: 1,
      encapContentInfo: new EncapsulatedContentInfo({ eContentType: SignedData.ID_DATA }),
      certificates: [pkijsCertificate],
      signerInfos: [
        new SignerInfo({
          version: 1,
          sid: new IssuerAndSerialNumber({
            issuer: pkijsCertificate.issuer,
            serialNumber: pkijsCertificate.serialNumber,
          }),
        }),
      ],
    });
    const remote = remoteCryptoEngine(
      this.keyManagement,
      keyMetadata,
      input.tenantId,
      input.idempotencyKey
    );
    await signedData.sign(
      remotePrivateKey(keyMetadata),
      0,
      'SHA-256',
      toArrayBuffer(input.prepared.signedBytes),
      remote.crypto
    );
    const remoteSignature = remote.signature();
    if (!remoteSignature)
      throw new CertificationError(
        'PADES_REMOTE_SIGNATURE_MISSING',
        'El proveedor de llaves no devolvio una firma CMS.',
        502
      );
    let timestamp: TimestampResult | null = null;
    if (input.profile === 'PAdES-B-T') {
      if (!this.timestampAuthority) {
        throw new CertificationError(
          'PADES_TIMESTAMP_NOT_CONFIGURED',
          'No existe un proveedor TSA para completar PAdES-B-T.',
          503
        );
      }
      const signatureValue = new Uint8Array(
        signedData.signerInfos[0].signature.valueBlock.valueHexView
      );
      timestamp = await this.timestampAuthority.timestampDigest({
        digest: timestampSignatureDigest(signatureValue),
        digestAlgorithm: 'SHA-256',
        messageImprintData: signatureValue,
      });
      if (!timestamp.verification.valid) {
        throw new CertificationError(
          'PADES_TIMESTAMP_INVALID',
          timestamp.verification.detail || 'El TimeStampToken RFC 3161 no es valido.',
          502
        );
      }
      const tokenAsn = asn1js.fromBER(toArrayBuffer(timestamp.token));
      if (tokenAsn.offset === -1)
        throw new CertificationError(
          'PADES_TIMESTAMP_PARSE_FAILED',
          'No se pudo incorporar el TimeStampToken al CMS.',
          502
        );
      signedData.signerInfos[0].unsignedAttrs = new SignedAndUnsignedAttributes({
        type: 1,
        attributes: [
          new Attribute({ type: RFC3161_SIGNATURE_TIMESTAMP_OID, values: [tokenAsn.result] }),
        ],
      });
    }
    const contentInfo = new ContentInfo({
      contentType: ContentInfo.SIGNED_DATA,
      content: signedData.toSchema(true),
    });
    const cmsBytes = new Uint8Array(contentInfo.toSchema().toBER(false));
    if (cmsBytes.byteLength * 2 > input.prepared.signatureHexLength) {
      throw new CertificationError(
        'PADES_CMS_TOO_LARGE',
        'El CMS excede la reserva del campo de firma PDF.',
        422
      );
    }
    const output = Buffer.from(input.prepared.pdfBytes);
    const cmsHex = buffer(cmsBytes).toString('hex').toUpperCase();
    output.write(
      cmsHex.padEnd(input.prepared.signatureHexLength, '0'),
      input.prepared.contentsStart,
      'ascii'
    );
    const pdfBytes = new Uint8Array(output);
    const verification = await this.verifyPdf({
      pdfBytes,
      expectedCertificateFingerprintSha256: certificate.fingerprintSha256,
    });
    if (!verification.valid)
      throw new CertificationError(
        'PADES_POST_SIGN_VERIFICATION_FAILED',
        verification.detail || 'La firma PAdES no pudo verificarse.',
        502
      );
    return {
      pdfBytes,
      profile: input.profile,
      byteRange: input.prepared.byteRange,
      cmsBytes,
      cmsHashSha256: sha256Hex(cmsBytes),
      pdfHashAfterSignature: sha256Hex(pdfBytes),
      certificateSerialNumber: certificate.serialNumber,
      certificateFingerprintSha256: certificate.fingerprintSha256,
      signatureAlgorithm: remoteSignature.algorithm,
      digestAlgorithm: 'SHA-256',
      signingTimeDeclared: new Date().toISOString(),
      keyId: remoteSignature.keyId,
      keyVersion: remoteSignature.keyVersion,
      timestamp,
    };
  }

  async verifyPdf(input: VerifyPdfInput): Promise<PdfVerificationResult> {
    const pdfHashAfterSignature = sha256Hex(input.pdfBytes);
    try {
      const located = parseByteRange(input.pdfBytes);
      const byteRangeValid = validateByteRange(input.pdfBytes, located.byteRange);
      if (!byteRangeValid)
        throw new CertificationError(
          'PADES_BYTERANGE_INVALID',
          'El ByteRange no corresponde al PDF firmado.',
          422
        );
      const cmsBytes = cmsFromContents(input.pdfBytes, located.contentsStart, located.contentsEnd);
      const cms = ContentInfo.fromBER(cmsBytes);
      if (cms.contentType !== ContentInfo.SIGNED_DATA)
        throw new CertificationError(
          'PADES_CMS_TYPE_INVALID',
          'El CMS no contiene SignedData.',
          422
        );
      const signedData = new SignedData({ schema: cms.content });
      const data = detachedBytes(input.pdfBytes, located.byteRange);
      const result = await signedData.verify(
        { signer: 0, data: toArrayBuffer(data), checkChain: false, extendedMode: true },
        new CryptoEngine({ name: 'node-webcrypto', crypto: nodeWebCrypto })
      );
      const signer = result.signerCertificate;
      const signerPem = signer
        ? `-----BEGIN CERTIFICATE-----\n${buffer(signer.toSchema().toBER(false))
            .toString('base64')
            .match(/.{1,64}/g)
            ?.join('\n')}\n-----END CERTIFICATE-----\n`
        : null;
      const signerMeta = signerPem ? certificateFromPem(signerPem) : null;
      const parsedFingerprint = signerPem
        ? new X509Certificate(signerPem).fingerprint256.replace(/:/g, '').toLowerCase()
        : null;
      const managedCertificate = await this.certificateProvider.verifyCertificateChain();
      const expectedFingerprintMatches =
        !input.expectedCertificateFingerprintSha256 ||
        parsedFingerprint === input.expectedCertificateFingerprintSha256.toLowerCase();
      const managedFingerprintMatches = Boolean(
        managedCertificate.certificate &&
        parsedFingerprint === managedCertificate.certificate.fingerprintSha256
      );
      const certificateKeyMatches = managedCertificate.keyMatches && managedFingerprintMatches;
      const certificateValid =
        Boolean(result.signerCertificateVerified) &&
        expectedFingerprintMatches &&
        managedCertificate.chainValid &&
        certificateKeyMatches;
      const cmsValid = result.signatureVerified === true;
      const signatureOid = signedData.signerInfos[0]?.signatureAlgorithm.algorithmId;
      const signatureAlgorithm =
        signatureOid === '1.2.840.113549.1.1.10'
          ? 'RSA-PSS-SHA256'
          : signatureOid === '1.2.840.113549.1.1.1' || signatureOid === '1.2.840.113549.1.1.11'
            ? 'RSA-PKCS1-SHA256'
            : null;
      const timestampAttribute = signedData.signerInfos[0]?.unsignedAttrs?.attributes.find(
        (attribute) => attribute.type === RFC3161_SIGNATURE_TIMESTAMP_OID
      );
      let timestamp: TimestampVerificationResult | null = null;
      if (timestampAttribute) {
        const token = new Uint8Array(timestampAttribute.values[0].toBER(false));
        const signatureValue = new Uint8Array(
          signedData.signerInfos[0].signature.valueBlock.valueHexView
        );
        timestamp = this.timestampAuthority
          ? await this.timestampAuthority.verifyTimestamp(token, {
              expectedDigest: timestampSignatureDigest(signatureValue),
              messageImprintData: signatureValue,
            })
          : {
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
              tsaCertificateSubject: null,
              detail: 'RFC3161_PROVIDER_NOT_CONFIGURED',
            };
      }
      const profile: PadesProfile = timestampAttribute ? 'PAdES-B-T' : 'PAdES-B-B';
      return {
        valid:
          byteRangeValid &&
          cmsValid &&
          certificateValid &&
          (profile === 'PAdES-B-B' || timestamp?.valid === true),
        profile,
        byteRangeValid,
        digestValid: cmsValid,
        cmsValid,
        certificateValid,
        certificateKeyMatches,
        signatureAlgorithm,
        certificateSerialNumber: signerMeta
          ? Buffer.from(signerMeta.serialNumber.valueBlock.valueHexView)
              .toString('hex')
              .toUpperCase()
          : null,
        certificateFingerprintSha256: parsedFingerprint,
        byteRange: located.byteRange,
        cmsHashSha256: sha256Hex(cmsBytes),
        pdfHashAfterSignature,
        timestamp,
        detail:
          cmsValid && certificateValid && (profile === 'PAdES-B-B' || timestamp?.valid)
            ? null
            : 'La verificacion CMS, certificado o estampa RFC 3161 no superaron la validacion.',
      };
    } catch (error) {
      return {
        valid: false,
        profile: null,
        byteRangeValid: false,
        digestValid: false,
        cmsValid: false,
        certificateValid: false,
        certificateKeyMatches: false,
        signatureAlgorithm: null,
        certificateSerialNumber: null,
        certificateFingerprintSha256: null,
        byteRange: null,
        cmsHashSha256: null,
        pdfHashAfterSignature,
        timestamp: null,
        detail: error instanceof CertificationError ? error.code : 'PADES_VERIFICATION_FAILED',
      };
    }
  }

  /**
   * Elevates an already verified B-B signature by adding only the RFC 3161
   * SignatureTimeStamp unsigned attribute. The KMS signature and ByteRange are
   * preserved; the document is never signed a second time.
   */
  async upgradeToPadesBt(input: UpgradePadesBtInput): Promise<PadesBtUpgradeResult> {
    if (!this.timestampAuthority) {
      throw new CertificationError(
        'PADES_TIMESTAMP_NOT_CONFIGURED',
        'No existe un proveedor TSA para completar PAdES-B-T.',
        503
      );
    }
    const baseline = await this.verifyPdf(input);
    if (!baseline.valid || baseline.profile !== 'PAdES-B-B' || !baseline.byteRange) {
      throw new CertificationError(
        'PADES_BB_BASELINE_INVALID',
        'El PDF de origen no es un PAdES-B-B verificable.',
        409
      );
    }

    const located = parseByteRange(input.pdfBytes);
    const currentCms = cmsFromContents(input.pdfBytes, located.contentsStart, located.contentsEnd);
    const contentInfo = ContentInfo.fromBER(currentCms);
    if (contentInfo.contentType !== ContentInfo.SIGNED_DATA) {
      throw new CertificationError(
        'PADES_CMS_TYPE_INVALID',
        'El CMS B-B no contiene SignedData.',
        422
      );
    }
    const signedData = new SignedData({ schema: contentInfo.content });
    const signerInfo = signedData.signerInfos[0];
    if (!signerInfo)
      throw new CertificationError(
        'PADES_SIGNER_INFO_MISSING',
        'El CMS B-B no contiene SignerInfo.',
        422
      );
    if (
      signerInfo.unsignedAttrs?.attributes.some(
        (attribute) => attribute.type === RFC3161_SIGNATURE_TIMESTAMP_OID
      )
    ) {
      throw new CertificationError(
        'PADES_TIMESTAMP_ALREADY_PRESENT',
        'El PDF ya contiene un SignatureTimeStamp RFC 3161.',
        409
      );
    }

    const signatureValue = new Uint8Array(signerInfo.signature.valueBlock.valueHexView);
    const timestamp = await this.timestampAuthority.timestampDigest({
      digest: timestampSignatureDigest(signatureValue),
      digestAlgorithm: 'SHA-256',
      messageImprintData: signatureValue,
      nonce: input.nonce,
      policyOid: input.policyOid,
    });
    if (!timestamp.verification.valid) {
      throw new CertificationError(
        'PADES_TIMESTAMP_INVALID',
        timestamp.verification.detail || 'El TimeStampToken RFC 3161 no es valido.',
        502
      );
    }

    const tokenAsn = asn1js.fromBER(toArrayBuffer(timestamp.token));
    if (tokenAsn.offset === -1) {
      throw new CertificationError(
        'PADES_TIMESTAMP_PARSE_FAILED',
        'No se pudo incorporar el TimeStampToken al CMS.',
        502
      );
    }
    signerInfo.unsignedAttrs = new SignedAndUnsignedAttributes({
      type: 1,
      attributes: [
        new Attribute({ type: RFC3161_SIGNATURE_TIMESTAMP_OID, values: [tokenAsn.result] }),
      ],
    });

    const upgradedContentInfo = new ContentInfo({
      contentType: ContentInfo.SIGNED_DATA,
      content: signedData.toSchema(true),
    });
    const cmsBytes = new Uint8Array(upgradedContentInfo.toSchema().toBER(false));
    const signatureHexLength = located.contentsEnd - located.contentsStart;
    if (cmsBytes.byteLength * 2 > signatureHexLength) {
      throw new CertificationError(
        'PADES_CMS_TOO_LARGE',
        'El CMS B-T excede la reserva del campo de firma PDF.',
        422
      );
    }
    const output = Buffer.from(input.pdfBytes);
    output.write(
      buffer(cmsBytes).toString('hex').toUpperCase().padEnd(signatureHexLength, '0'),
      located.contentsStart,
      'ascii'
    );
    const pdfBytes = new Uint8Array(output);
    const verification = await this.verifyPdf({
      pdfBytes,
      expectedCertificateFingerprintSha256: input.expectedCertificateFingerprintSha256,
    });
    if (
      !verification.valid ||
      verification.profile !== 'PAdES-B-T' ||
      !verification.timestamp?.valid
    ) {
      throw new CertificationError(
        'PADES_BT_POST_UPGRADE_VERIFICATION_FAILED',
        verification.detail || 'El PDF PAdES-B-T no supero la verificacion posterior.',
        502
      );
    }
    return {
      pdfBytes,
      profile: 'PAdES-B-T',
      byteRange: baseline.byteRange,
      cmsBytes,
      cmsHashSha256: sha256Hex(cmsBytes),
      pdfHashAfterSignature: sha256Hex(pdfBytes),
      timestamp,
      verification,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const [key, certificate] = await Promise.all([
      this.keyManagement.healthCheck(),
      this.certificateProvider.healthCheck(),
    ]);
    return {
      ready: key.ready && certificate.ready,
      missing: [...new Set([...key.missing, ...certificate.missing])],
      provider: this.providerId,
      keyId: key.keyId,
      keyVersion: key.keyVersion,
    };
  }
}
