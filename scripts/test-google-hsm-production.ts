import { constants, createHash, verify } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const cacheDirectory = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'docubox-production-hsm-smoke'
);
const bundlePath = join(cacheDirectory, 'production-hsm-provider.cjs');

try {
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
  const { GoogleCloudKmsProvider } = createRequire(import.meta.url)(bundlePath);
  const provider = GoogleCloudKmsProvider.fromEnvironment('production');
  const keyId = process.env.GOOGLE_KMS_PRODUCTION_KEY_NAME;
  if (!keyId) throw new Error('GOOGLE_KMS_PRODUCTION_KEY_NAME_MISSING');
  const metadata = await provider.getKeyMetadata(keyId);
  const payload = Buffer.from('Prueba criptografica Docubox HSM production', 'utf8');
  const signed = await provider.signDigest({
    purpose: 'PDF_SIGNATURE',
    canonicalBytes: payload,
    digestSha256: createHash('sha256').update(payload).digest('hex'),
    idempotencyKey: 'docubox-production-hsm-e2e-v1',
  });
  const verified = verify(
    'sha256',
    payload,
    { key: signed.publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(signed.signatureBase64, 'base64')
  );
  if (
    metadata.protectionLevel !== 'hsm' ||
    metadata.keySizeBits !== 3072 ||
    metadata.algorithm !== 'RSA-PKCS1-SHA256' ||
    metadata.keyVersion !== process.env.GOOGLE_KMS_PRODUCTION_KEY_VERSION ||
    !verified
  ) {
    throw new Error('PRODUCTION_HSM_E2E_ASSERTION_FAILED');
  }
  console.info('Protection level: HSM');
  console.info(`Algorithm: ${metadata.algorithm}`);
  console.info(`Key version: ${metadata.keyVersion}`);
  console.info(`Public key fingerprint SHA-256: ${signed.publicKeyFingerprintSha256}`);
  console.info('asymmetricSign: OK');
  console.info('crypto.verify: true');
  console.info('');
  console.info('PRODUCTION HSM KMS E2E VERIFIED');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`PRODUCTION HSM KMS E2E FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}
