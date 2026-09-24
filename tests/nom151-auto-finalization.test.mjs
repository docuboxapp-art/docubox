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
const signingPage = await readFile(
  new URL('../src/app/firmar-documento/[id]/page.tsx', import.meta.url),
  'utf8'
);
const evidenceRoute = await readFile(
  new URL('../src/app/api/documentos/[documentId]/evidence/route.ts', import.meta.url),
  'utf8'
);
const nom151StatusRoute = await readFile(
  new URL('../src/app/api/nom151/constancia/route.ts', import.meta.url),
  'utf8'
);

test('local sealing starts the durable evidence worker without waiting for a scheduled cron', () => {
  assert.match(sealRoute, /await enqueueEvidenceFinalization\(service/);
  assert.match(sealRoute, /after\(async \(\) => \{/);
  assert.match(
    sealRoute,
    /if \(process\.env\.NODE_ENV === 'development'\) \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?processEvidenceFinalization\(service, \{ documentId: input\.documentId \}\)/
  );
  assert.doesNotMatch(sealRoute, /timer\.unref\?\.\(\)/);
});

test('completion and viewer can resume the backend finalization without waiting for the daily cron', () => {
  assert.match(signingPage, /sealResponse\.ok[\s\S]*?fetch\(`\/api\/documentos\/\$\{document\.id\}\/evidence`/);
  assert.doesNotMatch(signingPage, /\/api\/nom151\/generate/);
  assert.match(viewer, /padesBtVerified &&[\s\S]*?nom151Ready &&[\s\S]*?void generateNom151\(\{ silent: true \}\)/);
  assert.match(viewer, /fetch\(`\/api\/documentos\/\$\{docId\}\/evidence`/);
  assert.match(evidenceRoute, /export async function POST/);
  assert.match(evidenceRoute, /await requireDocumentAccess\(request, documentId\)/);
  assert.match(evidenceRoute, /document\.estado !== 'completado'/);
  assert.match(evidenceRoute, /\.eq\('pades_profile', 'PAdES-B-T'\)/);
  assert.match(evidenceRoute, /\.eq\('verification_status', 'valid'\)/);
  assert.match(evidenceRoute, /pades_pdf_hash_after_signature/);
  assert.match(evidenceRoute, /await enqueueEvidenceFinalization\(service/);
  assert.match(evidenceRoute, /await processEvidenceFinalization\(service, \{ documentId \}\)/);
  assert.match(evidenceRoute, /issueNom151ForVerifiedPadesBt\(service, \{ documentId, requestedBy: user\.id \}\)/);
  assert.match(evidenceRoute, /synchronizeEvidenceSupplementsForDocument\(service, documentId\)/);
  assert.match(nom151StatusRoute, /pades_verified: true/);
  assert.match(nom151StatusRoute, /pades_pdf_hash_after_signature/);
});

test('a completed document awaiting NOM-151 is pending, never described as not requested', () => {
  assert.match(viewer, /requested: Boolean\(nom151Data\) \|\| document\?\.estado === 'completado'/);
  assert.match(viewer, /nom151Blocked[\s\S]*?Pendiente del cierre criptográfico PAdES-B-T/);
  assert.match(signingPage, /api\/nom151\/constancia\?documento_id=/);
  assert.doesNotMatch(signingPage, /\.from\('nom151_constancias'\)/);
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
