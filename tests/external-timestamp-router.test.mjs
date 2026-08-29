import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const bundleDirectory = await mkdtemp(join(tmpdir(), 'docubox-external-tsa-router-'));
const bundlePath = join(bundleDirectory, 'external-tsa.cjs');
await build({
  stdin: {
    contents: [
      "export { TimeStampProviderRouter, loadExternalTsaTrustBundle } from './src/lib/certification/external-timestamp';",
      "export { CertificationError } from './src/lib/certification/types';",
    ].join('\n'),
    resolveDir: process.cwd(),
    sourcefile: 'external-tsa-router-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  logLevel: 'silent',
});
const { CertificationError, TimeStampProviderRouter, loadExternalTsaTrustBundle } = createRequire(
  import.meta.url
)(bundlePath);

const validVerification = {
  valid: true,
  status: 'valid',
  messageImprintValid: true,
  nonceValid: true,
  policyValid: true,
  cmsValid: true,
  certificateValid: true,
  chainValid: true,
  tsaEkuValid: true,
  policyOid: '1.3.6.1.4.1.59085.1.1',
  serialNumber: '01',
  genTime: '2026-08-29T00:00:00.000Z',
  nonce: '1',
  messageImprintSha256: 'a'.repeat(64),
  tsaCertificateFingerprintSha256: 'b'.repeat(64),
  tsaCertificateSerialNumber: '01',
  tsaCertificateSubject: 'CN=Test TSA',
  tsaIssuer: 'CN=Test Root',
  detail: null,
};

function result(provider, role) {
  return {
    provider,
    request: new Uint8Array([1]),
    response: new Uint8Array([2]),
    token: new Uint8Array([3]),
    requestSha256: '1'.repeat(64),
    responseSha256: '2'.repeat(64),
    tokenSha256: '3'.repeat(64),
    messageImprintSha256: 'a'.repeat(64),
    messageImprintAlgorithm: 'SHA-256',
    nonce: '1',
    policyOid: validVerification.policyOid,
    serialNumber: '01',
    genTime: validVerification.genTime,
    tsaCertificateFingerprintSha256: 'b'.repeat(64),
    tsaCertificateSerialNumber: '01',
    tsaCertificateSubject: 'CN=Test TSA',
    tsaIssuer: 'CN=Test Root',
    providerRole: role,
    endpointId: `${provider}-test`,
    trustBundleId: `${provider}-v1`,
    trustRootFingerprintSha256: 'c'.repeat(64),
    trustChainFingerprintsSha256: ['d'.repeat(64)],
    fallbackUsed: role === 'FALLBACK',
    fallbackReason: null,
    primaryFailureCode: null,
    primaryFailureClass: null,
    verification: validVerification,
  };
}

class FakeProvider {
  constructor(providerId, outcomes, verification = validVerification) {
    this.providerId = providerId;
    this.outcomes = [...outcomes];
    this.verification = verification;
    this.calls = 0;
    this.verifyCalls = 0;
  }

  async timestampDigest() {
    this.calls += 1;
    const outcome = this.outcomes.shift();
    if (outcome instanceof Error) throw outcome;
    if (typeof outcome === 'function') return outcome();
    return (
      outcome || result(this.providerId, this.providerId === 'freetsa' ? 'PRIMARY' : 'FALLBACK')
    );
  }

  async verifyTimestamp() {
    this.verifyCalls += 1;
    return this.verification;
  }

  async healthCheck() {
    return { ready: true, missing: [], provider: this.providerId, detail: 'HEALTHY' };
  }
}

function router(primary, fallback, overrides = {}) {
  return new TimeStampProviderRouter({
    primary,
    fallback,
    retryDelayMs: 1,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 50,
    sleep: async () => undefined,
    random: () => 0,
    ...overrides,
  });
}

const input = { digest: new Uint8Array(32), messageImprintData: new Uint8Array([1]) };

test('external TSA router uses FreeTSA primary without duplicate calls', async () => {
  const primary = new FakeProvider('freetsa', [result('freetsa', 'PRIMARY')]);
  const fallback = new FakeProvider('open-tsa', []);
  const selected = await router(primary, fallback).timestampDigest(input);
  assert.equal(selected.provider, 'freetsa');
  assert.equal(selected.fallbackUsed, false);
  assert.equal(primary.calls, 1);
  assert.equal(fallback.calls, 0);
});

test('external TSA router honors Retry-After before retrying the primary', async () => {
  const rateLimit = new CertificationError('TSA_RATE_LIMITED', 'rate limited', 503);
  Object.defineProperty(rateLimit, 'retryAfterMs', { value: 4_250 });
  const waits = [];
  const primary = new FakeProvider('freetsa', [rateLimit, result('freetsa', 'PRIMARY')]);
  const fallback = new FakeProvider('open-tsa', []);
  const selected = await router(primary, fallback, {
    sleep: async (milliseconds) => waits.push(milliseconds),
  }).timestampDigest(input);
  assert.equal(selected.provider, 'freetsa');
  assert.deepEqual(waits, [4_250]);
  assert.equal(fallback.calls, 0);
});

for (const [label, errorCode] of [
  ['timeout/network', 'TSA_HTTP_ERROR'],
  ['HTTP 429', 'TSA_RATE_LIMITED'],
  ['HTTP 500', 'TSA_TEMPORARY_UNAVAILABLE'],
  ['RFC 3161 temporary rejection', 'RFC3161_TSA_REJECTED'],
]) {
  test(`external TSA router retries and falls back on ${label}`, async () => {
    const primary = new FakeProvider('freetsa', [
      new CertificationError(errorCode, label, 503),
      new CertificationError(errorCode, label, 503),
    ]);
    const fallback = new FakeProvider('open-tsa', [result('open-tsa', 'FALLBACK')]);
    const selected = await router(primary, fallback).timestampDigest(input);
    assert.equal(primary.calls, 2);
    assert.equal(fallback.calls, 1);
    assert.equal(selected.provider, 'open-tsa');
    assert.equal(selected.fallbackUsed, true);
    assert.equal(selected.primaryFailureCode, errorCode);
    assert.equal(selected.primaryFailureClass, 'TEMPORARY_FAILURE');
  });
}

for (const errorCode of [
  'TSA_IMPRINT_MISMATCH',
  'TSA_NONCE_MISMATCH',
  'TSA_SIGNATURE_INVALID',
  'TSA_CERTIFICATE_INVALID',
  'TSA_CHAIN_INVALID',
  'TSA_POLICY_MISMATCH',
  'TSA_TOKEN_CORRUPTED',
]) {
  test(`external TSA router fails closed and records ${errorCode}`, async () => {
    const primary = new FakeProvider('freetsa', [
      new CertificationError(errorCode, errorCode, 502),
    ]);
    const fallback = new FakeProvider('open-tsa', [result('open-tsa', 'FALLBACK')]);
    const selected = await router(primary, fallback).timestampDigest(input);
    assert.equal(primary.calls, 1, 'cryptographic failures must not be retried');
    assert.equal(fallback.calls, 1);
    assert.equal(selected.provider, 'open-tsa');
    assert.equal(selected.primaryFailureCode, errorCode);
    assert.equal(selected.primaryFailureClass, 'SECURITY_VALIDATION_FAILURE');
  });
}

test('external TSA router opens the primary circuit and keeps continuity through fallback', async () => {
  const primary = new FakeProvider('freetsa', [
    new CertificationError('TSA_HTTP_ERROR', 'offline', 503),
    new CertificationError('TSA_HTTP_ERROR', 'offline', 503),
  ]);
  const fallback = new FakeProvider('open-tsa', [
    result('open-tsa', 'FALLBACK'),
    result('open-tsa', 'FALLBACK'),
  ]);
  const routed = router(primary, fallback, {
    circuitFailureThreshold: 2,
    circuitCooldownMs: 60_000,
  });
  await routed.timestampDigest(input);
  const second = await routed.timestampDigest(input);
  assert.equal(primary.calls, 2, 'open circuit must skip new primary network calls');
  assert.equal(fallback.calls, 2);
  assert.equal(second.primaryFailureCode, 'TSA_CIRCUIT_OPEN');
});

test('external TSA router rejects the operation when primary and fallback both fail', async () => {
  const primary = new FakeProvider('freetsa', [
    new CertificationError('TSA_HTTP_ERROR', 'offline', 503),
    new CertificationError('TSA_HTTP_ERROR', 'offline', 503),
  ]);
  const fallback = new FakeProvider('open-tsa', [
    new CertificationError('TSA_RESPONSE_EMPTY', 'empty', 502),
  ]);
  await assert.rejects(
    () => router(primary, fallback).timestampDigest(input),
    (error) => error?.code === 'EXTERNAL_TSA_UNAVAILABLE'
  );
});

test('external TSA verification uses the independent provider trust bundles', async () => {
  const invalid = { ...validVerification, valid: false, status: 'invalid' };
  const primary = new FakeProvider('freetsa', [], invalid);
  const fallback = new FakeProvider('open-tsa', [], validVerification);
  const verification = await router(primary, fallback).verifyTimestamp(new Uint8Array([1]), {});
  assert.equal(verification.valid, true);
  assert.equal(primary.verifyCalls, 1);
  assert.equal(fallback.verifyCalls, 1);
});

test('versioned external TSA trust bundles load only when artifact and certificate fingerprints match', async () => {
  const [freeTsa, openTsa] = await Promise.all([
    loadExternalTsaTrustBundle(
      join(process.cwd(), 'infra', 'tsa', 'trust-bundles', 'freetsa', 'v1')
    ),
    loadExternalTsaTrustBundle(
      join(process.cwd(), 'infra', 'tsa', 'trust-bundles', 'open-tsa', 'v1')
    ),
  ]);
  assert.equal(freeTsa.manifest.id, 'freetsa-v1');
  assert.equal(openTsa.manifest.id, 'open-tsa-v1');
  assert.equal(freeTsa.manifest.role, 'PRIMARY');
  assert.equal(openTsa.manifest.role, 'FALLBACK');
  assert.equal(freeTsa.manifest.priority, 1);
  assert.equal(openTsa.manifest.priority, 2);
  assert.ok(Date.parse(freeTsa.manifest.tsaCertificateValidTo) > Date.now());
  assert.ok(Date.parse(openTsa.manifest.tsaCertificateValidTo) > Date.now());
  assert.match(freeTsa.manifest.trustRootFingerprintSha256, /^[0-9a-f]{64}$/);
  assert.match(openTsa.manifest.trustRootFingerprintSha256, /^[0-9a-f]{64}$/);
  assert.ok(freeTsa.chainFingerprintsSha256.length > 0);
  assert.ok(openTsa.chainFingerprintsSha256.length > 0);
});

test.after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});
