import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getTemplatePageCount } from '../src/lib/templates/preview.ts';

const paginator = readFileSync('src/app/plantillas/components/DocumentPaginator.tsx', 'utf8');
const preview = readFileSync('src/components/templates/TemplateHtmlPreview.tsx', 'utf8');
const settings = readFileSync('src/app/crear-documento/components/StepAjustes.tsx', 'utf8');

test('the template editor persists physical page separators', () => {
  const separatorJoins = paginator.match(/\.join\(createPageBreakMarker\(document\)\.outerHTML\)/g) || [];
  assert.equal(separatorJoins.length, 2);
  assert.match(
    paginator,
    /querySelectorAll\('\[data-docubox-page-break\]'\)\.forEach\(\(marker\) => marker\.remove\(\)\)/
  );
});

test('legacy templates infer an initial page count from fields on later pages', () => {
  assert.equal(
    getTemplatePageCount({
      id: 'template-1',
      nombre: 'Plantilla extensa',
      updated_at: '2026-09-19T00:00:00.000Z',
      contenido_html: '<p>Página sin separadores guardados</p>',
      campos_insertados: [{ id: 'field-1', pageIndex: 18 }],
    }),
    19
  );
});

test('create document reconstructs legacy pagination and updates its page navigation', () => {
  assert.match(preview, /resolveTemplatePreviewSnapshot\(template\)/);
  assert.match(preview, /onPageCountChange\?\.\(resolved\.pages\.length\)/);
  assert.match(settings, /onPageCountChange=\{setTotalPages\}/);
});

test('the final PDF uses the same complete pagination resolved by the preview', () => {
  const previewLibrary = readFileSync('src/lib/templates/preview.ts', 'utf8');
  assert.match(
    previewLibrary,
    /createPdfFromPublishedTemplate[\s\S]*?await resolveTemplatePreviewSnapshot\(template\)/
  );
});
