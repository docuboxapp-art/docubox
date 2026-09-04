import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { build } from 'esbuild';
import nextEnv from '@next/env';
import { embedDocuboxPdfFonts } from '../src/lib/pdf/embedded-fonts';
import { assertPdfFontsEmbedded } from '../src/lib/pdf/font-audit';

nextEnv.loadEnvConfig(process.cwd());

const cacheDirectory = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'docubox-adobe-pades-interoperability'
);
const bundlePath = join(cacheDirectory, 'adobe-pades-interoperability.cjs');
const outputDirectory = join(process.cwd(), 'output', 'pdf');
const visualOutputPath = join(outputDirectory, 'acrobat-font-embedded-visual.pdf');
const bbOutputPath = join(outputDirectory, 'acrobat-font-embedded-pades-bb.pdf');
const outputPath = join(outputDirectory, 'acrobat-font-embedded-pades-bt.pdf');

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadRuntime() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents:
        "export { createCertificationProviderSet } from './src/lib/certification/providers';",
      resolveDir: process.cwd(),
      sourcefile: 'adobe-pades-interoperability-entry.ts',
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
  const { regular, bold } = await embedDocuboxPdfFonts(pdf);
  page.drawText('Docubox', {
    x: 54,
    y: 710,
    size: 24,
    font: bold,
    color: rgb(0.04, 0.1, 0.2),
  });
  page.drawText('Prueba de interoperabilidad PAdES-B-T', {
    x: 54,
    y: 665,
    size: 18,
    font: bold,
    color: rgb(0.04, 0.1, 0.2),
  });
  page.drawText('PDF visual firmado con Google Cloud HSM y sello RFC 3161.', {
    x: 54,
    y: 625,
    size: 11,
    font: regular,
    color: rgb(0.25, 0.31, 0.4),
  });
  page.drawText(`Generado: ${new Date().toISOString()}`, {
    x: 54,
    y: 603,
    size: 10,
    font: regular,
    color: rgb(0.25, 0.31, 0.4),
  });
  return new Uint8Array(
    await pdf.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false,
    })
  );
}

try {
  if (process.env.CRYPTO_PROVIDER_MODE !== 'production') {
    throw new Error('PRODUCTION_CRYPTO_PROVIDER_REQUIRED');
  }
  process.env.TSA_POLICY = 'external-free';
  process.env.PADES_REQUIRED_LEVEL = 'B-T';

  const runtime = await loadRuntime();
  const providers = runtime.createCertificationProviderSet();
  const health = await providers.healthCheck();
  if (!health.ready || !health.keyId) {
    throw new Error(`PRODUCTION_CRYPTO_HEALTH_FAILED:${health.missing.join(',')}`);
  }
  const key = await providers.keyManagement.getKeyMetadata(health.keyId);
  if (
    key.protectionLevel !== 'hsm' ||
    key.algorithm !== 'RSA-PKCS1-SHA256' ||
    key.keySizeBits !== 3072
  ) {
    throw new Error('PRODUCTION_HSM_KEY_PROFILE_INVALID');
  }
  const certificate = await providers.certificate.verifyCertificateChain();
  if (
    (certificate.status !== 'valid' && certificate.status !== 'expiring_soon') ||
    !certificate.certificate ||
    !certificate.chainValid ||
    !certificate.keyMatches
  ) {
    throw new Error('PRODUCTION_X509_BINDING_INVALID');
  }

  const visualPdf = await sourcePdf();
  await assertPdfFontsEmbedded(visualPdf);
  const prepared = await providers.pdfSignature.preparePdf({
    pdfBytes: visualPdf,
    signerName: 'Docubox',
    reason: 'Prueba de interoperabilidad PAdES-B-T',
    location: 'Mexico',
  });
  const bb = await providers.pdfSignature.embedSignature({
    prepared,
    profile: 'PAdES-B-B',
    idempotencyKey: `adobe-interoperability-bb-${sha256(visualPdf)}`,
  });
  const bbVerification = await providers.pdfSignature.verifyPdf({
    pdfBytes: bb.pdfBytes,
    expectedCertificateFingerprintSha256: certificate.certificate.fingerprintSha256,
  });
  if (!bbVerification.valid || bbVerification.profile !== 'PAdES-B-B') {
    throw new Error('PADES_BB_VERIFICATION_FAILED');
  }
  await assertPdfFontsEmbedded(bb.pdfBytes);

  const bt = await providers.pdfSignature.upgradeToPadesBt({
    pdfBytes: bb.pdfBytes,
    expectedCertificateFingerprintSha256: certificate.certificate.fingerprintSha256,
  });
  const [verification, independent] = await Promise.all([
    providers.pdfSignature.verifyPdf({
      pdfBytes: bt.pdfBytes,
      expectedCertificateFingerprintSha256: certificate.certificate.fingerprintSha256,
    }),
    providers.independentVerification.verifyPdf({
      pdfBytes: bt.pdfBytes,
      expectedCertificateFingerprintSha256: certificate.certificate.fingerprintSha256,
    }),
  ]);
  for (const result of [verification, independent]) {
    if (
      !result.valid ||
      result.profile !== 'PAdES-B-T' ||
      !result.byteRangeValid ||
      !result.cmsValid ||
      !result.certificateValid ||
      !result.certificateKeyMatches ||
      !result.timestamp?.valid ||
      !result.timestamp.messageImprintValid ||
      !result.timestamp.cmsValid ||
      !result.timestamp.certificateValid ||
      !result.timestamp.chainValid
    ) {
      throw new Error(`PADES_BT_VERIFICATION_FAILED:${result.detail || 'INVALID'}`);
    }
  }
  await assertPdfFontsEmbedded(bt.pdfBytes);

  const pdfText = Buffer.from(bt.pdfBytes).toString('latin1');
  const signatureDictionary = /\/Type\s*\/Sig[\s\S]*?\/Contents\s*</.exec(pdfText)?.[0];
  if (!signatureDictionary) throw new Error('PDF_SIGNATURE_DICTIONARY_MISSING');
  if (!/\/Filter\s*\/Adobe\.PPKLite/.test(signatureDictionary)) {
    throw new Error('PDF_SIGNATURE_FILTER_INVALID');
  }
  if (!/\/SubFilter\s*\/ETSI\.CAdES\.detached/.test(signatureDictionary)) {
    throw new Error('PDF_SIGNATURE_SUBFILTER_INVALID');
  }
  const byteRange = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    signatureDictionary
  );
  if (
    !byteRange ||
    byteRange
      .slice(1)
      .map(Number)
      .some((value) => !Number.isSafeInteger(value))
  ) {
    throw new Error('PDF_BYTERANGE_DIRECT_NUMBERS_REQUIRED');
  }

  const altered = new Uint8Array(bt.pdfBytes);
  altered[20] ^= 1;
  if ((await providers.pdfSignature.verifyPdf({ pdfBytes: altered })).valid) {
    throw new Error('PADES_TAMPER_NOT_DETECTED');
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(visualOutputPath, visualPdf);
  await writeFile(bbOutputPath, bb.pdfBytes);
  await writeFile(outputPath, bt.pdfBytes);
  const output = await readFile(outputPath);
  if (sha256(output) !== sha256(bt.pdfBytes)) throw new Error('OUTPUT_HASH_MISMATCH');

  console.info('Adobe Acrobat PAdES-B-T interoperability fixture');
  console.info('------------------------------------------------');
  console.info('Google Cloud HSM RSA 3072 / SHA-256: PASS');
  console.info('X.509 public-key binding: PASS');
  console.info('PAdES-B-B: PASS');
  console.info(`RFC3161 provider: ${bt.timestamp.provider}`);
  console.info('PAdES-B-T: PASS');
  console.info('Embedded subset fonts with Unicode maps: PASS');
  console.info('ByteRange direct number objects: PASS');
  console.info('Internal verification: PASS');
  console.info('Independent verification: PASS');
  console.info('One-byte mutation: FAIL as expected');
  console.info(`SHA-256: ${sha256(output)}`);
  console.info(`Output: ${outputPath}`);
} catch (error) {
  const detail = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  console.error(`ADOBE_ACROBAT_PADES_INTEROPERABILITY_FAILED:${detail}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
