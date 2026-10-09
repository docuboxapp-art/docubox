import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const pdfLib = require('pdf-lib');
const qrCode = require('qrcode');

function contentOperators(pdf) {
  return pdf.getPages().flatMap((page) => {
    const contents = page.node.Contents();
    const refs = contents instanceof pdfLib.PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.get(index)) : [contents];
    return refs.map((ref) => {
      const stream = pdf.context.lookup(ref);
      const compressed = stream.dict.get(pdfLib.PDFName.of('Filter'));
      const bytes = stream.getContents();
      return Buffer.from(compressed ? inflateSync(bytes) : bytes).toString('latin1');
    });
  }).join('\n');
}

function encodedText(value) {
  return Buffer.from(value, 'latin1').toString('hex').toUpperCase();
}

const source = readFileSync(new URL('../supabase/functions/generate-form-pdf/index.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const runtime = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll('globalThis.Deno', 'Deno');

async function generateFixture({ orientation = 'portrait', coverPage = false, columns = 'one', flags = {}, responseData = {}, fieldPageBreak = false } = {}) {
  let handler;
  let savedBytes;
  const fields = Array.from({ length: 12 }, (_, index) => ({
    id: `field-${index}`, sectionId: 'section-general', label: `Campo ${index + 1}`,
    type: index === 5 ? 'textarea' : 'text',
  }));
  fields.push({ id: 'email', sectionId: 'section-general', label: 'Correo', type: 'email' });
  fields.push({ id: 'consent', sectionId: 'section-general', label: 'Autorizo el uso de datos', type: 'consentimiento' });
  fields.push({ id: 'attachment', sectionId: 'section-general', label: 'Anexo', type: 'documento' });
  if (fieldPageBreak) fields[1].pdf = { pageBreakBefore: true };
  const row = {
    workspace_id: 'fixture',
    submitted_at: '2026-10-08T12:00:00Z', ip_address: '192.0.2.3',
    response_data: { 'field-0': 'Respuesta de prueba', ...responseData },
    form_templates: {
      id: 'fixture', name: 'Formulario de muestra', description: 'Descripción visible en el PDF',
      form_schema: { fields, sections: [{ id: 'section-general', title: 'Datos generales' }] },
      pdf_schema: {
        pageSize: 'a4', orientation, coverPage, columns, margins: 'normal',
        typography: 'serif', headerAlignment: 'center', showUnanswered: true,
        showEvidenceSheet: false, showQr: false, showHash: false,
        showAuditTrail: false, showRespondentEmail: false, showIp: false,
        showAttachments: false, consentPage: false, ...flags,
      },
      settings: {},
    },
  };
  const chain = {
    select() { return this; }, eq() { return this; }, order() { return this; }, insert() { return this; }, update() { return this; },
    single: async () => ({ data: row }),
    catch: async () => ({}),
    then(resolve) { return Promise.resolve({ data: [] }).then(resolve); },
  };
  const client = {
    from: () => Object.create(chain),
    storage: {
      createBucket: async () => ({}),
      from: () => ({ upload: async (_path, bytes) => { savedBytes = bytes; return {}; } }),
    },
  };
  const dependencies = {
    serve: (callback) => { handler = callback; },
    createClient: () => client,
    ...pdfLib,
    requiresFormSignature: () => false,
    QRCode: qrCode,
    Deno: { env: { get: (key) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'fixture-key' : 'http://localhost' } },
  };
  Function(...Object.keys(dependencies), runtime)(...Object.values(dependencies));
  const response = await handler(new Request('http://localhost', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-key' },
    body: JSON.stringify({ response_id: 'fixture-response' }),
  }));
  assert.equal(response.status, 200, await response.text());
  assert.ok(savedBytes);
  return pdfLib.PDFDocument.load(savedBytes);
}

test('el diseño del PDF respeta orientación, columnas y portada', async () => {
  const portrait = await generateFixture({ orientation: 'portrait', coverPage: false, columns: 'two' });
  const landscape = await generateFixture({ orientation: 'landscape', coverPage: true, columns: 'one' });
  assert.equal(portrait.getPages()[0].getWidth(), 595.28);
  assert.equal(portrait.getPages()[0].getHeight(), 841.89);
  assert.equal(landscape.getPages()[0].getWidth(), 841.89);
  assert.equal(landscape.getPages()[0].getHeight(), 595.28);
  assert.ok(landscape.getPageCount() > portrait.getPageCount());
});

test('las hojas opcionales y los anexos modifican el PDF generado', async () => {
  const base = await generateFixture();
  const withConsent = await generateFixture({ flags: { consentPage: true } });
  const withHash = await generateFixture({ flags: { showHash: true } });
  const withAudit = await generateFixture({ flags: { showAuditTrail: true } });
  const withQr = await generateFixture({ flags: { showQr: true } });
  const withFieldBreak = await generateFixture({ fieldPageBreak: true });
  assert.equal(withConsent.getPageCount(), base.getPageCount() + 1);
  assert.equal(withHash.getPageCount(), base.getPageCount() + 1);
  assert.equal(withAudit.getPageCount(), base.getPageCount() + 1);
  assert.equal(withQr.getPageCount(), base.getPageCount() + 1);
  assert.equal(withFieldBreak.getPageCount(), base.getPageCount() + 1);
  assert.ok(contentOperators(withHash).includes(encodedText('SHA-256 de respuestas')));
  assert.ok(contentOperators(withAudit).includes(encodedText('BITÁCORA')));
  const evidence = await generateFixture({ flags: { showEvidenceSheet: true, showFolio: false } });
  assert.ok(contentOperators(evidence).includes(encodedText('ID de respuesta')));
  assert.ok(!contentOperators(evidence).includes(encodedText('Folio:')));

  const attachmentData = `data:application/pdf;base64,${Buffer.from('adjunto de prueba').toString('base64')}`;
  const withAttachments = await generateFixture({ flags: { showAttachments: true }, responseData: { attachment: attachmentData } });
  assert.equal(withAttachments.getPageCount(), base.getPageCount() + 1);
  assert.ok(withAttachments.catalog.get(pdfLib.PDFName.of('Names')));
  const withoutAttachments = await generateFixture({ flags: { showAttachments: false }, responseData: { attachment: attachmentData } });
  assert.equal(withoutAttachments.catalog.get(pdfLib.PDFName.of('Names')), undefined);
});

test('encabezado, pie, fecha, folio y paginación obedecen la configuración', async () => {
  const visible = contentOperators(await generateFixture({ flags: {
    header: 'Encabezado personalizado', footer: 'Pie personalizado\nSegunda línea',
    showFolio: true, showDate: true, showPageNumbers: true,
  } }));
  const hidden = contentOperators(await generateFixture({ flags: {
    header: 'Encabezado personalizado', footer: 'Pie personalizado\nSegunda línea',
    showFolio: false, showDate: false, showPageNumbers: false,
  } }));
  assert.ok(visible.includes(encodedText('Encabezado personalizado')));
  assert.ok(visible.includes(encodedText('Pie personalizado')));
  assert.ok(visible.includes(encodedText('Segunda línea')));
  assert.ok(visible.includes(encodedText('Folio:')));
  assert.ok(visible.includes(encodedText('Fecha:')));
  assert.ok(visible.includes(encodedText('Página')));
  assert.ok(!hidden.includes(encodedText('Folio:')));
  assert.ok(!hidden.includes(encodedText('Fecha:')));
  assert.ok(!hidden.includes(encodedText('Página')));
});

test('correo e IP aparecen solo cuando sus opciones están activas', async () => {
  const hidden = contentOperators(await generateFixture({ responseData: { email: 'persona@ejemplo.com' } }));
  const shown = contentOperators(await generateFixture({
    flags: { showRespondentEmail: true, showIp: true },
    responseData: { email: 'persona@ejemplo.com' },
  }));
  assert.ok(shown.includes(encodedText('Correo del participante')));
  assert.ok(shown.includes(encodedText('192.0.2.3')));
  assert.ok(!hidden.includes(encodedText('Correo del participante')));
  assert.ok(!hidden.includes(encodedText('192.0.2.3')));
});
