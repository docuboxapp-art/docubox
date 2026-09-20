import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const gallerySource = await readFile('src/app/plantillas/page.tsx', 'utf8');
const itemApiSource = await readFile('src/app/api/plantillas/[id]/route.ts', 'utf8');
const publicationServerSource = await readFile('src/lib/templates/publication-server.ts', 'utf8');

test('template gallery exposes archived templates as a reversible filter', () => {
  assert.match(
    gallerySource,
    /type TemplateFilter = 'published' \| 'draft' \| 'archived' \| 'favorites'/
  );
  assert.match(
    gallerySource,
    /<option value="archived">Archivadas \(\{filterCounts\.archived\}\)<\/option>/
  );
  assert.match(gallerySource, /isArchived \? 'Reactivar plantilla' : 'Archivar plantilla'/);
  assert.match(gallerySource, /<ArchiveRestore size=\{13\} \/>/);
  assert.doesNotMatch(gallerySource, /Eliminar plantilla/);
});

test('archive is a soft state transition and legacy DELETE no longer removes rows', () => {
  assert.match(itemApiSource, /async function archiveTemplate/);
  assert.match(
    itemApiSource,
    /\.update\(\{ estado: 'archived', estado_plantilla: 'Archivada' \}\)/
  );
  assert.match(itemApiSource, /eventType: 'template\.archived'/);
  assert.match(itemApiSource, /return await archiveTemplate\(request, id, workspaceId\)/);
  assert.doesNotMatch(itemApiSource, /\.from\('plantillas'\)\s*\.delete\(\)/);
});

test('reactivation restores the prior publication state and remains tenant scoped', () => {
  assert.match(itemApiSource, /async function reactivateTemplate/);
  assert.match(itemApiSource, /const restoredState = deriveTemplateState\(previousAction\)/);
  assert.match(itemApiSource, /eventType: 'template\.reactivated'/);
  assert.match(itemApiSource, /\.eq\('workspace_id', workspaceId\)/);
  assert.match(publicationServerSource, /estado_plantilla,publicacion_opcion,version_publicada/);
});
