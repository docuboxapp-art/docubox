import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

mkdirSync('.tmp/blockchain-tests', { recursive: true });
execSync(
  'npx esbuild src/lib/blockchain-evidence/manifest.ts src/lib/blockchain-evidence/state-machine.ts --bundle --platform=node --format=esm --outdir=.tmp/blockchain-tests',
  { stdio: 'pipe' }
);

const manifestModule = await import('../.tmp/blockchain-tests/manifest.js');
const stateModule = await import('../.tmp/blockchain-tests/state-machine.js');

test('manifest v1 is deterministic and privacy-safe', () => {
  const input = { documentHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64) };
  const first = manifestModule.createBlockchainEvidenceManifest(input);
  const second = manifestModule.createBlockchainEvidenceManifest(input);
  assert.deepEqual(first, second);
  assert.equal(first.manifestHash.length, 64);
  assert.equal(
    first.canonical,
    '{"document_hash":"' +
      'a'.repeat(64) +
      '","document_hash_algorithm":"SHA-256","document_state":"FINAL","evidence_hash":"' +
      'b'.repeat(64) +
      '","evidence_hash_algorithm":"SHA-256","evidence_version":1,"schema":"docubox.blockchain-evidence","version":"1.0"}'
  );
  for (const forbidden of ['email', 'tenant_id', 'document_id', 'rfc', 'curp', 'nombre'])
    assert.equal(first.canonical.includes(forbidden), false);
});

test('manifest rejects malformed digests', () => {
  assert.throws(() =>
    manifestModule.createBlockchainEvidenceManifest({
      documentHash: 'bad',
      evidenceHash: 'b'.repeat(64),
    })
  );
});

test('same PDF bytes keep their digest and modified bytes change it', () => {
  const original = new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF');
  const copy = new Uint8Array(original);
  const modified = new TextEncoder().encode('%PDF-1.7\nfixture!\n%%EOF');
  assert.equal(manifestModule.hashBytes(original), manifestModule.hashBytes(copy));
  assert.notEqual(manifestModule.hashBytes(original), manifestModule.hashBytes(modified));
});

test('changing the evidence hash changes the canonical manifest hash', () => {
  const first = manifestModule.createBlockchainEvidenceManifest({
    documentHash: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
  });
  const second = manifestModule.createBlockchainEvidenceManifest({
    documentHash: 'a'.repeat(64),
    evidenceHash: 'c'.repeat(64),
  });
  assert.notEqual(first.manifestHash, second.manifestHash);
});

test('state machine rejects false VERIFIED transitions and caps backoff', () => {
  assert.throws(() =>
    stateModule.assertBlockchainEvidenceTransition('PENDING_BITCOIN', 'VERIFIED')
  );
  assert.doesNotThrow(() => stateModule.assertBlockchainEvidenceTransition('ANCHORED', 'VERIFIED'));
  assert.doesNotThrow(() => stateModule.assertBlockchainEvidenceTransition('GENERATED', 'SUBMITTED'));
  assert.doesNotThrow(() =>
    stateModule.assertBlockchainEvidenceTransition('SUBMITTED', 'PENDING_BITCOIN')
  );
  assert.equal(stateModule.retryDelayMs(99), 86_400_000);
});

test('migration enforces RLS, immutability, idempotency and private storage', () => {
  const sql = readFileSync(
    'supabase/migrations/20260908094601_document_blockchain_evidence.sql',
    'utf8'
  );
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql, /UNIQUE \(document_id, document_hash, schema_version\)/);
  assert.match(sql, /BLOCKCHAIN_EVIDENCE_IMMUTABLE/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /'blockchain-evidence', 'blockchain-evidence', false/);
  assert.match(sql, /legal_hold_status, 'NONE'\) = 'ACTIVE'/);
  assert.match(sql, /docubox\.document_purge_context/);
  assert.match(sql, /REVOKE ALL ON .* FROM PUBLIC, anon, authenticated/s);
});

test('document retention purge includes every blockchain artifact', () => {
  const source = readFileSync('src/lib/documents/purge-document.ts', 'utf8');
  assert.match(source, /document_blockchain_evidence/);
  assert.match(source, /document_blockchain_proof_versions/);
  assert.match(source, /manifest_storage_path/);
  assert.match(source, /certificate_storage_path/);
  assert.match(source, /BLOCKCHAIN_EVIDENCE_BUCKET/);
});

test('public verifier DTO contains no tenant or identity fields', () => {
  const source = readFileSync('src/app/api/verify/blockchain/[publicToken]/route.ts', 'utf8');
  const dto = source.slice(
    source.indexOf('function publicDto'),
    source.indexOf('async function findEvidence')
  );
  for (const forbidden of [
    'tenant_id',
    'workspace_id',
    'document_id',
    'actor_id',
    'email',
    'participante',
  ])
    assert.equal(dto.includes(forbidden), false);
});

test('provider pins allowlisted calendars and never sends a PDF', () => {
  const source = readFileSync('src/lib/blockchain-evidence/opentimestamps-cli-provider.ts', 'utf8');
  assert.match(source, /--no-default-whitelist/);
  assert.match(source, /canonicalManifest/);
  assert.doesNotMatch(source, /pdfBytes|documentBytes/);
});

test('real anchoring requires its dedicated feature flag', () => {
  const source = readFileSync('src/lib/blockchain-evidence/config.ts', 'utf8');
  assert.match(source, /OPENTIMESTAMPS_REAL_ANCHORING_ENABLED/);
  assert.match(source, /DOCUBOX_BLOCKCHAIN_EVIDENCE_ENABLED/);
  assert.match(source, /OPENTIMESTAMPS_ENABLED/);
});

test('document viewer keeps blockchain evidence visible before a proof exists', () => {
  const source = readFileSync('src/app/visor-documento/[id]/page.tsx', 'utf8');
  assert.match(source, /Evidencia Blockchain/);
  assert.match(source, /Evidencia no solicitada para este documento/);
  assert.doesNotMatch(source, /\{blockchainEvidence && \(\s*<div[^>]+>/);
});

test('Vercel runtime uses the official Python client behind internal authentication', () => {
  const runtime = readFileSync('api/opentimestamps_runtime.py', 'utf8');
  const requirements = readFileSync('requirements.txt', 'utf8');
  const provider = readFileSync(
    'src/lib/blockchain-evidence/opentimestamps-http-provider.ts',
    'utf8'
  );
  assert.match(requirements, /^opentimestamps-client==0\.7\.2/m);
  assert.match(runtime, /OTS_WORKER_SECRET/);
  assert.match(runtime, /Authorization/);
  assert.match(provider, /manifestBase64/);
  assert.doesNotMatch(provider, /documentBytes|pdfBytes|tenantId|participant|email/);
});

test('stamp and upgrade workers are independently protected and claim separate queues', () => {
  const stamp = readFileSync(
    'src/app/api/internal/jobs/opentimestamps/stamp/route.ts',
    'utf8'
  );
  const upgrade = readFileSync(
    'src/app/api/internal/jobs/opentimestamps/upgrade/route.ts',
    'utf8'
  );
  const claims = readFileSync(
    'supabase/migrations/20260908133000_opentimestamps_worker_claims.sql',
    'utf8'
  );
  assert.match(stamp, /isAuthorizedOpenTimestampsWorker/);
  assert.match(upgrade, /isAuthorizedOpenTimestampsWorker/);
  assert.match(claims, /FOR UPDATE SKIP LOCKED/);
  assert.match(claims, /p_operation = 'STAMP'/);
  assert.match(claims, /p_operation = 'UPGRADE'/);
});
