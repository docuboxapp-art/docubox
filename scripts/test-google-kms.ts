import { constants, createHash, verify } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

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

const PAYLOAD = 'Prueba criptografica Docubox KMS';
const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-kms-smoke');
const bundlePath = join(cacheDirectory, 'google-cloud-kms-provider.cjs');

async function loadProvider() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'key-management.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@google-cloud/kms'],
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(bundlePath).GoogleCloudKmsProvider;
}

try {
  const GoogleCloudKmsProvider = await loadProvider();
  // No credential options are passed: the official client must discover ADC.
  const provider = GoogleCloudKmsProvider.fromEnvironment();
  const metadata = await provider.getKeyMetadata(process.env.GOOGLE_KMS_KEY_NAME);
  const payloadBytes = Buffer.from(PAYLOAD, 'utf8');
  const digestSha256 = createHash('sha256').update(payloadBytes).digest('hex');
  const signature = await provider.signDigest({
    purpose: 'DOCUMENT_SEAL',
    canonicalBytes: payloadBytes,
    digestSha256,
    idempotencyKey: 'docubox-google-kms-e2e-v1',
  });
  const verified = verify(
    'sha256',
    payloadBytes,
    {
      key: signature.publicKeyPem,
      padding: constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(signature.signatureBase64, 'base64')
  );

  if (
    metadata.provider !== 'google-cloud-kms' ||
    metadata.keyVersion !== '1' ||
    metadata.keySizeBits !== 3072 ||
    metadata.algorithm !== 'RSA-PKCS1-SHA256' ||
    !verified
  ) {
    throw new Error('GOOGLE_KMS_E2E_ASSERTION_FAILED');
  }

  console.log('Google Cloud KMS');
  console.log('------------------------------');
  console.log('Authentication: OK');
  console.log('ADC: OK');
  console.log('CryptoKey: OK');
  console.log(`Key version ${metadata.keyVersion}: OK`);
  console.log('GetPublicKey: OK');
  console.log('AsymmetricSign: OK');
  console.log('RSA 3072 / PKCS#1 v1.5 / SHA-256: OK');
  console.log(`crypto.verify: ${verified}`);
  console.log('');
  console.log('KMS E2E VERIFIED');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`KMS E2E FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
