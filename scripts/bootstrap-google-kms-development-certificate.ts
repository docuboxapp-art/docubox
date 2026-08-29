import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const defaults = {
  DOCUBOX_KMS_PROVIDER: 'gcp',
  GOOGLE_CLOUD_PROJECT_ID: 'project-702d9de4-d29c-49f2-82c',
  GOOGLE_KMS_LOCATION: 'us-east1',
  GOOGLE_KMS_KEY_RING: 'docubox-pades',
  GOOGLE_KMS_KEY_NAME: 'docubox-pades-signing',
  GOOGLE_KMS_KEY_VERSION: '1',
  GOOGLE_KMS_ALGORITHM: 'RSA_SIGN_PKCS1_3072_SHA256',
  GOOGLE_KMS_SERVICE_ACCOUNT:
    'docubox-pades-signer@project-702d9de4-d29c-49f2-82c.iam.gserviceaccount.com',
};
for (const [name, value] of Object.entries(defaults)) process.env[name] ||= value;

const cacheDirectory = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'docubox-certificate-bootstrap'
);
const bundlePath = join(cacheDirectory, 'certificate-bootstrap.cjs');
const outputDirectory = join(process.cwd(), '.docubox', 'crypto');
const certificatePath = join(outputDirectory, 'google-kms-development-signing.crt.pem');

try {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export { GoogleCloudKmsProvider } from './src/lib/certification/key-management';",
        "export { createKmsSelfSignedDevelopmentCertificate } from './src/lib/certification/certificates';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'certificate-bootstrap-entry.ts',
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
  const keyProvider = runtime.GoogleCloudKmsProvider.fromEnvironment();
  const keyId = process.env.GOOGLE_KMS_KEY_NAME;
  if (!keyId) throw new Error('GOOGLE_KMS_KEY_NAME_MISSING');
  const generated = await runtime.createKmsSelfSignedDevelopmentCertificate({
    keyProvider,
    keyId,
    subject: {
      commonName: 'DOCUBOX PAdES Development',
      organization: 'DOCUBOX',
      organizationalUnit: 'Development Cryptographic Services',
      country: 'MX',
    },
    validityDays: 365,
  });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(certificatePath, generated.certificatePem, { encoding: 'utf8', mode: 0o644 });
  console.log('Development certificate: OK');
  console.log('Certificate/KMS binding: OK');
  console.log(`Key version: ${generated.keyVersion}`);
  console.log(`Public certificate path: ${certificatePath}`);
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`DEVELOPMENT_CERTIFICATE_BOOTSTRAP_FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
