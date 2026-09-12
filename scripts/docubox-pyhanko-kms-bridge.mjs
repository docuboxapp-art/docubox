/**
 * Product bridge used by pyHanko to delegate raw PDF signatures to the
 * certification provider set. Private-key material never crosses this boundary.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

let cacheDirectory;

function json(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function errorCode(error) {
  if (error && typeof error === 'object' && 'code' in error) return String(error.code);
  return error instanceof Error ? error.message : 'PYHANKO_KMS_BRIDGE_FAILED';
}

async function runtime() {
  const cacheRoot = join(process.cwd(), 'node_modules', '.cache');
  await mkdir(cacheRoot, { recursive: true });
  cacheDirectory = await mkdtemp(join(cacheRoot, 'docubox-pyhanko-kms-'));
  const bundlePath = join(cacheDirectory, 'runtime.cjs');
  await build({
    stdin: {
      contents:
        "export { createCertificationProviderSet } from './src/lib/certification/providers';",
      resolveDir: process.cwd(),
      sourcefile: 'docubox-pyhanko-kms-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  return createRequire(import.meta.url)(bundlePath);
}

async function request() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const parsed = JSON.parse(raw || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PYHANKO_KMS_BRIDGE_REQUEST_INVALID');
  }
  return parsed;
}

async function signingIdentity(providers) {
  const [certificateResult, keyHealth] = await Promise.all([
    providers.certificate.verifyCertificateChain(),
    providers.keyManagement.healthCheck(),
  ]);
  if (
    !certificateResult.certificate ||
    !certificateResult.chainValid ||
    !certificateResult.keyMatches ||
    !['valid', 'expiring_soon'].includes(certificateResult.status)
  ) {
    throw new Error('PYHANKO_KMS_CERTIFICATE_INVALID');
  }
  const keyId = certificateResult.keyId || keyHealth.keyId;
  if (!keyId) throw new Error('PYHANKO_KMS_KEY_ID_MISSING');
  const [metadata, chain] = await Promise.all([
    providers.keyManagement.getKeyMetadata(keyId),
    providers.certificate.getCertificateChain(),
  ]);
  if (
    metadata.algorithm !== 'RSA-PKCS1-SHA256' ||
    metadata.keySizeBits !== 3072 ||
    !metadata.publicKeyPem
  ) {
    throw new Error('PYHANKO_KMS_KEY_POLICY_INVALID');
  }
  return { metadata, certificate: certificateResult.certificate, chain };
}

async function describe(providers) {
  const { metadata, certificate, chain } = await signingIdentity(providers);
  json({
    ok: true,
    algorithm: metadata.algorithm,
    key_size_bits: metadata.keySizeBits,
    key_id: metadata.keyId,
    key_version: metadata.keyVersion,
    signing_certificate_pem: certificate.pem,
    certificate_chain_pem: chain.map((entry) => entry.pem),
  });
}

async function sign(providers, input) {
  if (input.digest_algorithm !== 'sha256' || typeof input.data_base64 !== 'string') {
    throw new Error('PYHANKO_KMS_SIGN_REQUEST_INVALID');
  }
  const canonicalBytes = Buffer.from(input.data_base64, 'base64');
  if (!canonicalBytes.byteLength || canonicalBytes.toString('base64') !== input.data_base64) {
    throw new Error('PYHANKO_KMS_SIGN_DATA_INVALID');
  }
  const digestSha256 = createHash('sha256').update(canonicalBytes).digest('hex');
  const signature = await providers.keyManagement.signDigest({
    purpose: 'PDF_SIGNATURE',
    canonicalBytes,
    digestSha256,
    tenantId: typeof input.tenant_id === 'string' ? input.tenant_id : undefined,
    idempotencyKey:
      typeof input.idempotency_key === 'string' && input.idempotency_key
        ? `${input.idempotency_key}:${digestSha256}`
        : `pyhanko:${digestSha256}`,
  });
  json({
    ok: true,
    algorithm: signature.algorithm,
    key_size_bits: signature.keySizeBits,
    key_id: signature.keyId,
    key_version: signature.keyVersion,
    signature_base64: signature.signatureBase64,
  });
}

try {
  const input = await request();
  const operation = process.argv[2];
  if (operation !== 'describe' && operation !== 'sign') {
    throw new Error('PYHANKO_KMS_BRIDGE_OPERATION_INVALID');
  }
  const { createCertificationProviderSet } = await runtime();
  const providers = createCertificationProviderSet();
  if (operation === 'describe') await describe(providers);
  else await sign(providers, input);
} catch (error) {
  json({ ok: false, code: errorCode(error) });
  process.exitCode = 1;
} finally {
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
}
