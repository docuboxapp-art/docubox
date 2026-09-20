import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stepSource = await readFile('src/app/crear-documento/components/StepSubir.tsx', 'utf8');
const selectorSource = await readFile(
  'src/app/crear-documento/components/TemplateSourceSelector.tsx',
  'utf8'
);
const createDocumentSource = await readFile('src/app/crear-documento/page.tsx', 'utf8');
const settingsSource = await readFile('src/app/crear-documento/components/StepAjustes.tsx', 'utf8');
const sendSource = await readFile('src/app/crear-documento/components/StepEnviar.tsx', 'utf8');
const signingSource = await readFile('src/app/firmar-documento/[id]/page.tsx', 'utf8');
const previewSource = await readFile('src/lib/templates/preview.ts', 'utf8');
const documentFlowSource = await readFile('src/lib/templates/document-flow.ts', 'utf8');

test('create document presents templates as an additive source', () => {
  assert.match(stepSource, />Añade una plantilla</);
  assert.match(stepSource, /Últimas plantillas publicadas/);
  assert.match(stepSource, /recentPublishedTemplates\.length > 0/);
  assert.match(stepSource, /30 \* 24 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(stepSource, /Buscar una plantilla\.\.\./);
  assert.doesNotMatch(stepSource, /Plantillas guardadas/);
});

test('explore templates opens a searchable selector instead of leaving the wizard', () => {
  assert.match(stepSource, /setShowTemplateSelector\(true\)/);
  assert.match(stepSource, /<TemplateSourceSelector/);
  assert.match(selectorSource, /Seleccionar plantilla/);
  assert.match(selectorSource, /Buscar por nombre, descripción o tipo de documento/);
  assert.match(selectorSource, /Usar plantilla/);
});

test('selected published templates remain HTML sources throughout the wizard', () => {
  assert.match(stepSource, /templateApiFetch\(/);
  assert.match(stepSource, /onTemplateSourceChange\?\.\(selectedTemplate\)/);
  assert.doesNotMatch(stepSource, /createPdfFromPublishedTemplate\(selectedTemplate\)/);
  assert.match(stepSource, /<TemplateHtmlPreview/);
  assert.match(settingsSource, /template=\{templateSource\}/);
  assert.match(createDocumentSource, /!file && !templateSource/);
  assert.match(previewSource, /data-docubox-page-break/);
});

test('template PDF materialization happens only after the final signature', () => {
  assert.match(sendSource, /createTemplateDocumentFile\(templateSource\)/);
  assert.match(sendSource, /const fileToSend = templateSource/);
  assert.match(sendSource, /TEMPLATE_DOCUMENT_MIME_TYPE/);
  assert.doesNotMatch(sendSource, /createPdfFromPublishedTemplate\(templateSource\)/);
  assert.match(signingSource, /createPdfFromPublishedTemplate\(materializedTemplate/);
  assert.match(signingSource, /documentoEstado === 'completado'/);
  assert.match(documentFlowSource, /application\/vnd\.docubox\.template\+json/);
  assert.match(previewSource, /PDFDocument\.create\(\)/);
});
