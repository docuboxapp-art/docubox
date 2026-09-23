import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sealRoute = await readFile(
  new URL('../src/app/api/documentos/[documentId]/seal-signatures/route.ts', import.meta.url),
  'utf8'
);
const orchestrator = await readFile(
  new URL('../src/lib/evidence-v2/orchestrator.ts', import.meta.url),
  'utf8'
);
const evidenceService = await readFile(
  new URL('../src/lib/evidence-v2/service.ts', import.meta.url),
  'utf8'
);
const viewer = await readFile(
  new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('local sealing starts the durable evidence worker without waiting for a scheduled cron', () => {
  assert.match(sealRoute, /await enqueueEvidenceFinalization\(service/);
  assert.match(sealRoute, /after\(async \(\) => \{/);
  assert.match(
    sealRoute,
    /if \(process\.env\.NODE_ENV === 'development'\) \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?processEvidenceFinalization\(service, \{ documentId: input\.documentId \}\)/
  );
});

test('finalization keeps provider and database error details for actionable retries', () => {
  assert.match(orchestrator, /function internalErrorDetail\(error: unknown\)/);
  assert.match(orchestrator, /'message' in error/);
  assert.match(orchestrator, /errorDetail: internalErrorDetail\(error\)/);
});

test('evidence uses persisted participant completion timestamps', () => {
  assert.doesNotMatch(evidenceService, /respondido_at/);
  assert.match(evidenceService, /firma_completada_at,aprobacion_completada_at,witness_completed_at,operational_committed_at/);
});

test('stored XML is checked against the artifact hash, not its embedded canonical digest', () => {
  assert.match(evidenceService, /const xmlArtifactSha256 = sha256Hex\(Buffer\.from\(built\.xml, 'utf8'\)\)/);
  assert.match(evidenceService, /persistedXmlHash !== xmlArtifactSha256/);
  assert.match(evidenceService, /xml_sha256: xmlArtifactSha256/);
  assert.match(evidenceService, /xmlHash: xmlArtifactSha256/);
});

test('viewer distinguishes a verified development constancia from production evidence', () => {
  assert.match(viewer, /!nom151Data\.production_trusted/);
  assert.match(viewer, /Emisión de desarrollo verificada técnicamente/);
});
