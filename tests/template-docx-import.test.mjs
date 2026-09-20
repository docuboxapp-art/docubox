import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import JSZip from 'jszip';

const root = process.cwd();
const compiledParser = path.join(root, '.tmp', 'template-docx-parser-test.mjs');
await mkdir(path.dirname(compiledParser), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/lib/template-import/docx/parser.ts')],
  outfile: compiledParser,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'silent',
});
const { parseTemplateDocx, TemplateDocxImportError } = await import(
  `${pathToFileURL(compiledParser).href}?v=${Date.now()}`
);

const namespaces = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
].join(' ');

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document ${namespaces}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

async function fixture({ body, styles, numbering, relationships, files = {}, rawDocument }) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('word/document.xml', rawDocument ?? documentXml(body));
  if (styles) zip.file('word/styles.xml', styles);
  if (numbering) zip.file('word/numbering.xml', numbering);
  if (relationships) zip.file('word/_rels/document.xml.rels', relationships);
  Object.entries(files).forEach(([name, value]) => zip.file(name, value));
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function parse(bytes, filename = 'contrato.docx') {
  return parseTemplateDocx({
    bytes,
    filename,
    workspaceId: '11111111-1111-4111-a111-111111111111',
    importId: '22222222-2222-5222-a222-222222222222',
  });
}

test('case 1: imports editable paragraphs', async () => {
  const result = await parse(
    await fixture({
      body: '<w:p><w:r><w:t>Primer párrafo</w:t></w:r></w:p><w:p><w:r><w:t>Segundo párrafo</w:t></w:r></w:p>',
    })
  );
  assert.match(result.contentHtml, /<p>Primer párrafo<\/p>/);
  assert.match(result.contentHtml, /<p>Segundo párrafo<\/p>/);
  assert.equal(result.stats.paragraphs, 2);
});

test('case 2: preserves headings, bold, italic, alignment and page breaks', async () => {
  const styles = `<w:styles ${namespaces}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>`;
  const body =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Contrato</w:t><w:br w:type="page"/></w:r></w:p>';
  const result = await parse(await fixture({ body, styles }));
  assert.match(
    result.contentHtml,
    /<h1 style="text-align:center"><em><strong>Contrato<\/strong><\/em><\/h1>/
  );
  assert.match(result.contentHtml, /data-docubox-page-break="true"/);
  assert.equal(result.stats.pageBreaks, 1);
});

test('case 3: imports ordered and unordered lists', async () => {
  const numbering = `<w:numbering ${namespaces}>
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
    <w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="20"><w:abstractNumId w:val="2"/></w:num>
  </w:numbering>`;
  const item = (id, text) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const result = await parse(
    await fixture({ body: `${item(10, 'Uno')}${item(10, 'Dos')}${item(20, 'Punto')}`, numbering })
  );
  assert.match(result.contentHtml, /<ol[^>]*><li>.*Uno.*<\/li><li>.*Dos.*<\/li><\/ol>/s);
  assert.match(result.contentHtml, /<ul[^>]*><li>.*Punto.*<\/li><\/ul>/s);
});

test('case 4: imports normal tables', async () => {
  const body =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Concepto</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Monto</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const result = await parse(await fixture({ body }));
  assert.match(result.contentHtml, /<table[^>]*>.*<td[^>]*>.*Concepto.*<\/td>.*Monto.*<\/table>/s);
  assert.equal(result.stats.tables, 1);
});

test('case 5: embeds supported images without public URLs', async () => {
  const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
  const body =
    '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr name="Logo" descr="Logotipo"/><a:graphic><a:graphicData><a:blip r:embed="rIdImage"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const result = await parse(
    await fixture({ body, relationships, files: { 'word/media/image1.png': png } })
  );
  assert.match(result.contentHtml, /src="data:image\/png;base64,/);
  assert.doesNotMatch(result.contentHtml, /https?:\/\//);
  assert.equal(result.stats.images, 1);
});

test('case 6: maps Word variables to existing editor fields', async () => {
  const body =
    '<w:p><w:r><w:t>Cliente: {{cliente}}, RFC: {{rfc}}, Monto: {{monto}}</w:t></w:r></w:p>';
  const result = await parse(await fixture({ body }));
  assert.deepEqual(
    result.fields.map((field) => field.label),
    ['cliente', 'rfc', 'monto']
  );
  assert.equal((result.contentHtml.match(/data-field-id=/g) || []).length, 3);
});

test('case 7: detects a variable fragmented across Word runs', async () => {
  const body =
    '<w:p><w:r><w:t>{{cli</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ente}}</w:t></w:r></w:p>';
  const result = await parse(await fixture({ body }));
  assert.deepEqual(
    result.fields.map((field) => field.label),
    ['cliente']
  );
  assert.match(result.contentHtml, /data-field-label="cliente"/);
});

test('case 8: rejects a DOCX with corrupt XML', async () => {
  const bytes = await fixture({
    body: '',
    rawDocument: `<w:document ${namespaces}><w:body><w:p></w:body></w:document>`,
  });
  await assert.rejects(
    () => parse(bytes),
    (error) => error instanceof TemplateDocxImportError && error.code === 'CORRUPTED_DOCX'
  );
});

test('case 9: rejects a non-DOCX file renamed as docx', async () => {
  await assert.rejects(
    () => parse(new TextEncoder().encode('not a zip')),
    (error) => error instanceof TemplateDocxImportError && error.code === 'INVALID_DOCX'
  );
});

test('case 10: unsupported active or embedded content is ignored with warnings', async () => {
  const bytes = await fixture({
    body: '<w:p><w:r><w:t>Texto seguro</w:t></w:r><w:object/></w:p>',
    files: {
      'word/embeddings/object1.bin': Buffer.from('ignored'),
      'word/vbaProject.bin': Buffer.from('ignored'),
    },
  });
  const result = await parse(bytes);
  assert.match(result.contentHtml, /Texto seguro/);
  assert.ok(result.warnings.includes('ACTIVE_CONTENT_IGNORED'));
  assert.ok(result.warnings.includes('EMBEDDED_OBJECT_IGNORED'));
});

test('case 11: handles a relatively large business document', async () => {
  const body = Array.from(
    { length: 1200 },
    (_, index) =>
      `<w:p><w:r><w:t>Cláusula ${index + 1}: contenido contractual editable.</w:t></w:r></w:p>`
  ).join('');
  const result = await parse(await fixture({ body }), 'contrato-extenso.docx');
  assert.equal(result.stats.paragraphs, 1200);
  assert.match(result.contentHtml, /Cláusula 1200/);
});

test('case 12: import API and preload remain bound to the active workspace', async () => {
  const route = await readFile(
    path.join(root, 'src/app/api/plantillas/import-docx/route.ts'),
    'utf8'
  );
  const page = await readFile(path.join(root, 'src/app/plantillas/nueva/page.tsx'), 'utf8');
  const paginator = await readFile(
    path.join(root, 'src/app/plantillas/components/DocumentPaginator.tsx'),
    'utf8'
  );
  const parser = await readFile(path.join(root, 'src/lib/template-import/docx/parser.ts'), 'utf8');
  assert.match(route, /resolveTemplatePublicationContext\(request, workspaceId\)/);
  assert.match(page, /import-docx\?workspace_id=\$\{encodeURIComponent\(activeWorkspaceId\)\}/);
  assert.match(page, /imported\.workspaceId !== activeWorkspace\.id/);
  assert.match(page, /setCurrentHtml\(normalizeTemplateHtml\(imported\.contentHtml\)\)/);
  assert.match(paginator, /hasAttribute\('data-docubox-page-break'\)/);
  assert.doesNotMatch(parser, /CloudConvert|LucIA|OpenAI/);
});

test('imports headers, footers and safe hyperlinks as editable content', async () => {
  const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://docubox.com/terminos" TargetMode="External"/></Relationships>`;
  const body =
    '<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>Términos</w:t></w:r></w:hyperlink></w:p>';
  const files = {
    'word/header1.xml': `<w:hdr ${namespaces}><w:p><w:r><w:t>Encabezado contractual</w:t></w:r></w:p></w:hdr>`,
    'word/footer1.xml': `<w:ftr ${namespaces}><w:p><w:r><w:t>Pie legal</w:t></w:r></w:p></w:ftr>`,
  };
  const result = await parse(await fixture({ body, relationships, files }));
  assert.match(result.contentHtml, /data-docubox-imported-header="true"/);
  assert.match(result.contentHtml, /data-docubox-imported-footer="true"/);
  assert.match(result.contentHtml, /href="https:\/\/docubox\.com\/terminos"/);
});

test('API validates MIME, extension, size and ZIP signature without creating a template', async () => {
  const route = await readFile(
    path.join(root, 'src/app/api/plantillas/import-docx/route.ts'),
    'utf8'
  );
  const parser = await readFile(path.join(root, 'src/lib/template-import/docx/parser.ts'), 'utf8');
  assert.match(route, /ACCEPTED_MIME_TYPES/);
  assert.match(route, /endsWith\('\.docx'\)/);
  assert.match(route, /MAX_FILE_BYTES/);
  assert.match(route, /hasZipSignature\(bytes\)/);
  assert.match(route, /'IMPORT_FAILED'/);
  assert.match(parser, /'ASSET_EXTRACTION_FAILED'/);
  assert.doesNotMatch(route, /from\('plantillas'\)\.insert/);
});

test('new template step one exposes Word import and blank-template origins', async () => {
  const page = await readFile(path.join(root, 'src/app/plantillas/nueva/page.tsx'), 'utf8');

  assert.match(page, /¿Cómo quieres comenzar\?/);
  assert.match(page, />Importar Word</);
  assert.match(page, />Crear desde cero</);
  assert.match(page, /onDrop=\{handleDocxDrop\}/);
  assert.match(
    page,
    /accept="application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document,\.docx"/
  );
  assert.match(page, /\/api\/plantillas\/import-docx\?workspace_id=/);
  assert.match(page, /applyImportedTemplate\(result, false\)/);
  assert.match(page, /showOriginChoice && !templateOrigin/);
  assert.match(page, /showOriginChoice && templateOrigin/);
  assert.match(page, /Origen seleccionado/);
  assert.match(page, /Cambiar origen/);
  assert.match(page, /!templateId && !templateOrigin/);
  assert.match(page, /templateOrigin === 'scratch' \|\| Boolean\(importedDocxName\)/);
  assert.match(page, /templateOrigin === 'word' && !importedDocx/);
});
