import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const historyRoute = await read('../src/app/api/documentos/eliminaciones/route.ts');
const trashPage = await read('../src/app/mis-documentos/page.tsx');
const profilePage = await read('../src/app/mi-perfil/page.tsx');
const trashRoute = await read('../src/app/api/documentos/papelera/route.ts');

test('deletion-history API defaults to the last thirty days and exposes an explicit full-history scope', () => {
  assert.match(historyRoute, /searchParams\.get\('scope'\) === 'all' \? 'all' : 'recent'/);
  assert.match(historyRoute, /recentSince\.setDate\(recentSince\.getDate\(\) - 30\)/);
  assert.match(historyRoute, /window_days: scope === 'recent' \? 30 : null/);
});

test('trash announces the thirty-day history window and links to the full profile history', () => {
  assert.match(trashPage, /Se muestran únicamente los últimos 30 días\./);
  assert.match(trashPage, /\/mi-perfil\?section=historial-eliminaciones/);
  assert.match(trashPage, /Ver todos/);
  assert.match(trashPage, /entry\.document_name \|\| 'Elemento eliminado'/);
  assert.match(trashPage, />Creación<\/span>/);
  assert.match(trashPage, />En Papelera<\/span>/);
  assert.match(trashPage, /Forma de eliminación/);
  assert.match(trashPage, /Purgado desde Papelera/);
  assert.match(trashPage, /Movido a Papelera/);
  assert.match(trashPage, /entry\.status === 'TRASHED'/);
  assert.match(trashPage, /DELETION_HISTORY_PAGE_SIZE = 5/);
  assert.match(trashPage, /Mostrando \{deletionHistoryStart \+ 1\}/);
  assert.match(trashPage, /formatDateTime\(entry\.document_created_at\)/);
  assert.match(trashPage, /formatDateTime\(entry\.document_trashed_at\)/);
  assert.match(trashPage, /formatDateTime\(entry\.requested_at\)/);
});

test('trash has filter, ordering, list and card views, with icon-only row actions', () => {
  assert.match(trashPage, /Filtros/);
  assert.match(trashPage, /papeleraSortOrder/);
  assert.match(trashPage, /papeleraViewMode === 'grid'/);
  assert.match(trashPage, /aria-label=\{`Restaurar \$\{doc\.name\}`\}/);
  assert.match(trashPage, /aria-label=\{`Eliminar permanentemente \$\{doc\.name\}`\}/);
  assert.doesNotMatch(trashPage, /Ref\. \{doc\.id\.slice\(0, 8\)\}/);
});

test('bulk trash selection distinguishes purge-ready documents from retained documents', () => {
  assert.match(trashPage, /listo\(s\) para eliminación permanente/);
  assert.match(trashPage, /retenido\(s\) por recuperación, retención o Legal\s+Hold/);
  assert.match(trashPage, /Eliminar \{selectedTrashEligible\.length \|\| ''\} seleccionados/);
  assert.match(trashPage, /openConfirmSelectedPurge/);
  assert.match(trashRoute, /document_ids\?: string\[\]/);
  assert.match(trashRoute, /documentIds\.length > 100/);
});

test('profile provides the complete deletion-history table with filters', () => {
  assert.match(profilePage, /historial-eliminaciones/);
  assert.match(profilePage, /\/api\/documentos\/eliminaciones\?scope=all/);
  assert.match(profilePage, /Buscar por documento, referencia o motivo/);
  assert.match(profilePage, /entry\.document_name/);
  assert.match(profilePage, /Todos los estados/);
  assert.match(profilePage, /<option value="TRASHED">En Papelera<\/option>/);
  assert.match(profilePage, />Cronología<\/th>/);
  assert.match(profilePage, /Sin cronología previa disponible/);
  assert.match(profilePage, /Solicitud del titular/);
  assert.match(profilePage, /Detalle del elemento no disponible/);
});
