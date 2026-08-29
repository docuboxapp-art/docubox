import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/20260821120000_wp_crypto_03_key_management_provider.sql', import.meta.url);
const providerPath = new URL('../src/lib/certification/providers.ts', import.meta.url);
const keyManagementPath = new URL('../src/lib/certification/key-management.ts', import.meta.url);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const bundleDir = await mkdtemp(join(tmpdir(), 'docubox-key-management-'));
const bundlePath = join(bundleDir, 'key-management.cjs');
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'certification', 'key-management.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});
const { OpenBaoTransitProvider, LegacyLocalPemSigningProvider } = createRequire(import.meta.url)(bundlePath);

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fakeOpenBao() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let token = 'test-token';
  return async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith('/auth/approle/login')) {
      assert.equal(body.role_id, 'role-id');
      assert.equal(body.secret_id, 'secret-id');
      return Response.json({ auth: { client_token: token, lease_duration: 300 } });
    }
    assert.equal(init.headers['X-Vault-Token'], token);
    if (url.includes('/keys/')) {
      return Response.json({ data: { type: 'rsa-2048', latest_version: 1, keys: { 1: { public_key: publicKeyPem, creation_time: '2026-08-21T00:00:00Z' } } } });
    }
    if (url.includes('/sign/')) {
      const bytes = Buffer.from(body.input, 'base64');
      const signature = sign('sha256', bytes, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
      return Response.json({ data: { signature: `vault:v1:${signature.toString('base64')}` } });
    }
    if (url.includes('/verify/')) return Response.json({ data: { valid: true } });
    return new Response(null, { status: 404 });
  };
}

function provider(fetchImplementation = fakeOpenBao()) {
  return new OpenBaoTransitProvider({
    address: 'http://127.0.0.1:8200', transitMount: 'transit',
    documentKeyId: 'docubox-development-document', evidenceKeyId: 'docubox-development-evidence',
    roleId: 'role-id', secretId: 'secret-id',
  }, fetchImplementation);
}

test('OpenBao Transit signs and verifies a known canonical digest without exporting a private key', async () => {
  const instance = provider();
  const canonicalBytes = Buffer.from('known-document-digest-input');
  const result = await instance.signDigest({
    purpose: 'DOCUMENT_SEAL', canonicalBytes, digestSha256: sha256Hex(canonicalBytes), tenantId: 'tenant-a',
  });
  assert.equal(result.status, 'VALID');
  assert.equal(result.algorithm, 'RSA-PSS-SHA256');
  assert.equal(result.keyId, 'docubox-development-document');
  assert.equal(result.keyVersion, '1');
  assert.equal(result.keySizeBits, 2048);
  assert.match(result.publicKeyPem, /BEGIN PUBLIC KEY/);
});

test('OpenBao Transit rejects a digest that does not match canonical bytes', async () => {
  const instance = provider();
  await assert.rejects(
    instance.signDigest({ purpose: 'EVIDENCE_SEAL', canonicalBytes: Buffer.from('content'), digestSha256: '0'.repeat(64) }),
    { code: 'DIGEST_MISMATCH' },
  );
});

test('OpenBao health check performs an isolated non-document sign and verify probe', async () => {
  const health = await provider().healthCheck();
  assert.equal(health.ready, true);
  assert.equal(health.provider, 'openbao');
  assert.equal(health.keyVersion, '1');
});

test('legacy PEM provider is explicit and fails closed for new certification seals', async () => {
  const legacy = new LegacyLocalPemSigningProvider('https://legacy.example.test');
  const health = await legacy.healthCheck();
  assert.equal(health.ready, false);
  await assert.rejects(legacy.signDigest(), { code: 'LEGACY_PEM_DIGEST_SIGNING_UNSUPPORTED' });
});

test('provider selection isolates engine and migration records only non-secret metadata', async () => {
  const [providers, keyManagement, engine, migration] = await Promise.all([
    readFile(providerPath, 'utf8'),
    readFile(keyManagementPath, 'utf8'),
    readFile(enginePath, 'utf8'),
    readFile(migrationPath, 'utf8'),
  ]);
  assert.match(keyManagement, /class OpenBaoTransitProvider/);
  assert.match(keyManagement, /class LegacyLocalPemSigningProvider/);
  assert.match(providers, /createCertificationProviderSet/);
  assert.doesNotMatch(engine, /signDigestWithKms|OPENBAO_|VPS_SIGNING_URL/);
  assert.match(migration, /crypto_provider_configurations/);
  assert.match(migration, /crypto_provider_health_checks/);
  assert.match(migration, /REVOKE ALL ON public\.crypto_provider_configurations FROM anon, authenticated/);
  assert.doesNotMatch(migration, /private_key|secret_id|client_token/i);
});
