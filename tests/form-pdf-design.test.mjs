import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { build } from 'esbuild';

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

async function generateFixture({ pageSize = 'a4', orientation = 'portrait', coverPage = false, columns = 'one', flags = {}, responseData = {}, fieldPageBreak = false, fieldCount = 12, legalContent, declarationContent, includeSignature = false, requireSignature = false, returnLayout = false } = {}) {
  let handler;
  let savedBytes;
  let savedLayout;
  const fields = Array.from({ length: fieldCount }, (_, index) => ({
    id: `field-${index}`, sectionId: 'section-general', label: `Campo ${index + 1}`,
    type: index === 5 ? 'textarea' : 'text',
  }));
  fields.push({ id: 'email', sectionId: 'section-general', label: 'Correo', type: 'email' });
  fields.push({ id: 'consent', sectionId: 'section-general', label: 'Autorizo el uso de datos', type: 'consentimiento' });
  if (legalContent) Object.assign(fields.at(-1), legalContent);
  if (declarationContent) fields.push({ id: 'declaration', sectionId: 'section-general', label: 'Declaración', type: 'declaration', ...declarationContent });
  fields.push({ id: 'attachment', sectionId: 'section-general', label: 'Anexo', type: 'documento' });
  if (includeSignature) fields.push({ id: 'signature', sectionId: 'section-general', label: 'Firma', type: 'signature_block' });
  if (fieldPageBreak) fields[1].pdf = { pageBreakBefore: true };
  const row = {
    workspace_id: 'fixture',
    submitted_at: '2026-10-08T12:00:00Z', ip_address: '192.0.2.3',
    response_data: { 'field-0': 'Respuesta de prueba', ...responseData },
    form_templates: {
      id: 'fixture', name: 'Formulario de muestra', description: 'Descripción visible en el PDF',
      form_schema: { fields, sections: [{ id: 'section-general', title: 'Datos generales' }] },
      pdf_schema: {
        pageSize, orientation, coverPage, columns, margins: 'normal',
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
      from: () => ({ upload: async (path, bytes) => {
        if (path.endsWith('.pdf')) savedBytes = bytes;
        if (path.endsWith('.signature-layout.json')) savedLayout = JSON.parse(new TextDecoder().decode(bytes));
        return {};
      } }),
    },
  };
  const dependencies = {
    serve: (callback) => { handler = callback; },
    createClient: () => client,
    ...pdfLib,
    requiresFormSignature: () => requireSignature,
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
  const pdf = await pdfLib.PDFDocument.load(savedBytes);
  return returnLayout ? { pdf, layout: savedLayout, bytes: savedBytes } : pdf;
}

test('la firma pendiente permanece en el PDF y entrega una posición vinculada a su hash', async () => {
  const { pdf, layout, bytes } = await generateFixture({
    includeSignature: true, requireSignature: true, returnLayout: true,
    flags: { showUnanswered: false },
  });
  assert.equal(layout.pdfSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(layout.placements.length, 1);
  const placement = layout.placements[0];
  assert.equal(placement.id, 'signature');
  assert.ok(placement.page >= 1 && placement.page <= pdf.getPageCount());
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(placement[key] > 0 && placement[key] < 100);
  assert.ok(placement.x + placement.width <= 100);
  assert.ok(placement.y + placement.height <= 100);
});

test('un formulario firmable conserva un espacio de firma aunque su sección no aparezca en el PDF', async () => {
  const { layout } = await generateFixture({ requireSignature: true, returnLayout: true });
  assert.equal(layout.placements.length, 1);
  assert.equal(layout.placements[0].label, 'Firma');
});

test('la posición del formulario recibe la estampa elegida y el QR cuando el diseño lo incluye', async () => {
  const { bytes, layout } = await generateFixture({
    includeSignature: true, requireSignature: true, returnLayout: true,
    flags: { showUnanswered: false, showQr: false },
  });
  const buildDirectory = await mkdtemp(path.join(tmpdir(), 'docubox-form-stamp-'));
  try {
    const outfile = path.join(buildDirectory, 'pdf-stamp.cjs');
    await build({
      entryPoints: ['src/lib/signatures/pdf-stamp.ts'], outfile, bundle: true,
      platform: 'node', format: 'cjs', tsconfig: 'tsconfig.json',
    });
    const { createSignedDocumentPdf } = require(outfile);
    const field = {
      ...layout.placements[0], tipo: 'firma', participantId: 'firmante@example.com',
    };
    const technicalMetadata = {
        documentId: '11111111-1111-4111-8111-111111111111',
        documentFolio: 'FORM-2026-TEST', tenantId: '22222222-2222-4222-8222-222222222222',
        workspaceId: '22222222-2222-4222-8222-222222222222', documentVersion: 1,
        title: 'Formulario de prueba', documentType: 'Formulario', originalSha256: createHash('sha256').update(bytes).digest('hex'),
        createdAt: '2026-10-09T11:00:00Z', completedAt: '2026-10-09T12:00:00Z',
        creatorId: '33333333-3333-4333-8333-333333333333', creatorName: 'Docubox',
        signatureMethods: ['clicksign'], participantCount: 1, status: 'completado',
        workflow: 'paralelo', caseFileId: null, templateId: null, formId: null,
        nom151Status: 'not_issued_at_pdf_closure', certificationStatus: 'not_started_at_pdf_closure',
        pdfSignatureStatus: 'not_configured_at_pdf_closure', certificateStatus: 'not_configured_at_pdf_closure',
        padesProfile: null, timestampStatus: 'not_issued_at_pdf_closure', tsaProvider: null,
        evidenceChainSha256: null, identityVerificationStatus: 'not_required',
        assuranceLevel: 'standard', additionalDocumentMetadata: [],
    };
    for (const [signature_method, signature_stamp_style] of [
      ['clicksign', 'CC2'], ['autografa', 'AC1'], ['autografa', 'AC3'], ['efirma', 'EC2'],
    ]) {
      const result = await createSignedDocumentPdf({
        originalBytes: bytes,
        fields: [field],
        responses: [{
          participante_id: 'participant-1', participante_email: 'firmante@example.com',
          participante_nombre: 'Firmante de prueba', firma_completada_at: '2026-10-09T12:00:00Z',
          signature_method, signature_stamp_style, signature_hash: 'a'.repeat(64),
          signature_metadata: { verification_url: 'https://docubox.mx/v/documento-prueba' },
        }],
        technicalMetadata: { ...technicalMetadata, signatureMethods: [signature_method] },
      });
      assert.equal(result.stampsApplied, 1, signature_stamp_style);
      const signed = await pdfLib.PDFDocument.load(result.bytes);
      const imageObjects = signed.context.enumerateIndirectObjects().filter(([, object]) =>
        object instanceof pdfLib.PDFRawStream && object.dict.get(pdfLib.PDFName.of('Subtype'))?.toString() === '/Image'
      );
      if (signature_stamp_style === 'AC1') {
        assert.equal(imageObjects.length, 0, 'AC1 es la estampa compacta sin QR ni imagen si no hay trazo');
      } else {
        assert.ok(imageObjects.length > 0, `La estampa ${signature_stamp_style} debe incrustar un QR real en el PDF`);
      }
    }
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }
});

test('el diseño del PDF respeta orientación, columnas y portada', async () => {
  const portrait = await generateFixture({ orientation: 'portrait', coverPage: false, columns: 'two' });
  const landscape = await generateFixture({ orientation: 'landscape', coverPage: true, columns: 'one' });
  assert.equal(portrait.getPages()[0].getWidth(), 595.28);
  assert.equal(portrait.getPages()[0].getHeight(), 841.89);
  assert.equal(landscape.getPages()[0].getWidth(), 841.89);
  assert.equal(landscape.getPages()[0].getHeight(), 595.28);
  assert.ok(landscape.getPageCount() > portrait.getPageCount());
});

test('el PDF generado usa las dimensiones de cada tamaño de hoja en ambas orientaciones', async () => {
  const sizes = {
    letter: [612, 792], oficio: [612, 936], legal: [612, 1008],
    tabloid: [792, 1224], a5: [419.53, 595.28],
    a4: [595.28, 841.89], a3: [841.89, 1190.55],
  };
  for (const [pageSize, [width, height]] of Object.entries(sizes)) {
    for (const orientation of ['portrait', 'landscape']) {
      const pdf = await generateFixture({ pageSize, orientation, fieldCount: 2 });
      const page = pdf.getPages()[0];
      assert.equal(page.getWidth(), orientation === 'portrait' ? width : height, pageSize);
      assert.equal(page.getHeight(), orientation === 'portrait' ? height : width, pageSize);
    }
  }
});

test('las hojas opcionales y los anexos modifican el PDF generado', async () => {
  const base = await generateFixture();
  const withConsent = await generateFixture({ flags: { consentPage: true } });
  const withHash = await generateFixture({ flags: { showHash: true } });
  const withAudit = await generateFixture({ flags: { showAuditTrail: true } });
  const withQr = await generateFixture({ flags: { showQr: true } });
  const baseForBreak = await generateFixture({ fieldCount: 2 });
  const withFieldBreak = await generateFixture({ fieldCount: 2, fieldPageBreak: true });
  assert.equal(withConsent.getPageCount(), base.getPageCount() + 1);
  assert.equal(withHash.getPageCount(), base.getPageCount() + 1);
  assert.equal(withAudit.getPageCount(), base.getPageCount() + 1);
  assert.equal(withQr.getPageCount(), base.getPageCount() + 1);
  assert.equal(withFieldBreak.getPageCount(), baseForBreak.getPageCount() + 1);
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

test('el PDF conserva el texto legal y la frase de aceptación configurados', async () => {
  const pdf = await generateFixture({
    legalContent: { description: 'Autorizo datos propios', acceptanceLabel: 'Acepto expresamente' },
    declarationContent: { description: 'Los datos son correctos', acceptanceLabel: 'Confirmo bajo protesta' },
    responseData: { consent: true, declaration: true },
  });
  const operators = contentOperators(pdf);
  assert.ok(operators.includes(encodedText('Autorizo datos propios')));
  assert.ok(operators.includes(encodedText('Acepto expresamente')));
  assert.ok(operators.includes(encodedText('Los datos son correctos')));
  assert.ok(operators.includes(encodedText('Confirmo bajo protesta')));
  assert.ok(operators.includes(encodedText('Sí, acepto')));
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
