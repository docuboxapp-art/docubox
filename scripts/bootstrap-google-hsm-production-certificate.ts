import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

const cacheDirectory = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'docubox-production-hsm-certificate'
);
const bundlePath = join(cacheDirectory, 'production-hsm-certificate.cjs');
const outputDirectory = join(process.cwd(), '.docubox', 'crypto', 'production');
const certificatePath = join(outputDirectory, 'google-cloud-hsm-production-signing.crt.pem');

try {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { GoogleCloudKmsProvider } from './src/lib/certification/key-management';",
        "export { createKmsSelfSignedProductionCertificate } from './src/lib/certification/certificates';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'production-hsm-certificate-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@google-cloud/kms'],
    logLevel: 'silent',
  });
  const runtime = createRequire(import.meta.url)(bundlePath);
  const keyProvider = runtime.GoogleCloudKmsProvider.fromEnvironment('production');
  const keyId = required('GOOGLE_KMS_PRODUCTION_KEY_NAME');
  const generated = await runtime.createKmsSelfSignedProductionCertificate({
    keyProvider,
    keyId,
    subject: {
      commonName: required('DOCUBOX_PRODUCTION_CERTIFICATE_COMMON_NAME'),
      organization: required('DOCUBOX_PRODUCTION_CERTIFICATE_ORGANIZATION'),
      organizationalUnit: required('DOCUBOX_PRODUCTION_CERTIFICATE_ORGANIZATIONAL_UNIT'),
      country: required('DOCUBOX_PRODUCTION_CERTIFICATE_COUNTRY'),
    },
    validityDays: 365,
  });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(certificatePath, generated.certificatePem, { encoding: 'utf8', mode: 0o644 });
  console.info('Production HSM X.509 self-signature: OK');
  console.info('Certificate/HSM SPKI binding: OK');
  console.info(`Key version: ${generated.keyVersion}`);
  console.info(`Public key fingerprint SHA-256: ${generated.publicKeyFingerprintSha256}`);
  console.info(`Certificate fingerprint SHA-256: ${generated.certificate.fingerprintSha256}`);
  console.info(`Public certificate path: ${certificatePath}`);
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`PRODUCTION_HSM_CERTIFICATE_BOOTSTRAP_FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
