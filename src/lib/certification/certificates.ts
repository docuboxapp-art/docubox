import { createPublicKey, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sha256Hex } from './canonical';
import type { KeyManagementProvider, ProviderHealth } from './key-management';
import { CertificationError } from './types';

export type CertificateStatus = 'valid' | 'expiring_soon' | 'expired' | 'not_yet_valid' | 'invalid_chain' | 'key_mismatch' | 'environment_mismatch' | 'not_configured';

export type X509CertificateData = {
  pem: string;
  serialNumber: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
  signatureAlgorithm: string;
  publicKeyAlgorithm: string;
  keyUsage: string[];
  extendedKeyUsage: string[];
  environment: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
};

export type CertificateVerificationResult = {
  status: CertificateStatus;
  trusted: boolean;
  keyMatches: boolean;
  chainValid: boolean;
  expiresInDays: number | null;
  certificate: X509CertificateData | null;
  keyId?: string | null;
  keyVersion?: string | null;
  detail: string | null;
};

export type CertificateMetadata = X509CertificateData & { chainStatus: CertificateStatus };

export interface CertificateProvider {
  getSigningCertificate(): Promise<X509CertificateData>;
  getCertificateChain(): Promise<X509CertificateData[]>;
  verifyCertificateChain(): Promise<CertificateVerificationResult>;
  getCertificateMetadata(): Promise<CertificateMetadata>;
  healthCheck(): Promise<ProviderHealth>;
}

export type CertificateConfiguration = {
  environment: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  signingCertificatePem?: string | null;
  signingCertificatePath?: string | null;
  trustRootPem?: string | null;
  trustRootPath?: string | null;
  chainPem?: string | null;
  chainPath?: string | null;
  signingKeyId: string | null;
  expiringSoonDays: number;
};

function configuredValue(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function environmentValue() {
  const environment = String(process.env.DOCUBOX_CRYPTO_ENVIRONMENT || process.env.DOCUBOX_EXECUTION_ENVIRONMENT || 'DEVELOPMENT').toUpperCase();
  if (environment !== 'DEVELOPMENT' && environment !== 'STAGING' && environment !== 'PRODUCTION') {
    throw new CertificationError('CERTIFICATE_ENVIRONMENT_INVALID', 'El entorno del certificado no es valido.', 503);
  }
  return environment;
}

function certificatePemBlocks(value: string) {
  return value.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

async function pemValue(inline: string | null | undefined, filePath: string | null | undefined) {
  if (inline) return inline.replace(/\\n/g, '\n');
  if (filePath) return readFile(filePath, 'utf8');
  return null;
}

function toIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CertificationError('CERTIFICATE_DATE_INVALID', 'El certificado contiene una fecha invalida.', 502);
  return date.toISOString();
}

function publicKeyDer(value: string | X509Certificate) {
  const key = typeof value === 'string' ? createPublicKey(value) : value.publicKey;
  return Buffer.from(key.export({ type: 'spki', format: 'der' }));
}

function samePublicKey(left: string | X509Certificate, right: string | X509Certificate) {
  const leftDer = publicKeyDer(left);
  const rightDer = publicKeyDer(right);
  return leftDer.length === rightDer.length && timingSafeEqual(leftDer, rightDer);
}

function metadata(certificate: X509Certificate, pem: string, environment: CertificateConfiguration['environment']): X509CertificateData {
  return {
    pem,
    serialNumber: certificate.serialNumber,
    subject: certificate.subject,
    issuer: certificate.issuer,
    notBefore: toIso(certificate.validFrom),
    notAfter: toIso(certificate.validTo),
    fingerprintSha256: certificate.fingerprint256.replace(/:/g, '').toLowerCase(),
    // Node exposes the verified X.509 signature but not its ASN.1 algorithm OID.
    // Keep this honest until a dedicated ASN.1 reader is introduced.
    signatureAlgorithm: 'not_available',
    publicKeyAlgorithm: certificate.publicKey.asymmetricKeyType || 'unknown',
    keyUsage: certificate.keyUsage || [],
    // Node's X509Certificate exposes the EKU identifiers through keyUsage.
    // It does not expose a separate basic key-usage extension reader.
    extendedKeyUsage: certificate.keyUsage || [],
    environment,
  };
}

export function evaluateCertificateStatus(input: {
  environmentMatches: boolean;
  keyMatches: boolean;
  chainValid: boolean;
  notBefore: string;
  notAfter: string;
  expiringSoonDays: number;
  now?: number;
}): { status: CertificateStatus; expiresInDays: number } {
  const now = input.now ?? Date.now();
  const notBefore = Date.parse(input.notBefore);
  const notAfter = Date.parse(input.notAfter);
  const expiresInDays = Math.floor((notAfter - now) / 86_400_000);
  if (!input.environmentMatches) return { status: 'environment_mismatch', expiresInDays };
  if (!input.keyMatches) return { status: 'key_mismatch', expiresInDays };
  if (!input.chainValid) return { status: 'invalid_chain', expiresInDays };
  if (notBefore > now) return { status: 'not_yet_valid', expiresInDays };
  if (notAfter <= now) return { status: 'expired', expiresInDays };
  return { status: expiresInDays <= input.expiringSoonDays ? 'expiring_soon' : 'valid', expiresInDays };
}

function derLength(length: number) {
  if (length < 128) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining) { bytes.unshift(remaining & 0xff); remaining >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Uint8Array) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), Buffer.from(content)]);
}

function derSequence(...values: Uint8Array[]) { return der(0x30, Buffer.concat(values.map((value) => Buffer.from(value)))); }
function derSet(...values: Uint8Array[]) { return der(0x31, Buffer.concat(values.map((value) => Buffer.from(value)))); }
function derUtf8(value: string) { return der(0x0c, Buffer.from(value, 'utf8')); }
function derInteger(value: number) { return der(0x02, Buffer.from([value])); }
function derIntegerBytes(value: Uint8Array) {
  let bytes = Buffer.from(value);
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.subarray(1);
  if ((bytes[0] & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}
function derBitString(value: Uint8Array) { return der(0x03, Buffer.concat([Buffer.from([0]), Buffer.from(value)])); }
function derExplicit(tag: number, value: Uint8Array) { return der(0xa0 + tag, value); }
function derPrintable(value: string) { return der(0x13, Buffer.from(value, 'ascii')); }
function derUtcTime(value: Date) {
  const text = value.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:T]/g, '').slice(2);
  return der(0x17, Buffer.from(text, 'ascii'));
}

function derOid(value: string) {
  const arcs = value.split('.').map((arc) => Number(arc));
  if (arcs.length < 2 || arcs.some((arc) => !Number.isInteger(arc) || arc < 0)) throw new CertificationError('CSR_OID_INVALID', 'La CSR contiene un OID invalido.', 422);
  const result = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const bytes = [arc & 0x7f];
    let remaining = arc >>> 7;
    while (remaining) { bytes.unshift(0x80 | (remaining & 0x7f)); remaining >>>= 7; }
    result.push(...bytes);
  }
  return der(0x06, Buffer.from(result));
}

function algorithmIdentifier(oid: string, parameters?: Uint8Array) {
  return parameters ? derSequence(derOid(oid), parameters) : derSequence(derOid(oid), Buffer.from([0x05, 0x00]));
}

function rsaSignatureAlgorithmIdentifier(algorithm: 'RSA-PSS-SHA256' | 'RSA-PKCS1-SHA256') {
  if (algorithm === 'RSA-PKCS1-SHA256') {
    return algorithmIdentifier('1.2.840.113549.1.1.11');
  }
  const sha256 = algorithmIdentifier('2.16.840.1.101.3.4.2.1');
  const mgf1 = algorithmIdentifier('1.2.840.113549.1.1.8', sha256);
  const pssParameters = derSequence(derExplicit(0, sha256), derExplicit(1, mgf1), derExplicit(2, derInteger(32)));
  return algorithmIdentifier('1.2.840.113549.1.1.10', pssParameters);
}

function pem(label: string, bytes: Uint8Array) {
  const encoded = Buffer.from(bytes).toString('base64').match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----\n`;
}

export type CsrSubject = { commonName: string; organization: string; organizationalUnit: string; country: string };
export type Pkcs10Csr = { der: Uint8Array; pem: string; sha256: string; publicKeyFingerprintSha256: string; keyId: string; keyVersion: string };

function subjectName(subject: CsrSubject) {
  return derSequence(
    derSet(derSequence(derOid('2.5.4.3'), derUtf8(subject.commonName))),
    derSet(derSequence(derOid('2.5.4.10'), derUtf8(subject.organization))),
    derSet(derSequence(derOid('2.5.4.11'), derUtf8(subject.organizationalUnit))),
    derSet(derSequence(derOid('2.5.4.6'), derPrintable(subject.country))),
  );
}

/** Builds a PKCS#10 request whose CertificationRequestInfo is signed by the remote KMS key. */
export async function createRemotePkcs10Csr(keyProvider: KeyManagementProvider, keyId: string, subject: CsrSubject): Promise<Pkcs10Csr> {
  const publicKeyPem = await keyProvider.getPublicKey(keyId);
  const subjectDer = subjectName(subject);
  const requestInfo = derSequence(derInteger(0), subjectDer, publicKeyDer(publicKeyPem));
  const signature = await keyProvider.signDigest({
    purpose: 'DOCUMENT_SEAL', canonicalBytes: requestInfo, digestSha256: sha256Hex(requestInfo),
  });
  const csr = derSequence(requestInfo, rsaSignatureAlgorithmIdentifier(signature.algorithm), derBitString(Buffer.from(signature.signatureBase64, 'base64')));
  return {
    der: csr,
    pem: pem('CERTIFICATE REQUEST', csr),
    sha256: sha256Hex(csr),
    publicKeyFingerprintSha256: sha256Hex(publicKeyDer(publicKeyPem)),
    keyId: signature.keyId,
    keyVersion: signature.keyVersion,
  };
}

export type GeneratedManagedCertificate = {
  certificate: X509CertificateData;
  certificatePem: string;
  publicKeyFingerprintSha256: string;
  keyId: string;
  keyVersion: string;
};

export type GeneratedDevelopmentCertificate = GeneratedManagedCertificate;

async function createKmsSelfSignedCertificate(input: {
  keyProvider: KeyManagementProvider;
  keyId: string;
  subject: CsrSubject;
  environment: CertificateConfiguration['environment'];
  validityDays?: number;
  now?: Date;
}): Promise<GeneratedManagedCertificate> {
  const keyMetadata = await input.keyProvider.getKeyMetadata(input.keyId);
  const publicKeyPem = keyMetadata.publicKeyPem || await input.keyProvider.getPublicKey(input.keyId);
  const signatureAlgorithm = rsaSignatureAlgorithmIdentifier(keyMetadata.algorithm);
  const subject = subjectName(input.subject);
  const now = input.now ? new Date(input.now) : new Date();
  const notBefore = new Date(now.getTime() - 5 * 60_000);
  const validityDays = Math.max(1, Math.min(input.validityDays ?? 90, 825));
  const notAfter = new Date(now.getTime() + validityDays * 86_400_000);
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  if (serial.every((byte) => byte === 0)) serial[serial.length - 1] = 1;
  const tbsCertificate = derSequence(
    derExplicit(0, derInteger(2)),
    derIntegerBytes(serial),
    signatureAlgorithm,
    subject,
    derSequence(derUtcTime(notBefore), derUtcTime(notAfter)),
    subject,
    publicKeyDer(publicKeyPem),
  );
  const signature = await input.keyProvider.signDigest({
    purpose: 'DOCUMENT_SEAL',
    canonicalBytes: tbsCertificate,
    digestSha256: sha256Hex(tbsCertificate),
  });
  if (signature.algorithm !== keyMetadata.algorithm || signature.keyId !== keyMetadata.keyId || signature.keyVersion !== keyMetadata.keyVersion) {
    throw new CertificationError('CERTIFICATE_KMS_SIGNATURE_MISMATCH', 'La firma del certificado no corresponde a la llave KMS configurada.', 502);
  }
  const certificateDer = derSequence(
    tbsCertificate,
    signatureAlgorithm,
    derBitString(Buffer.from(signature.signatureBase64, 'base64')),
  );
  const certificatePem = pem('CERTIFICATE', certificateDer);
  const parsed = new X509Certificate(certificatePem);
  if (!parsed.verify(parsed.publicKey) || !samePublicKey(parsed, publicKeyPem)) {
    throw new CertificationError('CERTIFICATE_KEY_MISMATCH', 'El certificado generado no esta vinculado a la llave publica de KMS.', 502);
  }
  return {
    certificate: { ...metadata(parsed, certificatePem, input.environment), signatureAlgorithm: signature.algorithm },
    certificatePem,
    publicKeyFingerprintSha256: sha256Hex(publicKeyDer(publicKeyPem)),
    keyId: signature.keyId,
    keyVersion: signature.keyVersion,
  };
}

/** Creates a development certificate without generating or exporting another private key. */
export function createKmsSelfSignedDevelopmentCertificate(input: {
  keyProvider: KeyManagementProvider;
  keyId: string;
  subject: CsrSubject;
  validityDays?: number;
  now?: Date;
}) {
  return createKmsSelfSignedCertificate({ ...input, environment: 'DEVELOPMENT' });
}

/**
 * Creates a private-trust production certificate whose self-signature is made
 * by the configured HSM key. It never generates or exports a private key.
 */
export async function createKmsSelfSignedProductionCertificate(input: {
  keyProvider: KeyManagementProvider;
  keyId: string;
  subject: CsrSubject;
  validityDays?: number;
  now?: Date;
}) {
  const metadata = await input.keyProvider.getKeyMetadata(input.keyId);
  if (metadata.protectionLevel !== 'hsm') {
    throw new CertificationError('PRODUCTION_HSM_REQUIRED', 'El certificado productivo debe estar vinculado a una llave HSM.', 503);
  }
  if (/development|sandbox|test/i.test(Object.values(input.subject).join(' '))) {
    throw new CertificationError('PRODUCTION_CERTIFICATE_SUBJECT_INVALID', 'El subject productivo no puede identificar un entorno de desarrollo o pruebas.', 422);
  }
  return createKmsSelfSignedCertificate({ ...input, environment: 'PRODUCTION' });
}

/** Development-only certificate provider. It reads public certificate material and checks it against the KMS public key. */
export class DevelopmentCertificateProvider implements CertificateProvider {
  readonly providerId: string;

  constructor(
    private readonly keyProvider: KeyManagementProvider,
    private readonly config: CertificateConfiguration,
    providerId = 'development-x509',
  ) {
    this.providerId = providerId;
  }

  static fromEnvironment(keyProvider: KeyManagementProvider) {
    const threshold = Number(process.env.DOCUBOX_CERTIFICATE_EXPIRING_SOON_DAYS || 30);
    return new DevelopmentCertificateProvider(keyProvider, {
      environment: environmentValue(),
      signingCertificatePem: configuredValue('DOCUBOX_SIGNING_CERTIFICATE_PEM'),
      signingCertificatePath: configuredValue('DOCUBOX_SIGNING_CERTIFICATE_PATH'),
      trustRootPem: configuredValue('DOCUBOX_DEVELOPMENT_ROOT_CERTIFICATE_PEM'),
      trustRootPath: configuredValue('DOCUBOX_DEVELOPMENT_ROOT_CERTIFICATE_PATH'),
      chainPem: configuredValue('DOCUBOX_SIGNING_CERTIFICATE_CHAIN_PEM'),
      chainPath: configuredValue('DOCUBOX_SIGNING_CERTIFICATE_CHAIN_PATH'),
      signingKeyId: configuredValue('DOCUBOX_SIGNING_CERTIFICATE_KEY_ID') || configuredValue('GOOGLE_KMS_KEY_NAME') || configuredValue('OPENBAO_TRANSIT_DOCUMENT_KEY'),
      expiringSoonDays: Number.isFinite(threshold) && threshold >= 1 ? threshold : 30,
    });
  }

  private async signingPem() {
    const value = await pemValue(this.config.signingCertificatePem, this.config.signingCertificatePath);
    const certificate = value && certificatePemBlocks(value)[0];
    if (!certificate) throw new CertificationError('SIGNING_CERTIFICATE_NOT_CONFIGURED', 'El certificado firmante X.509 no esta configurado.', 503);
    return certificate;
  }

  async getSigningCertificate() {
    const certificatePem = await this.signingPem();
    return metadata(new X509Certificate(certificatePem), certificatePem, this.config.environment);
  }

  async getCertificateChain() {
    const signing = await this.signingPem();
    const configuredChain = await pemValue(this.config.chainPem, this.config.chainPath);
    const configuredRoot = await pemValue(this.config.trustRootPem, this.config.trustRootPath);
    const blocks = [signing, ...(configuredChain ? certificatePemBlocks(configuredChain) : []), ...(configuredRoot ? certificatePemBlocks(configuredRoot) : [])];
    const seen = new Set<string>();
    return blocks.filter((block) => {
      const fingerprint = new X509Certificate(block).fingerprint256;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    }).map((block) => metadata(new X509Certificate(block), block, this.config.environment));
  }

  async verifyCertificateChain(): Promise<CertificateVerificationResult> {
    try {
      if (!this.config.signingKeyId) return { status: 'not_configured', trusted: false, keyMatches: false, chainValid: false, expiresInDays: null, certificate: null, detail: 'SIGNING_CERTIFICATE_KEY_ID' };
      const chain = await this.getCertificateChain();
      const signing = chain[0];
      const leaf = new X509Certificate(signing.pem);
      const rootPem = await pemValue(this.config.trustRootPem, this.config.trustRootPath);
      const rootBlock = rootPem && certificatePemBlocks(rootPem)[0];
      if (!rootBlock) return { status: 'not_configured', trusted: false, keyMatches: false, chainValid: false, expiresInDays: null, certificate: signing, detail: 'DEVELOPMENT_ROOT_CERTIFICATE' };
      const root = new X509Certificate(rootBlock);
      const chainCertificates = chain.map((entry) => new X509Certificate(entry.pem));
      const chainValid = chainCertificates.slice(0, -1).every((certificate, index) => {
        const issuer = chainCertificates[index + 1];
        return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey);
      }) && chainCertificates.at(-1)?.fingerprint256 === root.fingerprint256 && root.checkIssued(root) && root.verify(root.publicKey);
      const keyMetadata = await this.keyProvider.getKeyMetadata(this.config.signingKeyId);
      const providerPublicKey = keyMetadata.publicKeyPem || await this.keyProvider.getPublicKey(this.config.signingKeyId);
      const keyMatches = samePublicKey(leaf, providerPublicKey);
      const developmentNamed = this.config.environment !== 'DEVELOPMENT' || /development/i.test(signing.subject);
      const evaluation = evaluateCertificateStatus({
        environmentMatches: developmentNamed,
        keyMatches,
        chainValid,
        notBefore: signing.notBefore,
        notAfter: signing.notAfter,
        expiringSoonDays: this.config.expiringSoonDays,
      });
      const detailByStatus: Partial<Record<CertificateStatus, string>> = {
        environment_mismatch: 'CERTIFICATE_ENVIRONMENT_MISMATCH',
        key_mismatch: 'CERTIFICATE_KEY_MISMATCH',
        invalid_chain: 'CERTIFICATE_CHAIN_INVALID',
      };
      return {
        status: evaluation.status,
        trusted: evaluation.status === 'valid' || evaluation.status === 'expiring_soon' || evaluation.status === 'expired' || evaluation.status === 'not_yet_valid',
        keyMatches,
        chainValid,
        expiresInDays: evaluation.expiresInDays,
        certificate: signing,
        keyId: keyMetadata.keyId,
        keyVersion: keyMetadata.keyVersion,
        detail: detailByStatus[evaluation.status] || null,
      };
    } catch (error) {
      const detail = error instanceof CertificationError ? error.code : 'CERTIFICATE_VALIDATION_FAILED';
      return { status: 'invalid_chain', trusted: false, keyMatches: false, chainValid: false, expiresInDays: null, certificate: null, detail };
    }
  }

  async getCertificateMetadata() {
    const result = await this.verifyCertificateChain();
    if (!result.certificate) throw new CertificationError('SIGNING_CERTIFICATE_NOT_CONFIGURED', 'No existe un certificado firmante disponible.', 503);
    return { ...result.certificate, chainStatus: result.status };
  }

  async healthCheck() {
    const result = await this.verifyCertificateChain();
    const ready = result.status === 'valid' || result.status === 'expiring_soon';
    return { ready, missing: ready ? [] : [result.detail || result.status], provider: this.providerId, keyId: this.config.signingKeyId || undefined };
  }
}

/**
 * Production X.509 material is configured independently from development and
 * is checked against the non-exportable KMS public key before every use.
 */
export class ProductionCertificateProvider implements CertificateProvider {
  readonly providerId = 'production-x509' as const;
  private readonly delegate: DevelopmentCertificateProvider;

  constructor(keyProvider: KeyManagementProvider, config: CertificateConfiguration) {
    this.delegate = new DevelopmentCertificateProvider(keyProvider, config, this.providerId);
  }

  static fromEnvironment(keyProvider: KeyManagementProvider) {
    const threshold = Number(process.env.DOCUBOX_PRODUCTION_CERTIFICATE_EXPIRING_SOON_DAYS || 30);
    return new ProductionCertificateProvider(keyProvider, {
      environment: 'PRODUCTION',
      signingCertificatePem: configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_PEM'),
      signingCertificatePath: configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_PATH'),
      trustRootPem: configuredValue('DOCUBOX_PRODUCTION_TRUST_ROOT_CERTIFICATE_PEM'),
      trustRootPath: configuredValue('DOCUBOX_PRODUCTION_TRUST_ROOT_CERTIFICATE_PATH'),
      chainPem: configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_CHAIN_PEM'),
      chainPath: configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_CHAIN_PATH'),
      signingKeyId: configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_KEY_ID') || configuredValue('GOOGLE_KMS_PRODUCTION_KEY_NAME'),
      expiringSoonDays: Number.isFinite(threshold) && threshold >= 1 ? threshold : 30,
    });
  }

  static missingConfiguration() {
    const missing: string[] = [];
    if (!configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_PATH') && !configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_PEM')) {
      missing.push('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_PATH');
    }
    if (!configuredValue('DOCUBOX_PRODUCTION_TRUST_ROOT_CERTIFICATE_PATH') && !configuredValue('DOCUBOX_PRODUCTION_TRUST_ROOT_CERTIFICATE_PEM')) {
      missing.push('DOCUBOX_PRODUCTION_TRUST_ROOT_CERTIFICATE_PATH');
    }
    if (!configuredValue('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_KEY_ID') && !configuredValue('GOOGLE_KMS_PRODUCTION_KEY_NAME')) {
      missing.push('DOCUBOX_PRODUCTION_SIGNING_CERTIFICATE_KEY_ID');
    }
    return missing;
  }

  getSigningCertificate() { return this.delegate.getSigningCertificate(); }
  getCertificateChain() { return this.delegate.getCertificateChain(); }

  async verifyCertificateChain() {
    const result = await this.delegate.verifyCertificateChain();
    const developmentNamed = result.certificate && /development/i.test(`${result.certificate.subject} ${result.certificate.issuer}`);
    if (developmentNamed) {
      return { ...result, status: 'environment_mismatch' as const, trusted: false, detail: 'PRODUCTION_CERTIFICATE_DEVELOPMENT_NAMED' };
    }
    return result;
  }

  async getCertificateMetadata() {
    const result = await this.verifyCertificateChain();
    if (!result.certificate) {
      throw new CertificationError('SIGNING_CERTIFICATE_NOT_CONFIGURED', 'No existe un certificado firmante de produccion disponible.', 503);
    }
    return { ...result.certificate, chainStatus: result.status };
  }

  async healthCheck() {
    const requiredMissing = ProductionCertificateProvider.missingConfiguration();
    if (requiredMissing.length) return { ready: false, missing: requiredMissing, provider: this.providerId };
    const result = await this.verifyCertificateChain();
    const ready = result.status === 'valid' || result.status === 'expiring_soon';
    return { ready, missing: ready ? [] : [result.detail || result.status], provider: this.providerId };
  }
}
