import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [
  stepUpload,
  stepSend,
  createDocument,
  sendRoute,
  draftRoute,
  listRoute,
  participationRoute,
  documentsPage,
  migration,
] = await Promise.all([
  read('src/app/crear-documento/components/StepSubir.tsx'),
  read('src/app/crear-documento/components/StepEnviar.tsx'),
  read('src/app/crear-documento/page.tsx'),
  read('src/app/api/documentos/enviar/route.ts'),
  read('src/app/api/documentos/guardar-borrador/route.ts'),
  read('src/app/api/documentos/listar/route.ts'),
  read('src/app/api/documentos/mis-participaciones/route.ts'),
  read('src/app/mis-documentos/page.tsx'),
  read('supabase/migrations/20260915015647_document_template_origin.sql'),
]);

test('template source rows use a distinctive template icon', () => {
  assert.match(stepUpload, /<LayoutTemplate size=\{17\}/);
  assert.match(stepUpload, /aria-label="Plantilla de Docubox"/);
  assert.match(
    stepSend,
    /templateSource \? <LayoutTemplate size=\{20\} \/> : <FileText size=\{20\} \/>/
  );
  assert.match(stepSend, /Documento creado desde una plantilla/);
});

test('draft and sent documents persist the exact selected template id', () => {
  assert.match(stepSend, /sourceTemplateId: templateSource\?\.id \|\| null/);
  assert.match(createDocument, /sourceTemplateId: templateSource\?\.id \|\| null/);
  for (const route of [sendRoute, draftRoute]) {
    assert.match(route, /\.eq\('workspace_id', resolvedWorkspaceId\)/);
    assert.match(route, /source_template_id: verifiedSourceTemplateId/);
  }
});

test('template origin is tenant constrained in the database', () => {
  assert.match(
    migration,
    /source_template_id UUID[\s\S]*?REFERENCES public\.plantillas\(id\) ON DELETE SET NULL/
  );
  assert.match(migration, /NEW\.workspace_id IS DISTINCT FROM template_workspace_id/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF workspace_id, source_template_id/);
});

test('My documents receives the origin and preserves status-colored icons', () => {
  assert.match(listRoute, /source_template_id/);
  assert.match(participationRoute, /sourceTemplateId: doc\.source_template_id \?\? null/);
  assert.match(documentsPage, /sourceTemplateId: d\.source_template_id \|\| null/);
  assert.match(documentsPage, /function DocumentSourceIcon/);
  assert.match(documentsPage, /aria-label="Creado desde una plantilla"[\s\S]*?<LayoutTemplate/);
  assert.match(documentsPage, /className=\{getDocIconColor\(doc\.estado\)\}/);
});

test('My documents can filter direct documents and template-origin documents', () => {
  assert.match(documentsPage, /activeFilters\['origen'\] === 'plantilla'/);
  assert.match(documentsPage, /activeFilters\['origen'\] === 'documento'/);
  assert.match(documentsPage, /Boolean\(doc\.sourceTemplateId\)/);
  assert.match(documentsPage, /hasDocumentOriginFilter = Boolean\(activeFilters\['origen'\]\)/);
  assert.match(documentsPage, /label: 'Plantilla'/);
  assert.match(documentsPage, /label: 'Documento'/);
});
