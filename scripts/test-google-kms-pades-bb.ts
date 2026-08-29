import { constants, createHash, createPublicKey, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import nextEnv from '@next/env';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

nextEnv.loadEnvConfig(process.cwd());

const developmentKmsDefaults = {
  DOCUBOX_KMS_PROVIDER: 'gcp',
  GOOGLE_CLOUD_PROJECT_ID: 'project-702d9de4-d29c-49f2-82c',
  GOOGLE_KMS_LOCATION: 'us-east1',
  GOOGLE_KMS_KEY_RING: 'docubox-pades',
  GOOGLE_KMS_KEY_NAME: 'docubox-pades-signing',
  GOOGLE_KMS_KEY_VERSION: '1',
  GOOGLE_KMS_ALGORITHM: 'RSA_SIGN_PKCS1_3072_SHA256',
  GOOGLE_KMS_SERVICE_ACCOUNT: 'docubox-pades-signer@project-702d9de4-d29c-49f2-82c.iam.gserviceaccount.com',
};
for (const [name, value] of Object.entries(developmentKmsDefaults)) process.env[name] ||= value;

const execFileAsync = promisify(execFile);
const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-kms-pades-e2e');
const bundlePath = join(cacheDirectory, 'google-kms-pades-e2e.cjs');
const outputDirectory = join(process.cwd(), 'output', 'pdf');
const outputPdf = join(outputDirectory, 'docubox-google-kms-pades-bb-e2e.pdf');
const openssl = process.env.OPENSSL_BIN || (process.platform === 'win32'
  ? 'C:/Program Files/Git/usr/bin/openssl.exe'
  : 'openssl');

function sha256(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

async function loadRuntime() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { GoogleCloudKmsProvider } from './src/lib/certification/key-management';",
        "export { DevelopmentCertificateProvider, createKmsSelfSignedDevelopmentCertificate } from './src/lib/certification/certificates';",
        "export { PadesBbPdfSignatureProvider } from './src/lib/certification/pades';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'google-kms-pades-e2e-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@google-cloud/kms'],
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(bundlePath);
}

async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Docubox', { x: 54, y: 720, size: 26, font: bold, color: rgb(0.12, 0.42, 1) });
  page.drawText('Prueba criptografica PAdES-B-B con Google Cloud KMS', { x: 54, y: 674, size: 16, font: bold });
  page.drawText('Este PDF no contiene datos personales ni una estampa RFC 3161.', { x: 54, y: 642, size: 11, font });
  page.drawText('La firma CMS usa RSA 3072, PKCS#1 v1.5 y SHA-256.', { x: 54, y: 622, size: 11, font });
  return pdf.save({ useObjectStreams: false });
}

function samePublicKey(certificatePem: string, publicKeyPem: string) {
  const certificate = new X509Certificate(certificatePem);
  const certificateSpki = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const kmsSpki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return Buffer.from(certificateSpki).equals(Buffer.from(kmsSpki));
}

try {
  const {
    GoogleCloudKmsProvider,
    DevelopmentCertificateProvider,
    createKmsSelfSignedDevelopmentCertificate,
    PadesBbPdfSignatureProvider,
  } = await loadRuntime();
  const keyProvider = GoogleCloudKmsProvider.fromEnvironment();
  const keyId = process.env.GOOGLE_KMS_KEY_NAME;
  if (!keyId) throw new Error('GOOGLE_KMS_KEY_NAME_MISSING');
  const keyMetadata = await keyProvider.getKeyMetadata(keyId);
  const generated = await createKmsSelfSignedDevelopmentCertificate({
    keyProvider,
    keyId,
    subject: {
      commonName: 'DOCUBOX PAdES Development',
      organization: 'DOCUBOX',
      organizationalUnit: 'Development',
      country: 'MX',
    },
    validityDays: 90,
  });
  if (!samePublicKey(generated.certificatePem, keyMetadata.publicKeyPem)) {
    throw new Error('CERTIFICATE_KEY_MISMATCH');
  }
  const certificateProvider = new DevelopmentCertificateProvider(keyProvider, {
    environment: 'DEVELOPMENT',
    signingCertificatePem: generated.certificatePem,
    trustRootPem: generated.certificatePem,
    signingKeyId: keyId,
    expiringSoonDays: 30,
  }, 'google-kms-development-x509');
  const certificateVerification = await certificateProvider.verifyCertificateChain();
  if (certificateVerification.status !== 'valid' || !certificateVerification.keyMatches || !certificateVerification.chainValid) {
    throw new Error(certificateVerification.detail || 'CERTIFICATE_VERIFICATION_FAILED');
  }

  const pades = new PadesBbPdfSignatureProvider(keyProvider, certificateProvider);
  const prepared = await pades.preparePdf({
    pdfBytes: await sourcePdf(),
    signerName: 'DOCUBOX',
    reason: 'Prueba criptografica PAdES-B-B',
    contactInfo: 'https://docubox.mx',
    location: 'Mexico',
  });
  const signed = await pades.embedSignature({
    prepared,
    profile: 'PAdES-B-B',
    tenantId: '00000000-0000-0000-0000-000000000001',
    idempotencyKey: `gcp-pades-bb-${prepared.documentDigestSha256}`,
  });
  const verification = await pades.verifyPdf({
    pdfBytes: signed.pdfBytes,
    expectedCertificateFingerprintSha256: generated.certificate.fingerprintSha256,
  });
  const signedPdfSyntax = Buffer.from(signed.pdfBytes).toString('latin1');
  if (
    !verification.valid || verification.profile !== 'PAdES-B-B' || !verification.byteRangeValid ||
    !verification.cmsValid || !verification.certificateValid || !verification.certificateKeyMatches ||
    signed.signatureAlgorithm !== 'RSA-PKCS1-SHA256' || signed.keyVersion !== '1' ||
    signed.pdfHashAfterSignature !== sha256(signed.pdfBytes) || signed.timestamp !== null ||
    !signedPdfSyntax.includes('/Type /Sig') || !signedPdfSyntax.includes('/SubFilter /ETSI.CAdES.detached')
  ) {
    throw new Error(`PADES_BB_VERIFICATION_FAILED:${verification.detail || 'INVALID_EVIDENCE'}`);
  }
  const alteredPdf = new Uint8Array(signed.pdfBytes);
  alteredPdf[20] ^= 1;
  const alteredVerification = await pades.verifyPdf({
    pdfBytes: alteredPdf,
    expectedCertificateFingerprintSha256: generated.certificate.fingerprintSha256,
  });
  if (alteredVerification.valid) throw new Error('PADES_BYTE_MUTATION_NOT_DETECTED');

  const independentDirectory = await mkdtemp(join(tmpdir(), 'docubox-kms-pades-openssl-'));
  try {
    const cmsPath = join(independentDirectory, 'signature.cms');
    const contentPath = join(independentDirectory, 'detached-content.bin');
    const verifiedPath = join(independentDirectory, 'verified-content.bin');
    const detached = Buffer.concat([
      Buffer.from(signed.pdfBytes).subarray(0, signed.byteRange[1]),
      Buffer.from(signed.pdfBytes).subarray(signed.byteRange[2], signed.byteRange[2] + signed.byteRange[3]),
    ]);
    await Promise.all([writeFile(cmsPath, signed.cmsBytes), writeFile(contentPath, detached)]);
    await execFileAsync(openssl, ['cms', '-verify', '-binary', '-inform', 'DER', '-in', cmsPath, '-content', contentPath, '-noverify', '-out', verifiedPath], { windowsHide: true });
    if (!(await readFile(verifiedPath)).equals(detached)) throw new Error('OPENSSL_DETACHED_CONTENT_MISMATCH');
  } finally {
    await rm(independentDirectory, { recursive: true, force: true });
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPdf, signed.pdfBytes);

  console.log('Google Cloud KMS + X.509 + PAdES-B-B');
  console.log('---------------------------------------');
  console.log('Authentication / ADC: OK');
  console.log('KMS public key: OK');
  console.log('Development X.509 self-signature: OK');
  console.log('Certificate public key equals KMS public key: true');
  console.log(`KMS public key fingerprint SHA-256: ${generated.publicKeyFingerprintSha256}`);
  console.log(`X.509 public key fingerprint SHA-256: ${generated.publicKeyFingerprintSha256}`);
  console.log('Certificate chain: OK (development self-signed)');
  console.log('PDF ByteRange: OK');
  console.log('CMS detached signature: OK');
  console.log('RSA 3072 / PKCS#1 v1.5 / SHA-256: OK');
  console.log('Internal verification: true');
  console.log('Independent OpenSSL verification: true');
  console.log('Post-signature byte mutation detected: true');
  console.log('RFC 3161 timestamp: not requested');
  console.log(`Certificate fingerprint SHA-256: ${generated.certificate.fingerprintSha256}`);
  console.log(`PDF SHA-256 after signature: ${signed.pdfHashAfterSignature}`);
  console.log(`Output: ${outputPdf}`);
  console.log('');
  console.log('PADES-B-B KMS E2E VERIFIED');
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(`PADES-B-B KMS E2E FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
