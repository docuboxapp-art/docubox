import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const cacheDirectory = join(process.cwd(), 'node_modules', '.cache', 'docubox-document-kms-smoke');
const bundlePath = join(cacheDirectory, 'document-kms-provider.cjs');

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

async function loadProvider() {
  await mkdir(cacheDirectory, { recursive: true });
  await build({
    entryPoints: [
      join(process.cwd(), 'src', 'lib', 'crypto', 'document-encryption', 'kms', 'google-kms.ts'),
    ],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    external: ['@google-cloud/kms'],
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(bundlePath).GoogleCloudDocumentKeyProvider;
}

let dek: Buffer | null = null;
let unwrapped: Buffer | null = null;

try {
  required('DOCUMENT_ENCRYPTION_KMS_PROVIDER');
  required('DOCUMENT_ENCRYPTION_KMS_KEY_RESOURCE');
  required('GCP_PROJECT_ID');
  required('GCP_SERVICE_ACCOUNT_EMAIL');

  const GoogleCloudDocumentKeyProvider = await loadProvider();
  const provider = GoogleCloudDocumentKeyProvider.fromEnvironment();
  const metadata = await provider.getKeyMetadata();
  dek = randomBytes(32);
  const aad = Buffer.from('docubox-document-kek-e2e-v1', 'utf8');
  const wrapped = await provider.wrapKey({ plaintextKey: dek, aad });
  const decryptedDek = await provider.unwrapKey({
    wrappedKey: wrapped.wrappedKey,
    aad,
    keyId: wrapped.keyId,
    keyVersion: wrapped.keyVersion,
  });
  unwrapped = decryptedDek;

  const equal = dek.length === decryptedDek.length && timingSafeEqual(dek, decryptedDek);
  if (!equal) throw new Error('KMS_WRAP_UNWRAP_MISMATCH');

  let wrongAadDenied = false;
  try {
    await provider.unwrapKey({
      wrappedKey: wrapped.wrappedKey,
      aad: Buffer.from('docubox-document-kek-e2e-wrong-aad', 'utf8'),
      keyId: wrapped.keyId,
      keyVersion: wrapped.keyVersion,
    });
  } catch (error) {
    wrongAadDenied =
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'DOCUMENT_KEY_UNWRAP_FAILED';
  }
  if (!wrongAadDenied) throw new Error('KMS_WRONG_AAD_WAS_NOT_DENIED');

  console.info('Document KMS provider');
  console.info('------------------------------');
  console.info(`Provider: ${metadata.provider}`);
  console.info(`Algorithm: ${metadata.algorithm}`);
  console.info(`Protection level: ${metadata.protectionLevel}`);
  console.info(`Key version: ${metadata.keyVersion.split('/').at(-1)}`);
  console.info(`Key status: ${metadata.status}`);
  console.info('Wrap: OK');
  console.info('Unwrap: OK');
  console.info('Byte equality: true');
  console.info('Wrong AAD denied: true');
  console.info('');
  console.info('DOCUMENT KEK KMS E2E VERIFIED');
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'UNKNOWN_ERROR';
  console.error(`DOCUMENT KEK KMS E2E FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  dek?.fill(0);
  unwrapped?.fill(0);
  await rm(cacheDirectory, { recursive: true, force: true });
}
