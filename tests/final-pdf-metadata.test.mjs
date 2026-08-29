import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  applyFinalPdfMetadata,
  hashFinalPdfMetadata,
} from '../src/lib/documents/final-pdf-metadata.ts';

const routePath = new URL(
  '../src/app/api/documentos/[documentId]/seal-signatures/route.ts',
  import.meta.url,
);

const metadata = {
  documentId: '11111111-1111-4111-8111-111111111111',
  documentFolio: 'DBX-2026-ABC123',
  tenantId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  documentVersion: 3,
  title: 'Contrato de prueba',
  documentType: 'Contrato',
  originalSha256: 'a'.repeat(64),
  createdAt: '2026-08-26T12:00:00.000Z',
  completedAt: '2026-08-26T12:30:00.000Z',
  creatorId: '33333333-3333-4333-8333-333333333333',
  creatorName: 'Usuario Docubox',
  signatureMethods: ['autografa', 'efirma'],
  participantCount: 2,
  status: 'completado',
  workflow: 'secuencial',
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
  evidenceChainSha256: 'b'.repeat(64),
  identityVerificationStatus: 'verified',
  assuranceLevel: 'standard',
  additionalDocumentMetadata: [{
    name: 'Numero de contrato',
    dataType: 'text',
    value: 'CONT-2026-00182',
    snapshotHash: 'c'.repeat(64),
  }],
};

test('final PDF embeds Docubox technical metadata in PDF Info and XMP', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const result = applyFinalPdfMetadata(pdf, metadata);
  const bytes = await pdf.save({ useObjectStreams: false });
  const loaded = await PDFDocument.load(bytes);
  const source = Buffer.from(bytes).toString('utf8');

  assert.equal(loaded.getTitle(), metadata.title);
  assert.equal(loaded.getAuthor(), metadata.creatorName);
  assert.match(loaded.getKeywords() || '', /DBX-2026-ABC123/);
  assert.equal(result.snapshotSha256, hashFinalPdfMetadata(metadata));
  assert.match(source, /<dbx:documentId>11111111-1111-4111-8111-111111111111<\/dbx:documentId>/);
  assert.match(source, /<dbx:originalSHA256>a{64}<\/dbx:originalSHA256>/);
  assert.match(source, /CONT-2026-00182/);
  assert.doesNotMatch(source, /finalSHA256|sealedSHA256/);
});

test('final PDF hash is calculated after metadata is embedded and recorded in audit', async () => {
  const source = await readFile(routePath, 'utf8');
  const integrationSource = await readFile(
    new URL('../src/lib/certification/product-integration.ts', import.meta.url),
    'utf8',
  );
  const metadataPosition = source.indexOf('technicalMetadata,');
  const visualHashPosition = source.indexOf('visualPdfSha256 = rendered.sha256');

  assert.ok(metadataPosition >= 0);
  assert.ok(visualHashPosition > metadataPosition);
  assert.match(source, /technical_metadata_snapshot: technicalMetadata/);
  assert.match(source, /technical_metadata_snapshot_sha256: metadataSnapshotSha256/);
  assert.match(source, /visual_pdf_sha256: visualPdfSha256/);
  assert.match(source, /sealed_sha256: pades\.sha256/);
  assert.match(integrationSource, /sealed_pdf_hash: certifiedSha256/);
});

test('metadata snapshot hash changes when a document-bound value changes', () => {
  const changed = {
    ...metadata,
    additionalDocumentMetadata: [{
      ...metadata.additionalDocumentMetadata[0],
      value: 'CONT-2026-00999',
    }],
  };

  assert.notEqual(hashFinalPdfMetadata(metadata), hashFinalPdfMetadata(changed));
  assert.match(createHash('sha256').update(JSON.stringify(metadata)).digest('hex'), /^[a-f0-9]{64}$/);
});
