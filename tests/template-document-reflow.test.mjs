import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const flowSource = await readFile('src/lib/templates/document-flow.ts', 'utf8');
const previewSource = await readFile(
  'src/components/templates/TemplateDocumentPreview.tsx',
  'utf8'
);
const htmlPreviewSource = await readFile('src/components/templates/TemplateHtmlPreview.tsx', 'utf8');
const templatePreviewSource = await readFile('src/lib/templates/preview.ts', 'utf8');
const viewerSource = await readFile('src/app/visor-documento/[id]/page.tsx', 'utf8');
const signingSource = await readFile('src/app/firmar-documento/[id]/page.tsx', 'utf8');
const sealSource = await readFile(
  'src/app/api/documentos/[documentId]/seal-signatures/route.ts',
  'utf8'
);
const intelligenceSource = await readFile('src/lib/ai/documentIntelligence.ts', 'utf8');

test('template values render as flowing inline text while preserving whitespace', () => {
  assert.match(flowSource, /field\.dataset\.fieldValueKey \|\| fieldId/);
  assert.match(flowSource, /field\.style\.display = 'inline'/);
  assert.match(flowSource, /field\.style\.whiteSpace = 'pre-wrap'/);
  assert.match(flowSource, /field\.style\.width = 'auto'/);
  assert.match(flowSource, /field\.style\.height = 'auto'/);
  assert.match(flowSource, /const needsLeadingSpace/);
  assert.match(flowSource, /const needsTrailingSpace/);
  assert.match(flowSource, /!\/\^\[,\.;:\!\?%\)\\\]}]\//);
  assert.match(previewSource, /applyTemplateFieldValues/);
  assert.match(previewSource, /<TemplateHtmlPreview/);
});

test('template field resolution preserves the typography authored in the template', () => {
  assert.match(flowSource, /const originalTypography = \{/);
  assert.match(flowSource, /fontFamily: field\.style\.fontFamily/);
  assert.match(flowSource, /fontSize: field\.style\.fontSize/);
  assert.match(flowSource, /const originalLayout = \{/);
  assert.match(flowSource, /marginInline: field\.style\.marginInline/);
  assert.match(flowSource, /textAlign: field\.style\.textAlign/);
  assert.match(flowSource, /textIndent: field\.style\.textIndent/);
  assert.match(flowSource, /Object\.assign\(field\.style, originalTypography, originalLayout\)/);
  assert.doesNotMatch(flowSource, /field\.style\.fontFamily = 'inherit'/);
  assert.match(templatePreviewSource, /TEMPLATE_FONT_STYLESHEET_URL/);
  assert.match(templatePreviewSource, /https:\/\/fonts\.gstatic\.com/);
  assert.equal(
    (templatePreviewSource.match(/href="\$\{TEMPLATE_FONT_STYLESHEET_URL\}"/g) || []).length,
    3
  );
});

test('template margins remain the page content boundary in previews and generated PDFs', () => {
  assert.match(templatePreviewSource, /safeMargin\(template\.margenes\?\.top, 2\.54\)/);
  assert.match(templatePreviewSource, /safeMargin\(template\.margenes\?\.bottom, 2\.54\)/);
  assert.match(templatePreviewSource, /safeMargin\(template\.margenes\?\.left, 3\.17\)/);
  assert.match(templatePreviewSource, /safeMargin\(template\.margenes\?\.right, 3\.17\)/);
  assert.match(
    templatePreviewSource,
    /class="template-preview-content" style="padding:0 \$\{right\}cm 0 \$\{left\}cm"/
  );
  assert.match(templatePreviewSource, /buildTemplatePageMarkup\(template, pageHtml/);
});

test('generated template PDFs keep authored text as vector content', () => {
  assert.match(templatePreviewSource, /function drawTemplateVectorText/);
  assert.match(templatePreviewSource, /createTreeWalker\(/);
  assert.match(templatePreviewSource, /range\.getClientRects\(\)/);
  assert.match(templatePreviewSource, /StandardFonts\.TimesRoman/);
  assert.match(templatePreviewSource, /-webkit-text-fill-color/);
  assert.match(templatePreviewSource, /drawTemplateVectorText\(\{ page, pageElement, fonts/);
  assert.match(
    templatePreviewSource,
    /const tokenPattern = \/\[\^\\S\\r\\n\]\*\\S\+\[\^\\S\\r\\n\]\*\/g/
  );
  assert.match(templatePreviewSource, /font\.widthOfTextAtSize\(safeText, fontSize\)/);
  assert.match(templatePreviewSource, /setCharacterSqueeze\(horizontalScale\)/);
  assert.match(templatePreviewSource, /runRange\.getBoundingClientRect\(\)/);
});

test('template signature fields use the participant signature step instead of a text input', () => {
  assert.match(signingSource, /signature: 'firma'/);
  assert.match(signingSource, /const explicitTipo = normalizeFieldTipo\(c\.tipo\)/);
  assert.match(
    signingSource,
    /La estampa de firma se configurará en el paso siguiente con la\s+firma del participante asignado\./
  );
  assert.match(signingSource, /field\.tipo === 'firma' \? firmaData : field\.value/);
  assert.match(
    signingSource,
    /camposPrefijados\.some\(\(c\) => resolveFieldTipo\(c\) === 'firma'\)/
  );
});

test('the signed template preview hides the loose autograph and measures after assets load', () => {
  assert.match(flowSource, /if \(!final && value\.startsWith\('data:image\/'\)\)/);
  assert.match(signingSource, /final=\{Boolean\(displayFirmaData\)\}/);
  assert.equal((signingSource.match(/final=\{Boolean\(firmaData\)\}/g) || []).length, 2);
  assert.match(htmlPreviewSource, /await frameDocument\.fonts\?\.ready/);
  assert.match(htmlPreviewSource, /await Promise\.all\(\s*Array\.from\(frameDocument\.images\)/);
  assert.match(htmlPreviewSource, /frame\.contentDocument !== frameDocument/);
});

test('template documents do not offer additional information fields', () => {
  assert.match(
    signingSource,
    /const isTemplateOriginDocument = Boolean\(document\?\.source_template_id \|\| templateDocument\)/
  );
  assert.match(signingSource, /hasCamposPrefijados && !isTemplateOriginDocument && \(/);
  assert.match(signingSource, /!isTemplateOriginDocument && \(\s*<div className="space-y-3">/);
  assert.match(signingSource, /file_type, source_template_id, campos_solicitados/);
});

test('viewer and signer render template documents with the same HTML preview', () => {
  assert.match(viewerSource, /<TemplateDocumentPreview/);
  assert.match(viewerSource, /template=\{templateDocument\}/);
  assert.match(viewerSource, /headers: templateHeaders/);
  assert.match(signingSource, /<TemplateDocumentPreview/);
  assert.match(signingSource, /values=\{templateFieldValues\}/);
  assert.match(signingSource, /headers: authorizationHeaders/);
  assert.match(flowSource, /credentials: 'same-origin'/);
  assert.match(flowSource, /headers,/);
});

test('participant values feed the template and final signature positions follow reflow', () => {
  assert.match(signingSource, /getAutoFillValue\(resolvedTipo, userProfileRef\.current\)/);
  assert.match(
    signingSource,
    /setCamposValues\(\{[\s\S]*?\.\.\.initValues,[\s\S]*?\.\.\.savedServerValues,[\s\S]*?restorableSession/
  );
  assert.match(signingSource, /templateFieldValues/);
  assert.match(signingSource, /templateFieldMeasurements/);
  assert.match(sealSource, /templateFieldMeasurements/);
  assert.match(sealSource, /const measuredFields = new Map/);
  assert.match(sealSource, /measuredFields\.get\(field\.id\)/);
});

test('completed template documents are materialized and viewed as certified PDFs', () => {
  assert.match(viewerSource, /createPdfFromPublishedTemplate/);
  assert.match(viewerSource, /applyTemplateFieldValues/);
  assert.match(viewerSource, /templateFieldMeasurements/);
  assert.match(viewerSource, /sealBody\.append\('templatePdf'/);
  assert.match(viewerSource, /completedTemplate[\s\S]*?'certified'/);
  assert.match(viewerSource, /formato: completedPdfAvailable \? 'application\/pdf'/);
  assert.match(viewerSource, /Preparando PDF final/);
  assert.match(
    viewerSource,
    /showCampos &&\s*!isTemplateDocumentMimeType\(document\.file_type\) &&\s*camposEnPaginaActual\.length > 0/
  );
  assert.match(
    viewerSource,
    /\{!isTemplateDocumentMimeType\(document\.file_type\) && \(\s*<button[\s\S]*?Campos \(\{effectiveCampos\.length\}\)/
  );
});

test('viewer only exposes optional tabs when their document configuration applies', () => {
  assert.match(viewerSource, /packageReadiness\.hasContent/);
  assert.match(viewerSource, /document\.estado === 'completado' && \(canManagePermissions/);
  assert.match(
    viewerSource,
    /luciaAvailability\.loaded &&\s*luciaAvailability\.enabled &&\s*document\.estado === 'completado'/
  );
  assert.match(viewerSource, /payload\?\.features\?\.contractual === true/);
  assert.match(intelligenceSource, /features:\s*\{\s*contractual: contractualEnabled/);
  assert.match(viewerSource, /accessSummary\.enabled && accessSummary\.canManage/);
  assert.match(viewerSource, /document\.tiene_vencimiento && document\.vencimiento/);
  assert.match(viewerSource, /document\.metadatos_adicionales \|\| additionalMetadata\.length > 0/);
});

test('viewer exposes template origin details and participant field responses', () => {
  assert.match(
    viewerSource,
    /document\.source_template_id \|\|\s*isTemplateDocumentMimeType\(document\.file_type\) \|\|\s*templateDocument/
  );
  assert.match(viewerSource, /key: 'template-origin'/);
  assert.match(viewerSource, /Detalle de plantilla/);
  assert.match(viewerSource, /Información completada/);
  assert.match(viewerSource, /response\?\.campos_completados/);
  assert.match(viewerSource, /Campos completados/);
  assert.match(viewerSource, /participant\?\.rolDocumento/);
  assert.match(viewerSource, /participant\?\.metodo_firma/);
  assert.match(viewerSource, /Firma registrada/);
  assert.doesNotMatch(viewerSource, /Participation response: signature \+ filled fields/);
});
