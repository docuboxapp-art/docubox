import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';

const styles = [
  'AC0', 'AC1', 'AC2', 'AC3', 'AC4', 'AC5',
  'AM1', 'AM2', 'AM3', 'AM4', 'AM5',
  'AL1', 'AL2', 'AL3', 'AL4',
];
const buildDirectory = await mkdtemp(path.join(tmpdir(), 'docubox-autograph-pdf-'));
await build({
  entryPoints: ['src/lib/signatures/pdf-stamp.ts'],
  outfile: path.join(buildDirectory, 'pdf-stamp.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  tsconfig: 'tsconfig.json',
});
const require = createRequire(import.meta.url);
const { createSignedDocumentPdf } = require(path.join(buildDirectory, 'pdf-stamp.cjs'));
after(async () => rm(buildDirectory, { recursive: true, force: true }));
const signaturePng = await sharp(
  Buffer.from('<svg width="240" height="80" xmlns="http://www.w3.org/2000/svg"><path d="M12 62 Q48 5 72 48 T138 36 Q178 4 190 40 T230 35" fill="none" stroke="#1e293b" stroke-width="3"/></svg>')
).png().toBuffer();

test('all autograph stamp styles render into the final PDF', async (t) => {
  const original = await PDFDocument.create();
  for (const style of styles) {
    const page = original.addPage([500, 230]);
    page.drawText(style, { x: 25, y: 205, size: 12 });
  }
  const originalBytes = await original.save();
  const responses = styles.map((style, index) => ({
    participante_id: `participant-${index}`,
    participante_nombre: 'LUIS ALBERTO HERNANDEZ BELTRAN',
    firma_data: `data:image/png;base64,${signaturePng.toString('base64')}`,
    firma_completada_at: '2026-09-22T21:00:00.000Z',
    signature_method: 'autografa',
    signature_stamp_style: style,
    signature_hash: 'a3f2e9b4c6d1f8e2a9c7d4b5e1f6a3c8d9e0f2a7b4c6d8e1f0a3c9d2e5f6a1b',
    signature_metadata: {
      participant_role: 'Proveedor',
      participant_act: 'Firmante',
      participant_capacity: 'Representante legal',
      authentication_status: 'OTP verificado',
      verification_url: 'https://docubox.mx/verificar-firma/test',
    },
  }));
  const fields = styles.map((style, index) => ({
    participantId: `participant-${index}`,
    tipo: 'firma',
    page: index + 1,
    x: 5,
    y: 20,
    width: style.startsWith('AL') ? 60 : style.startsWith('AM') ? 44 : 32,
    height: style.startsWith('AL') ? 65 : style.startsWith('AM') ? 46 : 30,
  }));
  const technicalMetadata = {
    documentId: '11111111-1111-4111-8111-111111111111',
    documentFolio: 'DBX-2026-STAMP-TEST',
    tenantId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    documentVersion: 1,
    title: 'Autograph stamp render test',
    documentType: 'Test',
    originalSha256: 'a'.repeat(64),
    createdAt: '2026-09-22T20:00:00.000Z',
    completedAt: '2026-09-22T21:00:00.000Z',
    creatorId: '33333333-3333-4333-8333-333333333333',
    creatorName: 'Docubox Test',
    signatureMethods: ['autografa'],
    participantCount: styles.length,
    status: 'completado',
    workflow: 'paralelo',
    caseFileId: null,
    templateId: null,
    formId: null,
    nom151Status: 'not_issued_at_pdf_closure',
    certificationStatus: 'not_started_at_pdf_closure',
    pdfSignatureStatus: 'not_configured_at_pdf_closure',
    certificateStatus: 'not_configured_at_pdf_closure',
    padesProfile: null,
    timestampStatus: 'not_issued_at_pdf_closure',
    tsaProvider: null,
    evidenceChainSha256: null,
    identityVerificationStatus: 'verified',
    assuranceLevel: 'standard',
    additionalDocumentMetadata: [],
  };
  const result = await createSignedDocumentPdf({
    originalBytes,
    fields,
    responses,
    technicalMetadata,
  });
  assert.equal(result.stampsApplied, styles.length);
  assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), styles.length);
  if (process.env.DOCUBOX_STAMP_PREVIEW_OUTPUT) {
    await writeFile(process.env.DOCUBOX_STAMP_PREVIEW_OUTPUT, result.bytes);
  }

  const sample = await PDFDocument.create();
  sample.addPage().drawText('Documento original de prueba');
  const sampleBytes = await sample.save();
  const signers = [
    ['Alma Ejemplo', 'autografa'],
    ['Bruno Ejemplo', 'efirma'],
    ['Carmen Ejemplo', 'clicksign'],
    ['Diego Ejemplo', 'clicksign'],
  ].map(([name, method], index) => ({
    participante_id: `account-${index}`,
    participant_record_id: `invitation-${index}`,
    participante_nombre: name,
    participante_email: `firmante${index + 1}@example.test`,
    firma_completada_at: '2026-11-26T14:15:10.000Z',
    firma_data: method === 'autografa' ? `data:image/png;base64,${signaturePng.toString('base64')}` : null,
    consent_accepted: index !== 3,
    consent_accepted_at: index !== 3 ? '2026-11-26T14:14:33.000Z' : null,
    signature_method: method,
    signature_stamp_style: ['AC4', 'EM4', 'CC2', 'CL3'][index],
    signature_hash: 'a12b3456789cd'.repeat(5).slice(0, 64),
    signature_metadata: method === 'efirma'
      ? { certificate_serial: '00000000000000000001', certificate_valid_until: '2028-11-26T14:15:10.000Z', ocsp_status: 'Válido' }
      : method === 'autografa' ? { otp_verified: true } : {},
  }));
  const sampleMetadata = { ...technicalMetadata, title: 'Convenio de prueba', participantCount: signers.length };
  const renderSample = (overrides) => createSignedDocumentPdf({
    originalBytes: sampleBytes,
    fields: [],
    responses: signers,
    technicalMetadata: sampleMetadata,
    allowSignersSheet: true,
    verificationUrl: 'https://docubox.mx/v/example',
    ...overrides,
  });

  await t.test('appends one or more pages when signers have no signature placements', async () => {
    const sheet = await renderSample({});
    assert.equal(sheet.stampsApplied, 0);
    assert.equal(sheet.signaturesApplied, 4);
    assert.equal(sheet.signatureSheetPages, 2);
    const pdf = await PDFDocument.load(sheet.bytes);
    assert.equal(pdf.getPageCount(), 3);
    const signatureImages = (pageIndex) =>
      pdf.getPage(pageIndex).node.Resources().lookup(PDFName.of('XObject'), PDFDict).keys().length;
    // Header uses two images. The additional images come from the autograph
    // trace and the configured QR-bearing stamps on both appendix pages.
    assert.ok(signatureImages(1) >= 4);
    assert.ok(signatureImages(2) >= 4);
    if (process.env.DOCUBOX_SIGNERS_PREVIEW_OUTPUT) {
      await writeFile(process.env.DOCUBOX_SIGNERS_PREVIEW_OUTPUT, sheet.bytes);
    }
  });

  await t.test('keeps existing placements when other signers need the sheet', async () => {
    const sheet = await renderSample({
      fields: [{ ...fields[0], participantId: 'invitation-0' }],
      responses: signers.slice(0, 2),
    });
    assert.equal(sheet.stampsApplied, 1);
    assert.equal(sheet.signaturesApplied, 2);
    assert.equal(sheet.signatureSheetPages, 1);
    assert.equal((await PDFDocument.load(sheet.bytes)).getPageCount(), 2);
  });

  await t.test('honors a placement saved by the signer and never stamps an invalid page', async () => {
    const position = { page: 1, x: 5, y: 20, width: 36, height: 20 };
    const sheet = await renderSample({
      fields: [{ ...fields[0], participantId: 'invitation-0', page: 99 }],
      responses: [{
        ...signers[0],
        signature_metadata: { signature_positions: [position, { ...position, page: 9 }] },
      }],
    });
    assert.equal(sheet.stampsApplied, 1);
    assert.equal(sheet.signaturesApplied, 1);
    assert.equal(sheet.signatureSheetPages, 0);
    assert.equal((await PDFDocument.load(sheet.bytes)).getPageCount(), 1);
  });

  await t.test('omits fallback sheets in published forms', async () => {
    const sheet = await renderSample({ allowSignersSheet: false });
    assert.equal(sheet.signaturesApplied, 0);
    assert.equal(sheet.signatureSheetPages, 0);
  });
});
