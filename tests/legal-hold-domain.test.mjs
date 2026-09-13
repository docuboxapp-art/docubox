import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260912183417_document_legal_holds_domain.sql'
);
const api = await read('../src/app/api/documentos/[documentId]/legal-hold/route.ts');
const domain = await read('../src/lib/documents/legal-hold.ts');
const purge = await read('../src/lib/documents/purge-document.ts');
const viewer = await read('../src/app/visor-documento/[id]/page.tsx');
const mySpace = await read('../src/app/mis-documentos/page.tsx');
const createStep = await read('../src/app/crear-documento/components/StepSubir.tsx');
const evidence = await read('../src/lib/evidence-v2/supplements.ts');

const outputDirectory = 'node_modules/.cache/docubox-legal-hold-domain-tests';
const outputFile = `${outputDirectory}/lifecycle-policy.mjs`;
await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: ['src/lib/documents/lifecycle-policy.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: outputFile,
  logLevel: 'silent',
});
const { evaluateDocumentDisposition } = await import(
  `${pathToFileURL(outputFile).href}?v=${Date.now()}`
);

for (const state of ['en_proceso', 'completado', 'cancelado', 'expirado']) {
  test(`${state} remains preservable while workflow state stays independent`, () => {
    const result = evaluateDocumentDisposition({ estado: state, legal_hold_status: 'ACTIVE' });
    assert.equal(result.legalHoldActive, true);
    assert.equal(result.canPurgeFromTrash, false);
    assert.equal(result.canDirectPurge, false);
  });
}

test('the real entity supports multiple active records without a uniqueness constraint', () => {
  assert.match(migration, /CREATE TABLE public\.document_legal_holds/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(document_id\s*,\s*status\)/i);
  assert.match(migration, /WHERE status = 'ACTIVE'/);
});

test('review and expected end dates are informational and have no expiration job', () => {
  assert.match(migration, /review_at timestamptz/);
  assert.match(migration, /expected_end_at timestamptz/);
  assert.match(migration, /informational and never release a hold/);
  assert.doesNotMatch(migration, /expire_document_legal_hold|auto_release_legal_hold/i);
});

test('source-of-truth rows maintain the legacy cache transactionally', () => {
  assert.match(migration, /sync_document_legal_hold_cache/);
  assert.match(migration, /source of truth[\s\S]*documentos\.legal_hold/i);
});

test('activation and release serialize on the document row', () => {
  assert.match(migration, /activate_document_legal_hold[\s\S]*FOR UPDATE/);
  assert.match(migration, /release_document_legal_hold[\s\S]*FOR UPDATE/);
});

test('releasing one hold recomputes the remaining active count', () => {
  assert.match(migration, /remaining_active_count/);
  assert.match(migration, /SELECT count\(\*\) INTO v_active_count/);
});

test('release requires an explicit reason and never changes document status', () => {
  assert.match(migration, /LEGAL_HOLD_RELEASE_REASON_REQUIRED/);
  const releaseBody =
    migration.match(
      /CREATE OR REPLACE FUNCTION public\.release_document_legal_hold[\s\S]*?\$\$;/
    )?.[0] || '';
  assert.doesNotMatch(releaseBody, /estado\s*=/);
  assert.doesNotMatch(releaseBody, /DELETE FROM public\.documentos/);
});

test('API applies existing owner or workspace-admin authorization to every mutation', () => {
  assert.equal((api.match(/ownerOrAdminOnly: true/g) || []).length, 3);
  assert.match(api, /canViewDetails: canManage/);
});

test('RLS isolates hold reads through the existing document ACL', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /public\.can_access_documento\(document_id\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.document_legal_holds/);
});

test('creation captures all required hold metadata through the existing modal', () => {
  for (const field of [
    'legalHoldReason',
    'legalHoldCaseReference',
    'legalHoldReviewAt',
    'legalHoldNotes',
  ]) {
    assert.match(createStep, new RegExp(field));
  }
  assert.match(createStep, /permanece activo hasta su liberación expresa/);
});

test('viewer exposes a first-level LEGAL HOLD tab only for history or requested activation', () => {
  assert.match(viewer, /key: 'legal-hold'/);
  assert.match(viewer, /label: 'LEGAL HOLD'/);
  assert.match(viewer, /legalHoldSummary\.hasHistory/);
  assert.match(viewer, /action.*activate/);
});

test('Mi Espacio offers activation or management without direct release', () => {
  assert.match(mySpace, /'Gestionar Legal Hold' : 'Activar Legal Hold'/);
  assert.match(mySpace, /tab=legal-hold/);
  assert.doesNotMatch(mySpace, /Liberar Legal Hold/);
});

test('operational activity receives activated, updated and released events', () => {
  for (const event of ['LEGAL_HOLD_ACTIVATED', 'LEGAL_HOLD_UPDATED', 'LEGAL_HOLD_RELEASED']) {
    assert.match(migration, new RegExp(event));
    assert.match(api, new RegExp(event));
  }
});

test('future Evidence V2 and closed V2 packages both receive Legal Hold evidence', () => {
  assert.match(migration, /append_legal_evidence_event/);
  assert.match(evidence, /appendLegalHoldEvidenceSupplement/);
  assert.match(evidence, /type: 'LEGAL_HOLD'/);
  assert.match(domain, /appendLegalHoldEvidenceSupplement/);
});

test('purge reserves destruction before any Storage removal', () => {
  const reserve = purge.indexOf("service.rpc('begin_document_purge'");
  const remove = purge.indexOf('await removeStorageBundle');
  assert.ok(reserve >= 0 && reserve < remove);
});

test('purge reservation consults active entity rows under a row lock', () => {
  assert.match(migration, /begin_document_purge[\s\S]*FOR UPDATE/);
  assert.match(migration, /has_active_document_legal_hold\(p_document_id\)/);
});

test('a failed purge exits PURGING through the domain abort function', () => {
  assert.match(purge, /abort_document_purge/);
  assert.match(migration, /lifecycle_status = 'PURGE_FAILED'/);
});

test('document and version deletion are database-blocked under active hold', () => {
  assert.match(migration, /documentos_reject_legal_hold_destruction/);
  assert.match(migration, /document_versions_reject_legal_hold_destruction/);
  assert.match(migration, /ERRCODE = '55006'/);
});

test('authenticated Storage deletion is denied under active hold', () => {
  assert.match(migration, /storage_document_has_active_legal_hold/);
  assert.match(migration, /NOT public\.storage_document_has_active_legal_hold\(name\)/);
});

test('released history remains queryable and drives viewer visibility', () => {
  assert.match(migration, /has_document_legal_hold_history/);
  assert.match(api, /hasHistory: holds\.length > 0/);
  assert.match(viewer, /hasHistory/);
});

test('all destructive API paths converge on the reserved purge service', () => {
  assert.match(purge, /begin_document_purge/);
  assert.match(purge, /purge_document_bundle/);
});
