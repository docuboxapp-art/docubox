import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const providerModePath = join(root, 'src', 'lib', 'certification', 'provider-mode.ts');
const keyManagementPath = join(root, 'src', 'lib', 'certification', 'key-management.ts');
const providersPath = join(root, 'src', 'lib', 'certification', 'providers.ts');
const enginePath = join(root, 'src', 'lib', 'certification', 'engine.ts');
const timestampPath = join(root, 'src', 'lib', 'certification', 'timestamp.ts');

const bundleDir = await mkdtemp(join(tmpdir(), 'docubox-production-mode-'));
const bundlePath = join(bundleDir, 'provider-mode.cjs');
await build({
  entryPoints: [providerModePath],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});
const { getCryptoProviderMode, assertProductionCertificationEnabled } = createRequire(
  import.meta.url
)(bundlePath);

const keyManagementBundlePath = join(bundleDir, 'key-management.cjs');
await build({
  entryPoints: [keyManagementPath],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: keyManagementBundlePath,
  logLevel: 'silent',
});
const { ProductionKeyManagementProvider } = createRequire(import.meta.url)(keyManagementBundlePath);

test('production mode is opt-in and cannot be enabled by a browser flag', () => {
  const oldMode = process.env.CRYPTO_PROVIDER_MODE;
  const oldEnabled = process.env.PRODUCTION_CERTIFICATION_ENABLED;
  const oldNodeEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.CRYPTO_PROVIDER_MODE;
    delete process.env.PRODUCTION_CERTIFICATION_ENABLED;
    assert.equal(getCryptoProviderMode(), 'development');
    process.env.CRYPTO_PROVIDER_MODE = 'production';
    assert.throws(() => assertProductionCertificationEnabled(), {
      code: 'PRODUCTION_CERTIFICATION_DISABLED',
    });
    process.env.PRODUCTION_CERTIFICATION_ENABLED = 'true';
    assert.doesNotThrow(() => assertProductionCertificationEnabled());
  } finally {
    if (oldMode === undefined) delete process.env.CRYPTO_PROVIDER_MODE;
    else process.env.CRYPTO_PROVIDER_MODE = oldMode;
    if (oldEnabled === undefined) delete process.env.PRODUCTION_CERTIFICATION_ENABLED;
    else process.env.PRODUCTION_CERTIFICATION_ENABLED = oldEnabled;
    if (oldNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnvironment;
  }
});

test('NODE_ENV production cannot resolve the development Software provider mode', () => {
  const oldMode = process.env.CRYPTO_PROVIDER_MODE;
  const oldNodeEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.CRYPTO_PROVIDER_MODE = 'development';
    assert.throws(() => getCryptoProviderMode(), { code: 'PRODUCTION_HSM_REQUIRED' });
    process.env.CRYPTO_PROVIDER_MODE = 'production';
    assert.equal(getCryptoProviderMode(), 'production');
  } finally {
    if (oldMode === undefined) delete process.env.CRYPTO_PROVIDER_MODE;
    else process.env.CRYPTO_PROVIDER_MODE = oldMode;
    if (oldNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnvironment;
  }
});

test('production adapters are isolated from development and legacy providers', async () => {
  const [keyManagement, providers, timestamp, engine] = await Promise.all([
    readFile(keyManagementPath, 'utf8'),
    readFile(providersPath, 'utf8'),
    readFile(timestampPath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(keyManagement, /class ProductionKeyManagementProvider/);
  assert.match(keyManagement, /PRODUCTION_KMS_TLS_REQUIRED/);
  assert.match(providers, /ProductionCertificateProvider/);
  assert.match(providers, /ProductionTimestampAuthorityProvider/);
  assert.match(providers, /mode === 'production'/);
  assert.match(providers, /GoogleCloudKmsProvider\.fromEnvironment\('production'\)/);
  assert.match(timestamp, /class ProductionTimestampAuthorityProvider/);
  assert.match(engine, /assertProductionCertificationEnabled/);
  assert.match(engine, /independentVerification\.verifyPdf/);
  assert.match(engine, /INDEPENDENT_PADES_VERIFICATION_FAILED/);
  assert.doesNotMatch(keyManagement, /NEXT_PUBLIC_.*PRODUCTION_KMS/);
});

test('production KMS fails closed when missing or unavailable, so rollback only disables execution', async () => {
  const missing = new ProductionKeyManagementProvider({
    baseUrl: null,
    serviceToken: null,
    documentKeyId: null,
    evidenceKeyId: null,
    timeoutMs: 500,
  });
  const missingHealth = await missing.healthCheck();
  assert.equal(missingHealth.ready, false);
  assert.ok(missingHealth.missing.includes('DOCUBOX_PRODUCTION_KMS_URL'));

  const unavailable = new ProductionKeyManagementProvider(
    {
      baseUrl: 'https://kms.example.test',
      serviceToken: 'backend-only-token',
      documentKeyId: 'document-v2',
      evidenceKeyId: 'evidence-v2',
      timeoutMs: 500,
    },
    async () => new Response(null, { status: 503 })
  );
  const unavailableHealth = await unavailable.healthCheck();
  assert.equal(unavailableHealth.ready, false);
  assert.ok(unavailableHealth.missing.includes('PRODUCTION_KMS_UNAVAILABLE'));
});

test('production infrastructure documents an explicit rollout, rollback and key rotation', async () => {
  const [runbook, env, result] = await Promise.all([
    readFile(join(root, 'infra', 'production-crypto', 'README.md'), 'utf8'),
    readFile(join(root, '.env.example'), 'utf8'),
    readFile(join(root, 'docs', 'crypto', 'wp-crypto-10-result.md'), 'utf8'),
  ]);
  assert.match(runbook, /Controlled rollout/);
  assert.match(runbook, /Rotation, revocation and disaster recovery/);
  assert.match(env, /CRYPTO_PROVIDER_MODE=development/);
  assert.match(env, /PRODUCTION_CERTIFICATION_ENABLED=false/);
  assert.match(result, /fails closed/i);
});
