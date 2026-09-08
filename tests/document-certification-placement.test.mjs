import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const buildDirectory = await mkdtemp(path.join(tmpdir(), 'docubox-certification-test-'));
await build({
  entryPoints: {
    'document-chain': 'src/lib/certification/document-chain.ts',
    'certification-pdf': 'src/lib/certification/pdf.ts',
  },
  outdir: buildDirectory,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  tsconfig: 'tsconfig.json',
});

const require = createRequire(import.meta.url);
const chainModule = require(path.join(buildDirectory, 'document-chain.cjs'));
const pdfModule = require(path.join(buildDirectory, 'certification-pdf.cjs'));
const adjustmentSource = await readFile(
  'src/app/crear-documento/components/StepAjustes.tsx',
  'utf8'
);
const createDocumentSource = await readFile('src/app/crear-documento/page.tsx', 'utf8');
const engineSource = await readFile('src/lib/certification/engine.ts', 'utf8');
const sendRouteSource = await readFile('src/app/api/documentos/enviar/route.ts', 'utf8');

after(async () => {
  await rm(buildDirectory, { recursive: true, force: true });
});

const chainInput = {
  documentUuid: '8f2c1a63-3a55-4c0e-a7f8-95e2b52f5b71',
  folio: 'DBX-2026-000018547',
  documentVersion: 4,
  documentSha256: '5d4f2cb9ef9878d31d0d5b43e2a99879d3b3cf3fbc7cbeb0a6a5d5efb8cbfa29',
  evidenceManifestSha256: '299944bb892bb51ee9d4db1285e2b6087e1749720c40ff17a96b4bfb85d28127',
  closedAtUtc: '2026-09-07T22:14:03Z',
};

test('builds the exact functional Docubox UTF-8 chain and its SHA-256 digest', () => {
  const result = chainModule.buildDocuboxDocumentChain(chainInput);
  const expected =
    '||DBX|1.0|8F2C1A63-3A55-4C0E-A7F8-95E2B52F5B71|DBX-2026-000018547|4|' +
    '5D4F2CB9EF9878D31D0D5B43E2A99879D3B3CF3FBC7CBEB0A6A5D5EFB8CBFA29|' +
    '299944BB892BB51EE9D4DB1285E2B6087E1749720C40FF17A96B4BFB85D28127|' +
    '2026-09-07T22:14:03.000Z||';

  assert.equal(result.text, expected);
  assert.deepEqual(result.bytes, Buffer.from(expected, 'utf8'));
  assert.equal(result.sha256, createHash('sha256').update(expected, 'utf8').digest('hex'));
  assert.equal(chainModule.serializeDocuboxDocumentChain(result.payload), expected);
});

test('rejects ambiguous values containing the chain separator', () => {
  assert.throws(
    () => chainModule.buildDocuboxDocumentChain({ ...chainInput, folio: 'DBX|ALTERADO' }),
    /separadores de cadena/
  );
});

test('free placement requires at least one original chain or document seal', () => {
  const availableFields = adjustmentSource.slice(
    adjustmentSource.indexOf('const cryptographicFields'),
    adjustmentSource.indexOf('const getCryptographicDimensions')
  );
  assert.match(adjustmentSource, /Cadena original y sello digital/);
  assert.match(availableFields, /type: 'document_chain'/);
  assert.match(availableFields, /type: 'document_seal'/);
  assert.doesNotMatch(availableFields, /type: 'timestamp'|type: 'evidence_chain'/);
  assert.match(createDocumentSource, /hasVisibleCertificationField/);
  assert.doesNotMatch(createDocumentSource, /new Set\(\['document_chain', 'document_seal'\]\)/);
});

test('the certification engine signs the exact chain bytes and routes the selected placement', () => {
  assert.match(engineSource, /canonicalBytes: documentChain\.bytes/);
  assert.match(engineSource, /document\.sello_ubicacion === 'libre'/);
  assert.match(engineSource, /applyCryptographicPlacementAtFoot/);
  assert.doesNotMatch(engineSource, /appendCertificatePages\(/);
  assert.match(engineSource, /serializeDocuboxDocumentChain/);
  assert.match(sendRouteSource, /VISIBLE_CERTIFICATION_FIELD_REQUIRED/);
  assert.match(sendRouteSource, /type === 'document_chain' \|\| type === 'document_seal'/);
  assert.match(engineSource, /estampa_autenticacion/);
  assert.ok(
    engineSource.indexOf('await applyDocumentVerificationStamp')
      < engineSource.indexOf('providers.pdfSignature.preparePdf'),
    'La estampa visible debe integrarse antes de la firma PAdES.'
  );
});

test('the final free-placement output omits editor reference titles and fits the selected rectangle', async () => {
  assert.match(
    await readFile('src/lib/certification/pdf.ts', 'utf8'),
    /drawCryptographicPlacementBlock\([\s\S]*?\}, false\);/
  );
  assert.match(
    await readFile('src/lib/certification/pdf.ts', 'utf8'),
    /while \(lines\.length \* lineHeight > availableHeight && bodySize > 2\.4\)/
  );
});

const placementData = {
  documentUuid: chainInput.documentUuid,
  certifiedAt: chainInput.closedAtUtc,
  documentChainDisplay: chainModule.buildDocuboxDocumentChain(chainInput).text,
  documentChainSha256: 'a'.repeat(64),
  documentSealBase64: Buffer.alloc(384, 7).toString('base64'),
  documentSealSha256: 'b'.repeat(64),
  documentSealAlgorithm: 'RSA-PSS-SHA256',
  documentSealStatus: 'VALID',
  documentKeySizeBits: 3072,
  documentKeyVersion: 'DOCUBOX-DOCUMENT-KEY-V3',
  evidenceChainDisplay: '||DOCUBOX_EVIDENCE|1.0||',
};

async function createSourcePdf(withContent, pageCount = 1, contentY = 80) {
  const pdf = await PDFDocument.create();
  const font = withContent ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  for (let index = 0; index < pageCount; index += 1) {
    const page = pdf.addPage([612, 792]);
    if (font) {
      page.drawText(`Contenido original de la página ${index + 1}`, { x: 50, y: contentY, font, size: 12 });
    }
  }
  return pdf.save({ useObjectStreams: false });
}

test('adds a discrete verification band on each page and the completed stamp only on the final page', async () => {
  const verificationStampSource = await readFile('src/lib/certification/pdf.ts', 'utf8');
  const result = await pdfModule.applyDocumentVerificationStamp(
    await createSourcePdf(true, 2),
    {
      documentUuid: chainInput.documentUuid,
      verificationUrl: 'https://app.docubox.com.mx/verificar-certificacion/8f2c1a63-3a55-4c0e-a7f8-95e2b52f5b71',
      completedAt: chainInput.closedAtUtc,
    },
  );
  const stamped = await PDFDocument.load(result);

  assert.equal(stamped.getPageCount(), 2);
  assert.equal(stamped.getPage(0).getHeight(), 792, 'La primera página conserva el tamaño original.');
  assert.equal(stamped.getPage(1).getHeight(), 792, 'La última página conserva el tamaño original.');
  assert.match(verificationStampSource, /`Completado el: \$\{completion\}`/);
  assert.match(
    verificationStampSource,
    /`Verificar la integridad de este documento: \$\{verificationUrl\}`/
  );
});

test('does not claim a completed signature or add a QR before the workflow is completed', async () => {
  const result = await pdfModule.applyDocumentVerificationStamp(
    await createSourcePdf(true),
    {
      documentUuid: chainInput.documentUuid,
      verificationUrl: 'https://app.docubox.com.mx/verificar-certificacion/8f2c1a63-3a55-4c0e-a7f8-95e2b52f5b71',
      completedAt: null,
    },
  );
  const stamped = await PDFDocument.load(result);

  assert.equal(stamped.getPage(0).getHeight(), 792);
});

test('uses an empty final page for the foot placement', async () => {
  const result = await pdfModule.applyCryptographicPlacementAtFoot(
    await createSourcePdf(false),
    placementData
  );
  assert.equal((await PDFDocument.load(result)).getPageCount(), 1);
});

test('adds a page when the final page contains drawing commands', async () => {
  const result = await pdfModule.applyCryptographicPlacementAtFoot(
    await createSourcePdf(true),
    placementData
  );
  assert.equal((await PDFDocument.load(result)).getPageCount(), 2);
});

test('uses the blank foot area when the final page content remains above it', async () => {
  const result = await pdfModule.applyCryptographicPlacementAtFoot(
    await createSourcePdf(true, 1, 650),
    placementData
  );
  assert.equal((await PDFDocument.load(result)).getPageCount(), 1);
});

test('anchors the block at the foot or at the top of a new page as needed', async () => {
  const pdfSource = await readFile('src/lib/certification/pdf.ts', 'utf8');
  assert.match(pdfSource, /const bottomMargin = Math\.max\(12, height \* 0\.018\)/);
  assert.match(
    pdfSource,
    /let y = usesLastPage \? bottomMargin \+ requiredHeight : height - topMargin/
  );
});
