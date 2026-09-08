import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const editorSource = await readFile('src/app/plantillas/nueva/page.tsx', 'utf8');
const sidebarSource = await readFile(
  'src/app/plantillas/components/FieldPropertiesSidebar.tsx',
  'utf8'
);

test('template fields are inserted only into a real document page and synchronized', () => {
  const insertionSource = editorSource.slice(
    editorSource.indexOf('const insertGeneralField'),
    editorSource.indexOf('const buildPayload')
  );

  assert.match(insertionSource, /\[data-page-content\]\[contenteditable="true"\]/);
  assert.match(insertionSource, /findInsertedFieldElement\(fieldId\)/);
  assert.match(insertionSource, /notifyEditorMutation\(targetPage\)/);
  assert.doesNotMatch(insertionSource, /execCommand\('insertHTML', false, chip\)/);
});

test('inserted fields can be located, highlighted and removed from document and state', () => {
  assert.match(editorSource, /scrollIntoView\(\{ behavior: 'smooth'/);
  assert.match(editorSource, /data-field-selected/);
  assert.match(editorSource, /fieldElement\.remove\(\)/);
  assert.match(editorSource, /current\.filter\(\(field\) => field\.id !== fieldId\)/);
  assert.match(editorSource, /onDeleteField=\{handleDeleteField\}/);
  assert.match(sidebarSource, /title="Eliminar campo"/);
  assert.match(sidebarSource, />\s*Eliminar campo\s*</);
});

test('the inserted-fields list is reconciled with visible document fields and page indexes', () => {
  assert.match(editorSource, /presentIds\.has\(field\.id\)/);
  assert.match(editorSource, /getPageIndexForNode\(fieldElement\)/);
  assert.match(
    editorSource,
    /El campo ya no existe en el documento y se retiró de la lista\./
  );
});
