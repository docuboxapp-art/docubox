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

test('selected template fields keep independent positions and a shared value identity', () => {
  const selectedActionsSource = sidebarSource.slice(sidebarSource.lastIndexOf('{/* Page info */}'));

  assert.match(editorSource, /const handleDuplicateField = useCallback/);
  assert.match(editorSource, /fieldElement\.cloneNode\(true\)/);
  assert.match(editorSource, /duplicateElement\.setAttribute\('data-field-id', duplicateId\)/);
  assert.match(
    editorSource,
    /duplicateElement\.setAttribute\('data-field-value-key', sharedValueKey\)/
  );
  assert.match(editorSource, /insertionRange\.insertNode\(duplicateElement\)/);
  assert.match(editorSource, /savedSelectionRef\.current/);
  assert.match(editorSource, /duplicateElement\.style\.marginInline = '2px'/);
  assert.match(editorSource, /options: \[\.\.\.source\.options\]/);
  assert.match(editorSource, /valueKey: source\.valueKey \|\| source\.id/);
  assert.match(editorSource, /onDuplicateField=\{handleDuplicateField\}/);
  assert.match(sidebarSource, />\s*Duplicar campo\s*</);
  assert.match(sidebarSource, /title="Duplicar campo"/);
  assert.ok(
    selectedActionsSource.indexOf('Eliminar campo') <
      selectedActionsSource.indexOf('Duplicar campo')
  );
});

test('inserted and duplicated field labels match the text size at the cursor', () => {
  assert.match(editorSource, /const getInsertionFontSize = useCallback/);
  assert.match(editorSource, /fieldElement\.style\.fontSize = insertionFontSize/);
  assert.match(editorSource, /duplicateElement\.style\.fontSize = targetFontSize/);
  assert.match(editorSource, /getInsertionFontSize\(currentRange\.startContainer, targetPage\)/);
});

test('the inserted-fields list is reconciled with visible document fields and page indexes', () => {
  assert.match(editorSource, /presentIds\.has\(field\.id\)/);
  assert.match(editorSource, /getPageIndexForNode\(fieldElement\)/);
  assert.match(editorSource, /El campo ya no existe en el documento y se retiró de la lista\./);
});

test('the inserted-fields list uses normal-weight aligned metadata text', () => {
  assert.match(sidebarSource, /text-xs font-normal leading-4 text-slate-600/);
  assert.match(sidebarSource, /text-\[10px\] font-normal leading-\[14px\] text-slate-400/);
  assert.match(sidebarSource, /text-\[13px\] font-normal text-gray-900/);
  assert.match(sidebarSource, /items-start justify-between gap-2/);
});

test('a selected template field shows only its typography and color controls', () => {
  const toolbarSource = editorSource.slice(
    editorSource.indexOf('function SimpleEditorToolbar'),
    editorSource.indexOf('function StepInfoGeneral')
  );

  assert.match(
    toolbarSource,
    /aria-label=\{chipSelected \? 'Formato del campo seleccionado' : 'Formato del documento'\}/
  );
  assert.match(toolbarSource, /chipSelected \? 'field-formatting-mode' : ''/);
  assert.match(toolbarSource, /onClick=\{onToggleRulers\}[\s\S]*?disabled=\{chipSelected\}/);
  assert.match(toolbarSource, /value=\{currentParaStyle\}[\s\S]*?disabled=\{chipSelected\}/);
  assert.match(toolbarSource, /\.field-formatting-mode > :global\(button:disabled\)/);
  assert.match(toolbarSource, /\.field-formatting-mode > :global\(select:disabled\)/);
  assert.match(toolbarSource, /\.field-formatting-mode > :global\(\.w-px\)/);
  assert.match(toolbarSource, /\.field-formatting-mode > :global\(\.field-divider-visible\)/);
  assert.match(toolbarSource, /showFindReplace && !chipSelected/);
  assert.match(toolbarSource, /title="Fuente"/);
  assert.match(toolbarSource, /title="Tamaño de fuente"/);
  assert.match(toolbarSource, /execCmd\('foreColor', e\.target\.value\)/);
  assert.match(toolbarSource, /execCmd\('hiliteColor', e\.target\.value\)/);
});
