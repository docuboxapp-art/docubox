import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const helperPath = new URL('../src/lib/documents/viewer-select.ts', import.meta.url);
const viewerPath = new URL('../src/app/visor-documento/[id]/page.tsx', import.meta.url);
const routePath = new URL('../src/app/api/documentos/obtener/route.ts', import.meta.url);

test('the document viewer retries without optional custody columns', async () => {
  const [helper, viewer, route] = await Promise.all([
    readFile(helperPath, 'utf8'),
    readFile(viewerPath, 'utf8'),
    readFile(routePath, 'utf8'),
  ]);

  assert.match(helper, /DOCUMENT_VIEWER_SELECT[\s\S]*current_custodian_workspace_id/);
  assert.match(helper, /DOCUMENT_VIEWER_SELECT[\s\S]*custody_updated_at/);

  const legacySelection = helper.match(/LEGACY_DOCUMENT_VIEWER_SELECT\s*=\s*\n?\s*'([^']+)'/)?.[1];
  assert.ok(legacySelection, 'legacy viewer selection should be declared');
  assert.doesNotMatch(legacySelection, /current_custodian_workspace_id|custody_updated_at/);

  for (const source of [viewer, route]) {
    assert.match(source, /isMissingDocumentCustodyColumns/);
    assert.match(source, /queryDocument\(DOCUMENT_VIEWER_SELECT\)/);
    assert.match(source, /queryDocument\(LEGACY_DOCUMENT_VIEWER_SELECT\)/);
    assert.match(source, /\.maybeSingle\(\)/);
  }
});

test('the document API only reports not found when no row exists', async () => {
  const route = await readFile(routePath, 'utf8');

  assert.match(route, /if \(docError\)[\s\S]*status: 500[\s\S]*if \(!doc\)[\s\S]*status: 404/);
});
