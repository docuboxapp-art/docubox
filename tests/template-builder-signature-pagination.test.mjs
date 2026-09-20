import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageSource = await readFile('src/app/plantillas/nueva/page.tsx', 'utf8');
const fieldsSource = await readFile('src/app/plantillas/components/FieldsSidebar.tsx', 'utf8');
const paginatorSource = await readFile(
  'src/app/plantillas/components/DocumentPaginator.tsx',
  'utf8'
);

test('signature is optional, repeatable and rendered as a resizable rectangle', () => {
  const signatureDefinition = fieldsSource.slice(
    fieldsSource.indexOf("type: 'signature'"),
    fieldsSource.indexOf("type: 'text',\n    label: 'Nombre completo'")
  );
  const insertionSource = pageSource.slice(
    pageSource.indexOf('const insertGeneralField'),
    pageSource.indexOf('const buildPayload')
  );

  assert.doesNotMatch(signatureDefinition, /required:\s*true/);
  assert.match(insertionSource, /const fieldId = `field-\$\{Date\.now\(\)\}-/);
  assert.match(
    insertionSource,
    /const isRequired = !isSignatureField && options\?\.required === true/
  );
  assert.match(insertionSource, /width:180px;height:72px/);
  assert.match(insertionSource, /resize:both;overflow:hidden/);
  assert.match(insertionSource, /data-signature-resize-handle/);
  assert.doesNotMatch(insertionSource, /some\(.*fieldType.*signature/s);
});

test('large documents expose direct page selection and editor navigation', () => {
  assert.match(pageSource, /pageCount > 5/);
  assert.match(pageSource, /aria-label="Seleccionar página"/);
  assert.match(pageSource, /goToPage\(pageNumber\)/);
  assert.match(paginatorSource, /goToPage: \(pageNumber: number\) => boolean/);
  assert.match(paginatorSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
});

test('pagination preserves the native caret when page HTML has not changed', () => {
  assert.match(paginatorSource, /if \(el && el\.innerHTML !== html\)/);
});

test('typing and deletion preserve the caret through content repagination', () => {
  assert.match(paginatorSource, /data-docubox-caret-marker/);
  assert.match(paginatorSource, /markerRange\.insertNode\(marker\)/);
  assert.match(paginatorSource, /range\.setStartBefore\(marker\)/);
  assert.match(paginatorSource, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(paginatorSource, /pendingFocusRef/);
});

test('rich paste preserves safe source formatting and paginates oversized text blocks', () => {
  assert.match(paginatorSource, /inlineClipboardStyles\(doc\)/);
  assert.match(paginatorSource, /SAFE_CLIPBOARD_STYLE_PROPERTIES/);
  assert.match(paginatorSource, /normalizeClipboardPageBreaks\(doc\)/);
  assert.match(paginatorSource, /data-docubox-page-break/);
  assert.match(paginatorSource, /splitNodeToFit/);
  assert.match(paginatorSource, /pendingNodes\.unshift\(split\.after\)/);
  assert.match(paginatorSource, /const sanitizedHtml = sanitizePastedHtml\(html\)/);
  assert.match(paginatorSource, /hasMeaningfulFormatting/);
  assert.match(paginatorSource, /hasBlockContent && block\?\.parentElement === editorEl/);
  assert.match(paginatorSource, /parent\?\.insertBefore\(template\.content, block\)/);
});

test('signature resizing persists through editor change notifications', () => {
  assert.match(paginatorSource, /handleSignatureResizeStart/);
  assert.match(paginatorSource, /signature\.style\.width/);
  assert.match(paginatorSource, /signature\.style\.height/);
  assert.match(paginatorSource, /notifyChange\(\)/);
  assert.match(paginatorSource, /removeEditorOnlyFieldControls\(clone\)/);
  assert.match(pageSource, /chip\.querySelector\('\[data-field-label-text\]'\)/);
});

test('loaded template content remounts the editor after the async response', () => {
  assert.match(pageSource, /setEditorDocumentVersion\(\(current\) => current \+ 1\)/);
  assert.match(
    pageSource,
    /key=\{`template-editor-\$\{templateId \?\? 'new'\}-\$\{editorDocumentVersion\}`\}/
  );
});

test('Word namespace cleanup does not use invalid CSS selectors', () => {
  assert.doesNotMatch(paginatorSource, /querySelectorAll\('o\\\\:p/);
  assert.match(paginatorSource, /getElementsByTagName\('\*'\)/);
  assert.match(paginatorSource, /\/\^\(o\|w\|m\):\/i\.test\(el\.tagName\)/);
});

test('preview captures the editor document model instead of flattening currentHtml', () => {
  assert.match(pageSource, /querySelectorAll\('\[data-page-content="true"\]'\)/);
  assert.match(pageSource, /querySelector\('\[data-header-editable="true"\]'\)/);
  assert.match(pageSource, /querySelector\('\[data-footer-editable="true"\]'\)/);
  assert.match(
    pageSource,
    /livePages\.length >= serialized\.pages\.length[\s\S]*?\? livePages[\s\S]*?: serialized\.pages/
  );
  assert.match(pageSource, /previewSnapshot\.pages\s*\.map\(\(pageHtml, pageIndex\)/);
  assert.doesNotMatch(pageSource, /padding: '40px 60px'/);
});

test('preview and print reuse paginator dimensions, physical margins and repeated zones', () => {
  assert.match(paginatorSource, /export function cmToPx/);
  assert.match(paginatorSource, /export function getPageDimensions/);
  assert.match(pageSource, /getPageDimensions\(paperSize, orientation\)/);
  assert.match(pageSource, /cmToPx\(margenes\.top\)/);
  assert.match(pageSource, /height:\$\{margenes\.top\}cm/);
  assert.match(pageSource, /height:\$\{margenes\.bottom\}cm/);
  assert.match(pageSource, /resolvePreviewZoneHtml\(previewSnapshot\.headerHtml, pageIndex\)/);
  assert.match(pageSource, /resolvePreviewZoneHtml\(previewSnapshot\.footerHtml, pageIndex\)/);
  assert.match(pageSource, /const pagesMarkup = previewSnapshot\.pages/);
});

test('preview presents one physical sheet at a time with direct pagination', () => {
  assert.match(pageSource, /const \[previewPage, setPreviewPage\] = useState\(1\)/);
  assert.match(pageSource, /data-preview-page=\{pageIndex \+ 1\}/);
  assert.match(pageSource, /aria-label="Seleccionar página de vista previa"/);
  assert.match(pageSource, /aria-label="Página anterior"/);
  assert.match(pageSource, /aria-label="Página siguiente"/);
  assert.match(pageSource, /overflow-auto overscroll-contain bg-gray-300/);
  assert.match(pageSource, /border: '1px solid #d1d5db'/);
});

test('preview wheel navigation changes pages only at sheet boundaries', () => {
  assert.match(pageSource, /onWheel=\{handlePreviewWheel\}/);
  assert.match(pageSource, /const reachedBoundary = movingForward \? atEnd : atStart/);
  assert.match(pageSource, /previewWheelLockUntilRef\.current = now \+ 350/);
  assert.match(
    pageSource,
    /goToPreviewPage\(previewPage \+ \(movingForward \? 1 : -1\), movingForward \? 'start' : 'end'\)/
  );
  assert.match(pageSource, /overscroll-contain bg-gray-300/);
});
