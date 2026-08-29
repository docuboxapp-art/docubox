import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const orchestratorPath = new URL('../src/lib/certification/orchestrator.ts', import.meta.url);
const executionPath = new URL('../src/lib/certification/execution.ts', import.meta.url);
const providersPath = new URL('../src/lib/certification/providers.ts', import.meta.url);
const timestampPath = new URL('../src/lib/certification/timestamp.ts', import.meta.url);
const keyManagementPath = new URL('../src/lib/certification/key-management.ts', import.meta.url);
const enginePath = new URL('../src/lib/certification/engine.ts', import.meta.url);
const internalRoutePath = new URL('../src/app/api/internal/certifications/route.ts', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20260821113000_wp_crypto_02_certification_orchestrator.sql', import.meta.url);

test('CertificationOrchestrator exposes execute, retry and getStatus', async () => {
  const source = await readFile(orchestratorPath, 'utf8');
  assert.match(source, /class CertificationOrchestrator/);
  assert.match(source, /async execute\(/);
  assert.match(source, /async retry\(/);
  assert.match(source, /async getStatus\(/);
  assert.match(source, /leaseOwner:/);
});

test('engine uses provider interfaces rather than direct KMS, TSA and PAdES calls', async () => {
  const [engine, providers, keyManagement, timestamp] = await Promise.all([
    readFile(enginePath, 'utf8'),
    readFile(providersPath, 'utf8'),
    readFile(keyManagementPath, 'utf8'),
    readFile(timestampPath, 'utf8'),
  ]);
  assert.match(keyManagement, /interface KeyManagementProvider/);
  assert.match(timestamp, /interface TimestampAuthorityProvider/);
  assert.match(providers, /timestampAuthority: TimestampAuthorityProvider/);
  assert.match(providers, /PdfSignatureProvider/);
  assert.match(engine, /providers\.keyManagement\.signDigest/);
  assert.match(engine, /providers\.pdfSignature\.preparePdf/);
  assert.match(engine, /providers\.pdfSignature\.embedSignature/);
  assert.match(engine, /providers\.pdfSignature\.verifyPdf/);
  assert.doesNotMatch(engine, /providers\.timestampAuthority\.timestampDigest/);
  assert.doesNotMatch(engine, /providers\.pdfSignature\.signPdf/);
  assert.doesNotMatch(engine, /await signDigestWithKms\(/);
  assert.doesNotMatch(engine, /await requestVerifiedTimestamp\(/);
  assert.doesNotMatch(engine, /await signPdfWithPades\(/);
});

test('execution uses compare-and-swap leases and durable checkpoints', async () => {
  const [execution, migration] = await Promise.all([readFile(executionPath, 'utf8'), readFile(migrationPath, 'utf8')]);
  assert.match(execution, /claimCertificationLease/);
  assert.match(execution, /\.eq\('execution_attempt'/);
  assert.match(execution, /lease_expires_at\.lt/);
  assert.match(execution, /recordCertificationCheckpoint/);
  assert.match(execution, /duration_ms/);
  assert.match(migration, /execution_attempt/);
  assert.match(migration, /execution_trace_id/);
  assert.match(migration, /lease_owner/);
  assert.match(migration, /certification_execution_checkpoints/);
  assert.match(migration, /'queued', 'processing', 'retrying', 'manual_review', 'completed', 'failed'/);
});

test('a competing execution cannot take an active lease for the same frozen version', async () => {
  const execution = await readFile(executionPath, 'utf8');
  assert.match(execution, /\.eq\('execution_attempt', Number\(certification\.execution_attempt \|\| 0\)\)/);
  assert.match(execution, /lease_owner\.is\.null,lease_expires_at\.lt/);
  assert.match(execution, /\.eq\('lease_owner', context\.leaseOwner\)/);
  assert.match(execution, /\.gt\('lease_expires_at', now\)/);
});

test('retries retain durable recovery context and checkpoints record failures', async () => {
  const [orchestrator, execution, engine] = await Promise.all([
    readFile(orchestratorPath, 'utf8'),
    readFile(executionPath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);
  assert.match(orchestrator, /async retry\(/);
  assert.match(execution, /recovery_detail/);
  assert.match(execution, /state: 'started' \| 'completed' \| 'failed'/);
  assert.match(engine, /execution_status: 'retrying'/);
  assert.match(engine, /recordCertificationCheckpoint/);
});

test('provider outages fail closed and terminal writes require the current lease', async () => {
  const [engine, execution] = await Promise.all([readFile(enginePath, 'utf8'), readFile(executionPath, 'utf8')]);
  assert.match(engine, /if \(!providerStatus\.ready\)/);
  assert.match(engine, /\.eq\('lease_owner', certification\.__executionContext\.leaseOwner\)/);
  assert.match(engine, /\.gt\('lease_expires_at', new Date\(\)\.toISOString\(\)\)/);
  assert.match(execution, /CERTIFICATION_LEASE_LOST/);
  assert.match(execution, /CERTIFICATION_FINALIZE_EXECUTION_FAILED/);
});

test('internal certification API is backend-only and does not accept cryptographic secrets', async () => {
  const route = await readFile(internalRoutePath, 'utf8');
  assert.match(route, /x-docubox-internal-token/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /operation: z\.enum\(\['execute', 'retry'\]\)/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /privateKey|certificatePem|token_base64|openbaoToken|kmsSecret/);
});
