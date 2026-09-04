import { createHash } from 'node:crypto';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import { applyFinalPdfMetadata, type FinalPdfTechnicalMetadata } from '@/lib/documents/final-pdf-metadata';
import { embedDocuboxPdfFonts, type DocuboxPdfFonts } from '@/lib/pdf/embedded-fonts';

export type SignatureStampResponse = {
  participante_id?: string | null;
  participante_email?: string | null;
  participante_nombre?: string | null;
  firma_data?: string | null;
  firma_completada_at?: string | null;
  signature_method?: string | null;
  signature_stamp_style?: string | null;
  signature_hash?: string | null;
  signature_ip?: string | null;
  signature_metadata?: Record<string, unknown> | null;
};

export type SignatureStampField = {
  participantId?: string | null;
  participantName?: string | null;
  page?: number | null;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  tipo?: string | null;
  label?: string | null;
};

const legacySignatureLabels = new Set([
  'firma',
  'firma digital',
  'firma electronica',
  'firma autografa',
]);

function normalizeSignatureLabel(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isSignatureStampField(field: SignatureStampField) {
  const type = String(field.tipo || '').trim().toLowerCase();
  if (type === 'firma') return true;

  // Historic fields did not always persist `tipo`. Only accept their exact
  // signature labels so regular fields such as "Nombre del firmante" cannot
  // create a visual signature stamp.
  return !type && legacySignatureLabels.has(normalizeSignatureLabel(field.label));
}

const blue = rgb(0.118, 0.42, 1);
const green = rgb(0.02, 0.58, 0.38);
const ink = rgb(0.08, 0.12, 0.2);
const muted = rgb(0.35, 0.4, 0.48);

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-MX', { timeZone: 'America/Chihuahua' });
}

function shortHash(value: string | null | undefined) {
  const hash = String(value || '').replace(/[^a-f0-9]/gi, '').toUpperCase();
  return hash ? `${hash.slice(0, 16)}...` : 'No disponible';
}

function responseMethod(response: SignatureStampResponse) {
  const method = normalize(response.signature_method);
  if (method === 'efirma' || method === 'autografa' || method === 'clicksign') return method;
  const style = String(response.signature_stamp_style || '').toUpperCase();
  if (style.startsWith('EC')) return 'efirma';
  if (style.startsWith('CC')) return 'clicksign';
  return 'autografa';
}

function responseStyle(response: SignatureStampResponse) {
  const style = String(response.signature_stamp_style || '').toUpperCase();
  if (style) return style;
  const method = responseMethod(response);
  return method === 'efirma' ? 'EC1' : method === 'clicksign' ? 'CC1' : 'AC0';
}

function dataUrlToBytes(value: string) {
  const match = value.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  if (!match) return null;
  return { type: match[1].toLowerCase(), bytes: Buffer.from(match[2], 'base64') };
}

function matchesField(field: SignatureStampField, response: SignatureStampResponse) {
  const participant = normalize(field.participantId);
  const responseId = normalize(response.participante_id);
  const email = normalize(response.participante_email);
  return participant && (participant === responseId || participant === email);
}

function drawTextLines(page: PDFPage, lines: string[], x: number, y: number, width: number, font: Awaited<ReturnType<PDFDocument['embedFont']>>, size: number, color = ink) {
  lines.forEach((line, index) => {
    page.drawText(line, { x, y: y - index * (size + 2), size, font, color, maxWidth: width });
  });
}

async function drawStamp(
  pdf: PDFDocument,
  page: PDFPage,
  response: SignatureStampResponse,
  field: SignatureStampField | null,
  index: number,
  fonts: DocuboxPdfFonts,
) {
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const method = responseMethod(response);
  const style = responseStyle(response);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const defaultWidth = 220;
  const defaultHeight = 82;
  const stampWidth = field ? Math.max(130, pageWidth * Math.max(12, Number(field.width || 34)) / 100) : defaultWidth;
  const stampHeight = field ? Math.max(54, pageHeight * Math.max(6, Number(field.height || 12)) / 100) : defaultHeight;
  const x = field
    ? Math.max(0, Math.min(pageWidth - stampWidth, pageWidth * Math.max(0, Number(field.x || 0)) / 100))
    : 36;
  const top = field ? pageHeight * Math.max(0, Number(field.y || 0)) / 100 : 72 + index * (defaultHeight + 14);
  const y = Math.max(12, Math.min(pageHeight - stampHeight - 12, pageHeight - top - stampHeight));
  const accent = method === 'autografa' ? green : blue;
  const name = String(response.participante_nombre || 'Firmante');
  const rfc = String(metadata.rfc || 'RFC no disponible');
  const signedAt = formatDate(response.firma_completada_at);
  const ip = String(response.signature_ip || metadata.ip || 'No disponible');
  const verificationUrl = String(metadata.verification_url || 'docubox.mx/verificar-documento');

  page.drawRectangle({ x, y, width: stampWidth, height: stampHeight, color: rgb(1, 1, 1), borderColor: accent, borderWidth: 0.9, opacity: 0.98 });
  page.drawRectangle({ x, y, width: 4, height: stampHeight, color: accent });
  page.drawText(`DOCUBOX ${style}`, { x: x + 10, y: y + stampHeight - 13, size: Math.min(8, stampHeight * 0.12), font: bold, color: accent });

  if (method === 'autografa') {
    const source = response.firma_data ? dataUrlToBytes(response.firma_data) : null;
    if (source) {
      try {
        const image = source.type === 'png' ? await pdf.embedPng(source.bytes) : await pdf.embedJpg(source.bytes);
        const imageSize = image.scaleToFit(stampWidth - 22, Math.max(20, stampHeight * 0.48));
        page.drawImage(image, { x: x + 10, y: y + stampHeight - 22 - imageSize.height, width: imageSize.width, height: imageSize.height });
      } catch {
        page.drawText('Trazo de firma disponible', { x: x + 10, y: y + stampHeight - 34, size: 7, font: regular, color: muted });
      }
    }
    drawTextLines(page, [name, `SHA-256 ${shortHash(response.signature_hash)}`], x + 10, y + 18, stampWidth - 18, regular, Math.min(7.5, stampHeight * 0.11), ink);
    return;
  }

  const lines = method === 'efirma'
    ? [name, `RFC: ${rfc}`, `Certificado: ${String(metadata.certificate_serial || 'No disponible')}`, `SHA-256: ${shortHash(response.signature_hash)}`, `OCSP: ${String(metadata.ocsp_status || 'No disponible')}`, signedAt, verificationUrl]
    : [name, `RFC: ${rfc}`, 'Aceptacion: confirmada', `SHA-256: ${shortHash(response.signature_hash)}`, `IP: ${ip}`, signedAt, verificationUrl];
  const fontSize = Math.max(4.7, Math.min(7, stampHeight / 13));
  drawTextLines(page, lines, x + 10, y + stampHeight - 27, stampWidth - 18, regular, fontSize, ink);
}

export async function createSignedDocumentPdf(params: {
  originalBytes: Uint8Array;
  fields: SignatureStampField[];
  responses: SignatureStampResponse[];
  technicalMetadata: FinalPdfTechnicalMetadata;
}) {
  const pdf = await PDFDocument.load(params.originalBytes, { ignoreEncryption: false });
  const fonts = await embedDocuboxPdfFonts(pdf);
  const signatureFields = params.fields.filter(isSignatureStampField);
  let stampsApplied = 0;

  for (const response of params.responses) {
    const matching = signatureFields.filter((field) => matchesField(field, response));
    for (const field of matching) {
      const pageIndex = Math.max(0, Math.min(pdf.getPageCount() - 1, Number(field.page || 1) - 1));
      await drawStamp(pdf, pdf.getPage(pageIndex), response, field, 0, fonts);
      stampsApplied += 1;
    }
  }

  const metadataResult = applyFinalPdfMetadata(pdf, params.technicalMetadata);
  const bytes = await pdf.save({ useObjectStreams: false });
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    stampsApplied,
    metadataSnapshotSha256: metadataResult.snapshotSha256,
  };
}
