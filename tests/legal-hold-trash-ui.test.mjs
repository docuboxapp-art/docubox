import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const outputDirectory = 'node_modules/.cache/docubox-legal-hold-trash-tests';
const outputFile = `${outputDirectory}/trash-countdown.mjs`;

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: ['src/lib/documents/trash-countdown.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outputFile,
  logLevel: 'silent',
});

const { getTrashCountdown } = await import(`${pathToFileURL(outputFile).href}?v=${Date.now()}`);
const trashRoute = await read('../src/app/api/documentos/papelera/route.ts');
const purgeRoute = await read('../src/app/api/internal/document-purge/route.ts');
const listRoute = await read('../src/app/api/documentos/listar/route.ts');
const viewer = await read('../src/app/visor-documento/[id]/page.tsx');
const participationsRoute = await read('../src/app/api/documentos/mis-participaciones/route.ts');
const participationsPage = await read('../src/app/mis-participaciones/page.tsx');
const documentsPage = await read('../src/app/mis-documentos/page.tsx');
const legalHoldBadge = await read('../src/components/documents/LegalHoldBadge.tsx');
const legalHoldRoute = await read('../src/app/api/documentos/[documentId]/legal-hold/route.ts');

test('owner Legal Hold blocks a participant personal-trash operation before visibility changes', () => {
  const holdCheck = trashRoute.indexOf('if (disposition.legalHoldActive)');
  const personalTrash = trashRoute.indexOf("from('document_user_visibility').upsert");
  assert.ok(holdCheck >= 0 && holdCheck < personalTrash);
  assert.match(trashRoute, /LEGAL_HOLD_ACTIVE/);
});

test('Legal Hold blocks any participant removal path through the same trash endpoint', () => {
  assert.match(trashRoute, /access\.role === 'AUTHORIZED'/);
  assert.match(trashRoute, /legalHoldActive/);
  assert.match(trashRoute, /LEGAL_HOLD_TRASH_ATTEMPT/);
});

test('Legal Hold is visible without exposing its reason to ordinary participants', () => {
  assert.match(legalHoldBadge, /Legal Hold/);
  assert.match(legalHoldBadge, /No puede moverse a Papelera ni eliminarse/);
  assert.match(participationsRoute, /legalHoldActive/);
  assert.match(participationsPage, /LegalHoldBadge/);
  assert.doesNotMatch(participationsRoute, /legal_hold_reason/);
});

test('the owner and workspace administrator remain the only actors for Legal Hold administration', () => {
  assert.match(
    legalHoldRoute,
    /requireDocumentAccess\(request, documentId, \{ ownerOrAdminOnly: true \}\)/
  );
});

test('trash shows a thirty-day recovery countdown and scheduled automatic deletion', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');
  const result = getTrashCountdown('2026-10-02T12:00:00.000Z', now);
  assert.equal(result.state, 'RECOVERY');
  assert.equal(result.label, '30 días restantes');
  assert.match(documentsPage, /Tiempo restante/);
  assert.match(documentsPage, /Eliminación automática:/);
});

test('trash switches to an hourly countdown during the final 24 hours', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');
  const result = getTrashCountdown('2026-09-03T06:35:00.000Z', now);
  assert.equal(result.label, 'Se elimina en 18 h 35 min');
});

test('an expired recovery window enters FINAL_DELETE_CHECK before automatic purge', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');
  const result = getTrashCountdown('2026-09-02T11:59:00.000Z', now);
  assert.equal(result.state, 'DUE_FOR_EVALUATION');
  assert.match(listRoute, /FINAL_DELETE_CHECK/);
  assert.match(purgeRoute, /\.lte\('restore_until', now\)/);
});

test('a historical trashed document with Legal Hold never becomes an automatic purge candidate', () => {
  assert.match(purgeRoute, /classifyTrashRetention\(documents\.data \|\| \[\]\)/);
  assert.match(purgeRoute, /purgeEligible/);
  assert.match(documentsPage, /Eliminación suspendida/);
});

test('viewer receives Legal Hold state and renders the shared compact badge', () => {
  assert.match(viewer, /legal_hold, legal_hold_status/);
  assert.match(viewer, /<LegalHoldBadge/);
});
