import { createHash } from 'node:crypto';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import {
  applyFinalPdfMetadata,
  type FinalPdfTechnicalMetadata,
} from '@/lib/documents/final-pdf-metadata';
import { embedDocuboxPdfFonts, type DocuboxPdfFonts } from '@/lib/pdf/embedded-fonts';
import { getDefaultSignatureStampStyle, getStampSizePreset } from '@/lib/signatures/stamp-sizing';

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
  id?: string | null;
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
  const type = String(field.tipo || '')
    .trim()
    .toLowerCase();
  if (type === 'firma' || type === 'signature') return true;

  // Historic fields did not always persist `tipo`. Only accept their exact
  // signature labels so regular fields such as "Nombre del firmante" cannot
  // create a visual signature stamp.
  return !type && legacySignatureLabels.has(normalizeSignatureLabel(field.label));
}

const blue = rgb(0.118, 0.42, 1);
const green = rgb(0.02, 0.58, 0.38);
const ink = rgb(0.08, 0.12, 0.2);
const muted = rgb(0.35, 0.4, 0.48);
const lightBorder = rgb(0.82, 0.85, 0.89);
const amberSurface = rgb(1, 0.98, 0.9);
const amberBorder = rgb(0.96, 0.72, 0.2);
const amberInk = rgb(0.63, 0.32, 0.02);
const darkHeader = rgb(0.12, 0.15, 0.2);

function normalize(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Fecha no disponible'
    : date.toLocaleString('es-MX', {
        timeZone: 'America/Chihuahua',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      });
}

function shortHash(value: string | null | undefined) {
  const hash = String(value || '')
    .replace(/[^a-f0-9]/gi, '')
    .toUpperCase();
  return hash ? `${hash.slice(0, 16)}...` : 'No disponible';
}

function responseMethod(response: SignatureStampResponse) {
  const method = normalize(response.signature_method);
  if (method === 'efirma' || method === 'autografa' || method === 'clicksign') return method;
  const style = String(response.signature_stamp_style || '').toUpperCase();
  if (/^E[CML]\d+$/.test(style)) return 'efirma';
  if (/^C[CML]\d+$/.test(style)) return 'clicksign';
  return 'autografa';
}

function responseStyle(response: SignatureStampResponse) {
  const style = String(response.signature_stamp_style || '').toUpperCase();
  if (style) return style;
  const method = responseMethod(response);
  return getDefaultSignatureStampStyle(method);
}

export type ResolvedSignatureStampBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function resolveSignatureStampBox(
  pageSize: { width: number; height: number },
  field: SignatureStampField | null,
  index = 0
): ResolvedSignatureStampBox {
  const defaultWidth = 220;
  const defaultHeight = 82;
  if (!field) {
    return {
      x: 36,
      y: Math.max(12, pageSize.height - 72 - index * (defaultHeight + 14) - defaultHeight),
      width: defaultWidth,
      height: defaultHeight,
    };
  }

  const widthPercent = Math.max(0.1, Math.min(100, Number(field.width ?? 34)));
  const heightPercent = Math.max(0.1, Math.min(100, Number(field.height ?? 12)));
  const width = (pageSize.width * widthPercent) / 100;
  const height = (pageSize.height * heightPercent) / 100;
  const requestedX = (pageSize.width * Math.max(0, Number(field.x ?? 0))) / 100;
  const requestedTop = (pageSize.height * Math.max(0, Number(field.y ?? 0))) / 100;

  return {
    x: Math.max(0, Math.min(pageSize.width - width, requestedX)),
    y: Math.max(0, Math.min(pageSize.height - height, pageSize.height - requestedTop - height)),
    width,
    height,
  };
}

export function getAdaptiveStampRenderBox(style: string, width: number, height: number) {
  const preset = getStampSizePreset(style);
  const scale = Math.max(
    1,
    preset.minimumRenderWidth / Math.max(width, 0.1),
    preset.minimumRenderHeight / Math.max(height, 0.1)
  );
  return { width: width * scale, height: height * scale, scale };
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

function drawTextLines(
  page: PDFPage,
  lines: string[],
  x: number,
  y: number,
  width: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
  color = ink
) {
  lines.forEach((line, index) => {
    page.drawText(fitText(line, width, font, size), {
      x,
      y: y - index * (size + 2),
      size,
      font,
      color,
    });
  });
}

type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

function fitText(value: string, width: number, font: PdfFont, size: number) {
  if (width <= 0 || font.widthOfTextAtSize(value, size) <= width) return value;
  const suffix = '...';
  let fitted = value;
  while (fitted.length > 1 && font.widthOfTextAtSize(`${fitted}${suffix}`, size) > width) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}${suffix}`;
}

function splitTokenForWidth(value: string, width: number, font: PdfFont, size: number) {
  if (!value) return [''];
  const lines: string[] = [];
  let current = '';
  for (const character of value) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCheck(page: PDFPage, x: number, y: number, size: number, color = blue) {
  page.drawRectangle({ x, y, width: size, height: size, borderColor: color, borderWidth: 1 });
  page.drawLine({
    start: { x: x + size * 0.22, y: y + size * 0.5 },
    end: { x: x + size * 0.43, y: y + size * 0.28 },
    thickness: Math.max(0.7, size * 0.09),
    color,
  });
  page.drawLine({
    start: { x: x + size * 0.42, y: y + size * 0.28 },
    end: { x: x + size * 0.8, y: y + size * 0.74 },
    thickness: Math.max(0.7, size * 0.09),
    color,
  });
}

function drawCornerMarks(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  color = rgb(0.55, 0.58, 0.63)
) {
  const length = Math.max(5, Math.min(width, height) * 0.1);
  const corners = [
    { x, y, hx: 1, hy: 1 },
    { x: x + width, y, hx: -1, hy: 1 },
    { x, y: y + height, hx: 1, hy: -1 },
    { x: x + width, y: y + height, hx: -1, hy: -1 },
  ];
  corners.forEach((corner) => {
    page.drawLine({
      start: { x: corner.x, y: corner.y },
      end: { x: corner.x + corner.hx * length, y: corner.y },
      thickness: 0.8,
      color,
    });
    page.drawLine({
      start: { x: corner.x, y: corner.y },
      end: { x: corner.x, y: corner.y + corner.hy * length },
      thickness: 0.8,
      color,
    });
  });
}

function drawLabelValue(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  regular: PdfFont,
  bold: PdfFont,
  size: number
) {
  const labelSize = Math.max(2.6, size * 0.72);
  page.drawText(fitText(label.toUpperCase(), width, bold, labelSize), {
    x,
    y,
    size: labelSize,
    font: bold,
    color: rgb(0.56, 0.6, 0.67),
  });
  page.drawText(fitText(value, width, regular, size), {
    x,
    y: y - size - 0.5,
    size,
    font: regular,
    color: ink,
  });
}

function drawHashPanel(
  page: PDFPage,
  hash: string | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  regular: PdfFont,
  bold: PdfFont,
  full: boolean,
  label = 'HASH FIRMADO RSA / SHA-256'
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: amberSurface,
    borderColor: amberBorder,
    borderWidth: 0.55,
  });
  const labelSize = Math.max(2.5, Math.min(4.4, height * 0.24));
  const valueSize = Math.max(2.6, Math.min(4.7, height * 0.25));
  page.drawText(fitText(label, width - 6, bold, labelSize), {
    x: x + 3,
    y: y + height - labelSize - 2,
    size: labelSize,
    font: bold,
    color: amberInk,
  });
  const normalizedHash =
    String(hash || '')
      .replace(/[^a-f0-9]/gi, '')
      .toUpperCase() || 'NO DISPONIBLE';
  const value = full ? normalizedHash : shortHash(normalizedHash);
  const valueWidth = Math.max(4, width - 6);
  const availableHeight = Math.max(3, height - labelSize - 5);
  let resolvedValueSize = valueSize;
  let lines = full
    ? splitTokenForWidth(value, valueWidth, regular, resolvedValueSize)
    : [fitText(value, valueWidth, regular, resolvedValueSize)];
  while (
    full &&
    resolvedValueSize > 1.8 &&
    lines.length * (resolvedValueSize + 0.7) > availableHeight
  ) {
    resolvedValueSize -= 0.2;
    lines = splitTokenForWidth(value, valueWidth, regular, resolvedValueSize);
  }
  const lineHeight = resolvedValueSize + 0.7;
  const firstLineY = y + 2 + (lines.length - 1) * lineHeight;
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: x + 3,
      y: firstLineY - index * lineHeight,
      size: resolvedValueSize,
      font: regular,
      color: ink,
    });
  });
}

function drawClickSignHashPanel(
  page: PDFPage,
  hash: string | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  regular: PdfFont,
  bold: PdfFont
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.94, 0.97, 1),
  });
  const labelSize = Math.max(2.5, Math.min(4.4, height * 0.24));
  let valueSize = Math.max(2.6, Math.min(4.7, height * 0.25));
  page.drawText('HUELLA SHA-256', {
    x: x + 3,
    y: y + height - labelSize - 2,
    size: labelSize,
    font: bold,
    color: blue,
  });
  const value =
    String(hash || '')
      .replace(/[^a-f0-9]/gi, '')
      .toUpperCase() || 'NO DISPONIBLE';
  const valueWidth = Math.max(4, width - 6);
  const availableHeight = Math.max(3, height - labelSize - 5);
  let lines = splitTokenForWidth(value, valueWidth, regular, valueSize);
  while (valueSize > 1.8 && lines.length * (valueSize + 0.7) > availableHeight) {
    valueSize -= 0.2;
    lines = splitTokenForWidth(value, valueWidth, regular, valueSize);
  }
  const lineHeight = valueSize + 0.7;
  const firstLineY = y + 2 + (lines.length - 1) * lineHeight;
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: x + 3,
      y: firstLineY - index * lineHeight,
      size: valueSize,
      font: regular,
      color: ink,
    });
  });
}

async function embedQrCode(pdf: PDFDocument, value: string) {
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 512,
    color: { dark: '#111827', light: '#ffffff' },
  });
  const source = dataUrlToBytes(dataUrl);
  return source ? pdf.embedPng(source.bytes) : null;
}

async function drawAutographTrace(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  x: number;
  y: number;
  width: number;
  height: number;
  regular: PdfFont;
}) {
  const { pdf, page, response, x, y, width, height, regular } = params;
  if (width <= 2 || height <= 2) return;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0.985, 0.99, 1),
    borderColor: blue,
    borderWidth: 0.9,
  });
  const source = response.firma_data ? dataUrlToBytes(response.firma_data) : null;
  if (!source) {
    const size = Math.max(2.8, Math.min(5, height * 0.32));
    const label = fitText('Firma autografa', width, regular, size);
    page.drawText(label, {
      x: x + Math.max(0, (width - regular.widthOfTextAtSize(label, size)) / 2),
      y: y + Math.max(0, (height - size) / 2),
      size,
      font: regular,
      color: muted,
    });
    return;
  }

  try {
    const image =
      source.type === 'png' ? await pdf.embedPng(source.bytes) : await pdf.embedJpg(source.bytes);
    const imageSize = image.scaleToFit(Math.max(1, width - 4), Math.max(1, height - 4));
    page.drawImage(image, {
      x: x + (width - imageSize.width) / 2,
      y: y + (height - imageSize.height) / 2,
      width: imageSize.width,
      height: imageSize.height,
    });
  } catch {
    const size = Math.max(2.8, Math.min(5, height * 0.32));
    page.drawText('Trazo disponible', {
      x,
      y: y + Math.max(0, (height - size) / 2),
      size,
      font: regular,
      color: muted,
    });
  }
}

async function drawAutografaStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const role = stampText(metadata.participant_role || metadata.role, 'Firmante');
  const act = stampText(metadata.participant_act || metadata.act, 'Firmante');
  const signedAt = formatDate(response.firma_completada_at);
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const inset = Math.max(3, Math.min(7, width * 0.03));
  const stripeWidth = style === 'AC4' ? Math.max(3, Math.min(5, width * 0.02)) : 0;
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: style === 'AC0' || style === 'AC1' ? lightBorder : blue,
    borderWidth: style === 'AC3' ? 1 : 0.75,
  });
  if (stripeWidth) page.drawRectangle({ x, y, width: stripeWidth, height, color: blue });
  if (style === 'AC3') drawCornerMarks(page, x + 3, y + 3, width - 6, height - 6, blue);

  let contentX = x + inset + stripeWidth;
  const contentY = y + inset;
  let contentWidth = width - inset * 2 - stripeWidth;
  const contentHeight = height - inset * 2;
  if (style === 'AC5') {
    const ticketWidth = Math.min(contentWidth, Math.max(120, contentHeight * 2.2));
    contentX += (contentWidth - ticketWidth) / 2;
    contentWidth = ticketWidth;
    page.drawRectangle({
      x: contentX - 2,
      y: contentY - 2,
      width: contentWidth + 4,
      height: contentHeight + 4,
      borderColor: lightBorder,
      borderWidth: 0.55,
    });
  }

  const withQr = style !== 'AC0' && style !== 'AC1';
  const qrSize = withQr ? Math.max(15, Math.min(26, contentHeight * 0.44)) : 0;
  const textWidth = Math.max(20, contentWidth - (withQr ? qrSize + 3 : 0));
  const bodySize = Math.max(2.4, Math.min(4.6, contentHeight * 0.055));
  const titleSize = Math.max(3.2, Math.min(7.2, contentHeight * 0.085));
  const hashHeight = Math.max(12, Math.min(21, contentHeight * 0.25));
  const hashY = contentY + titleSize + bodySize * 2 + 5;
  const traceY = hashY + hashHeight + 2;
  const traceHeight = Math.max(3, contentY + contentHeight - traceY);

  await drawAutographTrace({
    pdf,
    page,
    response,
    x: contentX,
    y: traceY,
    width: textWidth,
    height: traceHeight,
    regular,
  });
  drawClickSignHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashY,
    textWidth,
    hashHeight,
    regular,
    bold
  );
  drawAutographIdentity({
    page,
    name,
    role,
    act,
    signedAt,
    showName: style !== 'AC0',
    x: contentX,
    y: contentY,
    width: textWidth,
    titleSize,
    bodySize,
    regular,
    bold,
  });
  if (withQr) {
    try {
      const qr = await embedQrCode(pdf, verificationUrl);
      if (qr)
        page.drawImage(qr, {
          x: contentX + contentWidth - qrSize,
          y: contentY + Math.max(0, (contentHeight - qrSize) / 2),
          width: qrSize,
          height: qrSize,
        });
    } catch {
      // The complete hash remains visible when QR generation is unavailable.
    }
  }
}

function drawAutographIdentity(params: {
  page: PDFPage;
  name: string;
  role: string;
  act: string;
  signedAt: string;
  showName?: boolean;
  x: number;
  y: number;
  width: number;
  titleSize: number;
  bodySize: number;
  regular: PdfFont;
  bold: PdfFont;
}) {
  const { page, name, role, act, signedAt, showName = true, x, y, width, titleSize, bodySize, regular, bold } =
    params;
  if (showName) {
    page.drawText(fitText(name, width, bold, titleSize), {
      x,
      y: y + bodySize * 2 + 3,
      size: titleSize,
      font: bold,
      color: ink,
    });
  }
  page.drawText(fitText(`Rol: ${role} · Acto: ${act}`, width, regular, bodySize), {
    x,
    y: y + bodySize + 1,
    size: bodySize,
    font: regular,
    color: muted,
  });
  page.drawText(fitText(`Firmado: ${signedAt}`, width, regular, bodySize), {
    x,
    y,
    size: bodySize,
    font: regular,
    color: muted,
  });
}

function stampText(value: unknown, fallback: string) {
  const normalized = String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!normalized) return fallback;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function drawAutografaMediumStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const role = stampText(metadata.participant_role || metadata.role, 'Firmante');
  const act = stampText(metadata.participant_act || metadata.act, 'Firmante');
  const capacity = stampText(metadata.participant_capacity || metadata.capacity, role);
  const method = stampText(metadata.signature_method_label, 'Firma autografa');
  const authentication = stampText(
    metadata.authentication_status,
    metadata.otp_verified === true ? 'OTP verificado' : 'Cuenta autenticada'
  );
  const signedAt = formatDate(response.firma_completada_at);
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const stripeWidth = style === 'AM3' ? Math.max(3, Math.min(6, width * 0.02)) : 0;
  const inset = Math.max(4, Math.min(8, width * 0.03));
  const frameColor = blue;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: frameColor,
    borderWidth: style === 'AM2' ? 1 : 0.75,
    opacity: 0.99,
  });
  if (stripeWidth) page.drawRectangle({ x, y, width: stripeWidth, height, color: blue });
  if (style === 'AM2') drawCornerMarks(page, x + 4, y + 4, width - 8, height - 8, blue);

  let contentX = x + inset + stripeWidth;
  const contentY = y + inset;
  let contentWidth = width - inset * 2 - stripeWidth;
  const contentHeight = height - inset * 2;
  if (style === 'AM5') {
    const ticketWidth = Math.min(contentWidth, Math.max(175, contentHeight * 1.6));
    contentX += (contentWidth - ticketWidth) / 2;
    contentWidth = ticketWidth;
    page.drawRectangle({
      x: contentX - 2,
      y: contentY - 2,
      width: contentWidth + 4,
      height: contentHeight + 4,
      borderColor: lightBorder,
      borderWidth: 0.55,
    });
  }

  const titleSize = Math.max(4, Math.min(8, contentHeight * 0.07));
  const bodySize = Math.max(2.7, Math.min(4.8, contentHeight * 0.04));
  const headerHeight = Math.max(
    style === 'AM5' ? 16 : style === 'AM3' ? 17 : 14,
    Math.min(
      style === 'AM5' ? 32 : 25,
      contentHeight * (style === 'AM5' ? 0.23 : style === 'AM4' ? 0.2 : 0.16)
    )
  );
  const footerHeight = Math.max(
    style === 'AM5' ? 30 : style === 'AM3' ? 38 : style === 'AM2' ? 32 : 26,
    Math.min(44, contentHeight * (style === 'AM5' ? 0.32 : 0.3))
  );
  const hashHeight = Math.max(17, Math.min(25, contentHeight * 0.19));
  const headerTop = contentY + contentHeight;
  const headerBottom = headerTop - headerHeight;
  const footerTop = contentY + footerHeight;
  const hashY = footerTop + 2;
  const traceY = hashY + hashHeight + 3;
  const traceHeight = Math.max(8, headerBottom - traceY - 2);
  const sideQrSize =
    style === 'AM3'
      ? Math.max(18, Math.min(34, traceHeight, contentWidth * 0.16))
      : Math.max(18, Math.min(34, hashHeight + 3, contentWidth * 0.18));

  if (style === 'AM4') {
    page.drawRectangle({
      x,
      y: y + height - headerHeight - inset,
      width,
      height: headerHeight + inset,
      color: darkHeader,
    });
  }

  const avatarStyle = style === 'AM1' || style === 'AM4';
  const centeredHeader = style === 'AM2' || style === 'AM5';
  let headerTextX = contentX;
  let headerTextWidth = contentWidth;
  if (avatarStyle) {
    const avatarSize = Math.max(10, Math.min(19, headerHeight - 2));
    const avatarY = headerTop - avatarSize;
    page.drawCircle({
      x: contentX + avatarSize / 2,
      y: avatarY + avatarSize / 2,
      size: avatarSize / 2,
      color: style === 'AM4' ? rgb(0.78, 0.88, 1) : rgb(0.88, 0.93, 1),
    });
    const initial = name.trim().charAt(0).toUpperCase() || 'F';
    const initialSize = Math.max(3.2, avatarSize * 0.43);
    page.drawText(initial, {
      x: contentX + (avatarSize - bold.widthOfTextAtSize(initial, initialSize)) / 2,
      y: avatarY + (avatarSize - initialSize) / 2,
      size: initialSize,
      font: bold,
      color: blue,
    });
    headerTextX += avatarSize + 5;
    headerTextWidth -= avatarSize + 5;
  }
  const titleLines = [fitText(method, headerTextWidth, bold, titleSize)];
  if (centeredHeader) {
    headerTextX = contentX;
  }
  titleLines.forEach((title, index) => {
    page.drawText(title, {
      x: centeredHeader
        ? contentX + Math.max(0, (contentWidth - bold.widthOfTextAtSize(title, titleSize)) / 2)
        : headerTextX,
      y: headerTop - titleSize - index * (titleSize + 1),
      size: titleSize,
      font: bold,
      color: style === 'AM4' ? rgb(1, 1, 1) : ink,
    });
  });
  page.drawText(fitText(`${capacity} · ${authentication}`, headerTextWidth, regular, bodySize), {
    x: headerTextX,
    y: headerTop - titleSize - bodySize - 2,
    size: bodySize,
    font: regular,
    color: style === 'AM4' ? rgb(0.82, 0.87, 0.94) : muted,
  });

  await drawAutographTrace({
    pdf,
    page,
    response,
    x: contentX,
    y: traceY,
    width: style === 'AM5' ? contentWidth : contentWidth - sideQrSize - 4,
    height: traceHeight,
    regular,
  });
  drawClickSignHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashY,
    style === 'AM5' ? contentWidth : contentWidth - sideQrSize - 4,
    hashHeight,
    regular,
    bold
  );
  drawAutographIdentity({
    page,
    name,
    role,
    act,
    signedAt,
    x: contentX,
    y: contentY + (style === 'AM3' ? 17 : style === 'AM2' ? 9 : style === 'AM5' ? 8 : 0),
    width: style === 'AM5' ? contentWidth - 30 : contentWidth,
    titleSize,
    bodySize,
    regular,
    bold,
  });

  const drawQr = async (qrX: number, qrY: number, qrSize: number) => {
    try {
      const qr = await embedQrCode(pdf, verificationUrl);
      if (qr) page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      // The complete hash and authentication data remain visible without the QR.
    }
  };

  if (style === 'AM3') {
    const columnWidth = contentWidth / 3;
    drawLabelValue(
      page,
      'FECHA',
      signedAt,
      contentX,
      contentY + 10,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'AUTENTICACION',
      authentication,
      contentX + columnWidth,
      contentY + 10,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'METODO',
      method,
      contentX + columnWidth * 2,
      contentY + 10,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
  }
  if (style === 'AM2') {
    page.drawRectangle({
      x: contentX,
      y: contentY,
      width: contentWidth,
      height: 8,
      color: rgb(0.92, 0.96, 1),
      borderColor: rgb(0.76, 0.85, 1),
      borderWidth: 0.4,
    });
    page.drawText(fitText(authentication, contentWidth - 4, regular, bodySize), {
      x: contentX + 2,
      y: contentY + 2,
      size: bodySize,
      font: regular,
      color: blue,
    });
  }
  if (style === 'AM5') {
    await drawQr(contentX + contentWidth - 26, contentY + 2, 26);
  } else {
    await drawQr(contentX + contentWidth - sideQrSize, hashY, sideQrSize);
  }
}

function autographInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'F';
  const surnameIndex = parts.length >= 3 ? parts.length - 2 : parts.length - 1;
  return `${parts[0].charAt(0)}${parts[surnameIndex].charAt(0)}`.toUpperCase();
}

function maskIdentityValue(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (!normalized) return 'No disponible';
  if (normalized.length <= 7) return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  return `${normalized.slice(0, 4)}******${normalized.slice(-3)}`;
}

async function drawAutografaLongStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const role = stampText(metadata.participant_role || metadata.role, 'Firmante');
  const act = stampText(metadata.participant_act || metadata.act, role);
  const signedAt = formatDate(response.firma_completada_at);
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const stripeWidth = style === 'AL3' ? Math.max(4, Math.min(7, width * 0.018)) : 0;
  const inset = Math.max(5, Math.min(9, width * 0.025));
  const borderColor = blue;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor,
    borderWidth: style === 'AL2' ? 1 : 0.75,
    opacity: 0.99,
  });
  if (stripeWidth) page.drawRectangle({ x, y, width: stripeWidth, height, color: blue });
  if (style === 'AL2') drawCornerMarks(page, x + 5, y + 5, width - 10, height - 10, blue);

  const contentX = x + inset + stripeWidth;
  const contentY = y + inset;
  const contentWidth = width - inset * 2 - stripeWidth;
  const contentHeight = height - inset * 2;
  const titleSize = Math.max(4.5, Math.min(8.5, contentHeight * 0.065));
  const bodySize = Math.max(2.8, Math.min(5, contentHeight * 0.038));
  const labelSize = Math.max(2.5, bodySize * 0.72);

  const drawQr = async (qrX: number, qrY: number, qrSize: number) => {
    try {
      const qr = await embedQrCode(pdf, verificationUrl);
      if (qr) page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      // The remaining verification data stays visible when QR generation fails.
    }
  };

  if (style === 'AL4') {
    const headerHeight = contentHeight * 0.27;
    const footerHeight = Math.max(27, contentHeight * 0.24);
    const hashHeight = Math.max(18, contentHeight * 0.22);
    const visualHeight = contentHeight - headerHeight - footerHeight - hashHeight - 6;
    const headerY = contentY + contentHeight - headerHeight;
    const hashY = contentY + footerHeight + 2;
    const visualY = hashY + hashHeight + 2;
    const third = contentWidth / 3;

    page.drawLine({
      start: { x: contentX, y: headerY },
      end: { x: contentX + contentWidth, y: headerY },
      thickness: 0.5,
      color: lightBorder,
    });
    [contentX + third, contentX + third * 2].forEach((lineX) => {
      page.drawLine({
        start: { x: lineX, y: headerY },
        end: { x: lineX, y: contentY + contentHeight },
        thickness: 0.45,
        color: lightBorder,
      });
    });

    page.drawText(fitText('Firma autografa', third - 8, bold, titleSize), {
      x: contentX + 4,
      y: contentY + contentHeight - titleSize - 3,
      size: titleSize,
      font: bold,
      color: ink,
    });
    page.drawText(fitText(`Firmado: ${signedAt}`, third - 8, regular, bodySize), {
      x: contentX + 4,
      y: contentY + contentHeight - titleSize - bodySize - 6,
      size: bodySize,
      font: regular,
      color: muted,
    });
    drawLabelValue(
      page,
      'RFC (OPCIONAL)',
      maskIdentityValue(metadata.rfc),
      contentX + third + 4,
      contentY + contentHeight - labelSize - 3,
      third - 8,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'CURP (OPCIONAL)',
      maskIdentityValue(metadata.curp),
      contentX + third * 2 + 4,
      contentY + contentHeight - labelSize - 3,
      third - 8,
      regular,
      bold,
      bodySize
    );

    const qrSize = Math.max(22, Math.min(46, visualHeight - 4, contentWidth * 0.14));
    const traceWidth = contentWidth - qrSize - 8;
    await drawAutographTrace({
      pdf,
      page,
      response,
      x: contentX + 4,
      y: visualY,
      width: traceWidth,
      height: Math.max(5, visualHeight),
      regular,
    });
    await drawQr(
      contentX + contentWidth - qrSize,
      visualY + Math.max(0, (visualHeight - qrSize) / 2),
      qrSize
    );
    drawClickSignHashPanel(
      page,
      response.signature_hash,
      contentX,
      hashY,
      contentWidth,
      hashHeight,
      regular,
      bold
    );
    drawAutographIdentity({
      page,
      name,
      role,
      act,
      signedAt,
      x: contentX,
      y: contentY,
      width: contentWidth,
      titleSize,
      bodySize,
      regular,
      bold,
    });
    return;
  }

  const detailsHeight = Math.max(35, Math.min(52, contentHeight * 0.38));
  const topY = contentY + detailsHeight;
  const topHeight = contentHeight - detailsHeight;
  page.drawLine({
    start: { x: contentX, y: topY },
    end: { x: contentX + contentWidth, y: topY },
    thickness: 0.5,
    color: lightBorder,
  });
  const qrSize = Math.max(24, Math.min(46, topHeight * 0.56, contentWidth * 0.13));

  if (style === 'AL2') {
    const nameText = fitText('Firma autografa', contentWidth - qrSize - 12, bold, titleSize);
    page.drawText(nameText, {
      x: contentX + Math.max(0, (contentWidth - bold.widthOfTextAtSize(nameText, titleSize)) / 2),
      y: contentY + contentHeight - titleSize,
      size: titleSize,
      font: bold,
      color: ink,
    });
    const roleText = fitText(`Firmado: ${signedAt}`, contentWidth - qrSize - 12, regular, bodySize);
    page.drawText(roleText, {
      x: contentX + Math.max(0, (contentWidth - regular.widthOfTextAtSize(roleText, bodySize)) / 2),
      y: contentY + contentHeight - titleSize - bodySize - 3,
      size: bodySize,
      font: regular,
      color: muted,
    });
    const traceWidth = Math.min(contentWidth * 0.45, contentWidth - qrSize - 20);
    const traceX = contentX + (contentWidth - traceWidth) / 2;
    await drawAutographTrace({
      pdf,
      page,
      response,
      x: traceX,
      y: topY + 7,
      width: traceWidth,
      height: Math.max(8, topHeight - titleSize - bodySize - 16),
      regular,
    });
    await drawQr(contentX + contentWidth - qrSize, topY + (topHeight - qrSize) / 2, qrSize);
  } else {
    const identityWidth = contentWidth * 0.44;
    const signatureWidth = contentWidth * 0.31;
    let identityX = contentX;
    if (style === 'AL1') {
      const avatarSize = Math.max(18, Math.min(30, topHeight * 0.46));
      page.drawCircle({
        x: contentX + avatarSize / 2,
        y: topY + (topHeight - avatarSize) / 2 + avatarSize / 2,
        size: avatarSize / 2,
        color: rgb(0.86, 0.93, 1),
      });
      const initials = autographInitials(name);
      const initialsSize = Math.max(5, avatarSize * 0.36);
      page.drawText(initials, {
        x: contentX + (avatarSize - bold.widthOfTextAtSize(initials, initialsSize)) / 2,
        y: topY + (topHeight - initialsSize) / 2,
        size: initialsSize,
        font: bold,
        color: blue,
      });
      identityX += avatarSize + 6;
    }
    const identityTextWidth = identityWidth - (identityX - contentX) - 4;
    page.drawText(fitText('Firma autografa', identityTextWidth, bold, titleSize), {
      x: identityX,
      y: topY + topHeight * 0.58,
      size: titleSize,
      font: bold,
      color: ink,
    });
    page.drawText(fitText(`Firmado: ${signedAt}`, identityTextWidth, regular, bodySize), {
      x: identityX,
      y: topY + topHeight * 0.58 - bodySize - 4,
      size: bodySize,
      font: regular,
      color: muted,
    });
    const traceX = contentX + identityWidth;
    await drawAutographTrace({
      pdf,
      page,
      response,
      x: traceX,
      y: topY + 7,
      width: signatureWidth,
      height: Math.max(8, topHeight - 14),
      regular,
    });
    page.drawText('Firma autografa', {
      x: traceX,
      y: topY + 3,
      size: bodySize,
      font: regular,
      color: muted,
    });
    await drawQr(contentX + contentWidth - qrSize, topY + (topHeight - qrSize) / 2, qrSize);
  }

  const identityHeight = titleSize + bodySize * 2 + 5;
  drawClickSignHashPanel(
    page,
    response.signature_hash,
    contentX,
    contentY + identityHeight,
    contentWidth,
    detailsHeight - identityHeight,
    regular,
    bold
  );
  drawAutographIdentity({
    page,
    name,
    role,
    act,
    signedAt,
    x: contentX,
    y: contentY,
    width: contentWidth,
    titleSize,
    bodySize,
    regular,
    bold,
  });
}

function drawCompactLateralEfirmaStamp(params: {
  page: PDFPage;
  response: SignatureStampResponse;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { page, response, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const serial = String(metadata.certificate_serial || 'No disponible');
  const validUntil = formatDate(String(metadata.certificate_valid_until || ''));
  const ocsp = String(metadata.ocsp_status || 'Valido');
  const validationProvider = String(metadata.validation_provider || metadata.provider || '').trim();
  const signedAt = formatDate(response.firma_completada_at);
  const ip = String(response.signature_ip || metadata.ip || 'No disponible');
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const inset = Math.max(4, Math.min(7, width * 0.035));
  const stripeWidth = Math.max(3, Math.min(5, width * 0.02));
  const contentX = x + stripeWidth + inset;
  const contentWidth = width - stripeWidth - inset * 2;
  let titleSize = Math.max(6, Math.min(9.5, height * 0.095));
  const bodySize = Math.max(3.8, Math.min(6.1, height * 0.061));
  const hashHeight = Math.max(10, Math.min(20, height * 0.2));

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: lightBorder,
    borderWidth: 0.75,
    opacity: 0.99,
  });
  page.drawRectangle({ x, y, width: stripeWidth, height, color: blue });

  while (titleSize > 6 && bold.widthOfTextAtSize(name, titleSize) > contentWidth) {
    titleSize -= 0.25;
  }
  const fittedName = fitText(name, contentWidth, bold, titleSize);
  const nameY = y + height - inset - titleSize;
  page.drawText(fittedName, {
    x: contentX,
    y: nameY,
    size: titleSize,
    font: bold,
    color: ink,
  });

  const certificateY = nameY - bodySize - 3;
  const certificate = `Cert.: ${serial} · RSA-2048/SHA-256 · OCSP: ${ocsp} · Vigencia: ${validUntil}`;
  page.drawText(fitText(certificate, contentWidth, regular, bodySize), {
    x: contentX,
    y: certificateY,
    size: bodySize,
    font: regular,
    color: muted,
  });

  const hashY = Math.max(y + inset + bodySize * 4, certificateY - hashHeight - 4);
  drawHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashY,
    contentWidth,
    hashHeight,
    regular,
    bold,
    true,
    'HUELLA SHA-256'
  );

  if (height >= 68) {
    const detailsY = hashY - 4;
    const columnWidth = contentWidth / 2;
    drawLabelValue(
      page,
      'FECHA/TZ',
      signedAt,
      contentX,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'IP',
      ip,
      contentX + columnWidth,
      detailsY,
      columnWidth,
      regular,
      bold,
      bodySize
    );
    const validationText = `e.firma SAT validada${validationProvider ? ` por ${validationProvider}` : ''} · OCSP ${ocsp}`;
    page.drawText(fitText(validationText, contentWidth, regular, bodySize), {
      x: contentX,
      y: y + inset + bodySize + 4,
      size: bodySize,
      font: regular,
      color: green,
    });
  }

  page.drawText(fitText(verificationUrl, contentWidth, regular, bodySize), {
    x: contentX,
    y: y + inset,
    size: bodySize,
    font: regular,
    color: blue,
  });
}

async function drawEfirmaStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  if (style === 'EC3') {
    drawCompactLateralEfirmaStamp({ page, response, x, y, width, height, fonts });
    return;
  }
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const rfc = String(metadata.rfc || 'RFC no disponible');
  const serial = String(metadata.certificate_serial || 'No disponible');
  const role = String(metadata.participant_role || metadata.role || 'Proveedor');
  const act = String(metadata.participant_act || metadata.act || 'Firmante');
  const validUntil = formatDate(String(metadata.certificate_valid_until || ''));
  const ocsp = String(metadata.ocsp_status || 'Válido');
  const signedAt = formatDate(response.firma_completada_at);
  const ip = String(response.signature_ip || metadata.ip || 'No disponible');
  const geolocation = String(metadata.geolocation || metadata.coordinates || 'No disponible');
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const compact = style.startsWith('EC');
  const medium = style.startsWith('EM');
  const long = style.startsWith('EL');
  const lateral = style === 'EC3' || style === 'EM3' || style === 'EL3';
  const centered = style === 'EC4' || style === 'EM2' || style === 'EM5' || style === 'EL4';
  const dark = style === 'EM4';
  const withCheck = style === 'EC2';
  const withQr = [
    'EC2',
    'EC4',
    'EC5',
    'EM1',
    'EM2',
    'EM3',
    'EM4',
    'EM5',
    'EL1',
    'EL3',
    'EL4',
  ].includes(style);
  const fullHash = style.startsWith('EM') || style.startsWith('EL');
  const ticket = style === 'EM5';
  const sideQr = ['EC2', 'EC5', 'EM1', 'EM3', 'EM4', 'EL1', 'EL3', 'EL4'].includes(style);
  const inset = Math.max(3, Math.min(8, width * 0.035));
  const stripeWidth = lateral ? Math.max(3, width * 0.018) : 0;
  const headerHeight = dark ? Math.max(12, Math.min(22, height * 0.22)) : 0;
  const contentX = x + inset + stripeWidth;
  const contentWidth = width - inset * 2 - stripeWidth;
  const contentTop = y + height - inset - headerHeight;
  const titleSize = Math.max(4.2, Math.min(8.5, height * (compact ? 0.095 : 0.075)));
  const bodySize = Math.max(2.8, Math.min(5.6, height * (compact ? 0.06 : 0.047)));

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: lightBorder,
    borderWidth: 0.75,
    opacity: 0.99,
  });
  if (lateral) page.drawRectangle({ x, y, width: stripeWidth, height, color: blue });
  if (dark) {
    page.drawRectangle({
      x,
      y: y + height - headerHeight,
      width,
      height: headerHeight,
      color: darkHeader,
    });
  }

  let titleX = contentX;
  if (withCheck && !dark) {
    const checkSize = Math.max(7, Math.min(13, titleSize * 1.7));
    drawCheck(page, contentX, contentTop - checkSize, checkSize);
    titleX += checkSize + 4;
  }
  if (dark) {
    page.drawText(fitText(name, width - inset * 2, bold, titleSize), {
      x: x + inset,
      y: y + height - headerHeight + (headerHeight - titleSize) / 2,
      size: titleSize,
      font: bold,
      color: rgb(1, 1, 1),
    });
  } else {
    const titleWidth = contentWidth - (titleX - contentX);
    const measuredName = fitText(name, titleWidth, bold, titleSize);
    const titleOffset = centered
      ? Math.max(0, (contentWidth - bold.widthOfTextAtSize(measuredName, titleSize)) / 2)
      : titleX - contentX;
    page.drawText(measuredName, {
      x: contentX + titleOffset,
      y: contentTop - titleSize,
      size: titleSize,
      font: bold,
      color: ink,
    });
  }

  const topAfterTitle = contentTop - titleSize - Math.max(2, bodySize * 0.7);
  const qrSize = withQr
    ? style === 'EC2'
      ? Math.min(44, height - inset * 2 - titleSize - 2)
      : Math.max(18, Math.min(height * 0.27, width * 0.16, 42))
    : 0;
  const qrX = ticket || style === 'EM2' ? x + (width - qrSize) / 2 : x + width - inset - qrSize;
  const qrY =
    style === 'EM1' || style === 'EM3'
      ? y + height - inset - qrSize
      : style === 'EM4' || style === 'EL4'
        ? y + height - headerHeight - inset - qrSize
        : y + inset;
  const textRight = withQr && sideQr ? qrX - 4 : x + width - inset;
  const textWidth = Math.max(20, textRight - contentX);

  const certText = `Cert.: ${serial} · RSA-2048/SHA-256 · OCSP: ${ocsp} · Vigencia: ${validUntil}`;
  const identityText = long
    ? centered
      ? `RFC: ${rfc}`
      : `RFC: ${rfc} · Rol: ${role} · Acto: ${act}`
    : medium
      ? centered
        ? `RFC: ${rfc}`
        : `RFC: ${rfc} · Rol: ${role} · Acto: ${act}`
      : centered
        ? `RFC: ${rfc}`
        : certText;
  if (!dark || height >= 52) {
    const measuredIdentity = fitText(identityText, textWidth, regular, bodySize);
    page.drawText(measuredIdentity, {
      x:
        centered && !medium
          ? contentX +
            Math.max(0, (textWidth - regular.widthOfTextAtSize(measuredIdentity, bodySize)) / 2)
          : contentX,
      y: topAfterTitle,
      size: bodySize,
      font: regular,
      color: muted,
    });
  }
  const certY = centered || medium || long ? topAfterTitle - bodySize - 2 : topAfterTitle;
  if (centered) {
    const secondaryText = medium || long ? `Rol: ${role} · Acto: ${act}` : certText;
    page.drawText(fitText(secondaryText, textWidth, regular, bodySize), {
      x: contentX,
      y: certY,
      size: bodySize,
      font: regular,
      color: muted,
    });
  }

  const detailsRows = style === 'EL2' ? 2 : 1;
  const footerHeight = Math.max(7, bodySize + 3);
  const detailHeight = detailsRows * (bodySize * 2 + 3);
  const hashTop = certY - bodySize - 3;
  const availableHashHeight = hashTop - (y + inset + footerHeight + detailHeight);
  const hashHeight = Math.max(10, Math.min(compact ? 18 : 24, availableHashHeight));
  const hashWidth = withQr && sideQr ? textWidth : contentWidth;
  const hashY = Math.max(y + inset + footerHeight + detailHeight, hashTop - hashHeight);
  drawHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashY,
    hashWidth,
    hashHeight,
    regular,
    bold,
    fullHash,
    'HUELLA SHA-256'
  );

  const details: Array<[string, string]> =
    style === 'EL2'
      ? [
          ['FECHA Y HORA', signedAt],
          ['SERIE DEL CERTIFICADO', serial],
          ['VIGENCIA', `Hasta ${validUntil}`],
          ['ALGORITMO', 'RSA-2048 / SHA-256'],
          ['VALIDACIÓN', 'Certificado verificado'],
        ]
      : long
        ? [
            ['FECHA Y HORA', signedAt],
            ['SERIE DEL CERTIFICADO', serial],
            [
              style === 'EL3' ? 'VALIDACIÓN' : 'VIGENCIA',
              style === 'EL3' ? 'Certificado verificado' : `Hasta ${validUntil}`,
            ],
          ]
        : medium
          ? [
              ['FECHA Y HORA', signedAt],
              ['SERIE DEL CERTIFICADO', serial],
            ]
          : compact
            ? [
                ['FECHA/TZ', signedAt],
                ['IP', ip],
              ]
            : [
                ['FECHA', signedAt],
                ['IP', ip],
                ['GEOLOC', geolocation],
                ['OCSP', ocsp],
              ];
  const columns = long ? 3 : 2;
  const columnWidth = hashWidth / columns;
  const rowHeight = bodySize * 2 + 3;
  details.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    drawLabelValue(
      page,
      label,
      value,
      contentX + column * columnWidth,
      hashY - 3 - row * rowHeight,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
  });

  if (!medium && !long) {
    page.drawText(fitText(verificationUrl, hashWidth, regular, bodySize), {
      x: contentX,
      y: y + inset,
      size: bodySize,
      font: regular,
      color: blue,
    });
  }

  if (withQr) {
    try {
      const qr = await embedQrCode(pdf, verificationUrl);
      if (qr) page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      // The verification URL remains printed when QR generation is unavailable.
    }
  }
}

async function drawClickSignShortStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const role = String(metadata.participant_role || metadata.role || 'Proveedor');
  const act = String(metadata.participant_act || metadata.act || 'Firmante');
  const signedAt = formatDate(response.firma_completada_at);
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const centered = style === 'CC4' || style === 'CC5';
  const lateral = style === 'CC3';
  const withAcceptance = style !== 'CC1';
  const withQr = style === 'CC2' || style === 'CC4' || style === 'CC5';
  const ticket = style === 'CC5';
  const outerInset = Math.max(3, Math.min(7, width * 0.03));

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: lightBorder,
    borderWidth: 0.75,
  });

  let frameX = x;
  let frameWidth = width;
  if (ticket) {
    frameWidth = Math.max(40, width * 0.58);
    frameX = x + (width - frameWidth) / 2;
    page.drawRectangle({
      x: frameX,
      y: y + 2,
      width: frameWidth,
      height: Math.max(4, height - 4),
      color: rgb(1, 1, 1),
      borderColor: lightBorder,
      borderWidth: 0.65,
    });
  }

  const stripeWidth = lateral ? Math.max(3, Math.min(5, width * 0.02)) : 0;
  if (lateral) {
    page.drawRectangle({ x: frameX, y, width: stripeWidth, height, color: blue });
  }

  const contentX = frameX + outerInset + stripeWidth;
  const contentWidth = Math.max(22, frameWidth - outerInset * 2 - stripeWidth);
  const contentBottom = y + outerInset;
  const contentTop = y + height - outerInset;
  const titleSize = Math.max(4, Math.min(8.5, height * 0.09));
  const bodySize = Math.max(2.8, Math.min(5.4, height * 0.055));
  const pillHeight = Math.max(8, bodySize + 4);
  const pillWidth = Math.min(contentWidth, Math.max(42, bodySize * 18));

  const drawAcceptancePill = (pillX: number, pillY: number) => {
    page.drawRectangle({
      x: pillX,
      y: pillY,
      width: pillWidth,
      height: pillHeight,
      color: rgb(0.94, 0.97, 1),
      borderColor: rgb(0.72, 0.84, 1),
      borderWidth: 0.5,
    });
    const checkSize = Math.max(5, pillHeight - 4);
    drawCheck(page, pillX + 2, pillY + 2, checkSize, blue);
    page.drawText(fitText('Aceptación confirmada', pillWidth - checkSize - 7, regular, bodySize), {
      x: pillX + checkSize + 5,
      y: pillY + (pillHeight - bodySize) / 2,
      size: bodySize,
      font: regular,
      color: blue,
    });
  };

  let cursorTop = contentTop;
  if (withAcceptance && centered) {
    drawAcceptancePill(contentX + (contentWidth - pillWidth) / 2, cursorTop - pillHeight);
    cursorTop -= pillHeight + 3;
  }

  const sidePillWidth = withAcceptance && !centered ? pillWidth + 4 : 0;
  const titleWidth = Math.max(18, contentWidth - sidePillWidth);
  const title = fitText(name, titleWidth, bold, titleSize);
  const titleX = centered
    ? contentX + Math.max(0, (contentWidth - bold.widthOfTextAtSize(title, titleSize)) / 2)
    : contentX;
  page.drawText(title, {
    x: titleX,
    y: cursorTop - titleSize,
    size: titleSize,
    font: bold,
    color: ink,
  });
  if (withAcceptance && !centered) {
    drawAcceptancePill(contentX + contentWidth - pillWidth, cursorTop - pillHeight);
  }

  const roleText = `Rol: ${role} · Acto: ${act}`;
  const measuredRole = fitText(
    roleText,
    style === 'CC2' ? contentWidth - 44 : contentWidth,
    regular,
    bodySize
  );
  page.drawText(measuredRole, {
    x: centered
      ? contentX +
        Math.max(0, (contentWidth - regular.widthOfTextAtSize(measuredRole, bodySize)) / 2)
      : contentX,
    y: cursorTop - titleSize - bodySize - 2,
    size: bodySize,
    font: regular,
    color: muted,
  });
  cursorTop -= titleSize + bodySize + 5;

  const qrSize = withQr
    ? style === 'CC2'
      ? Math.min(44, height - outerInset * 2 - pillHeight - 1)
      : Math.max(17, Math.min(38, height * 0.26, width * 0.16))
    : 0;
  let dateY = contentBottom;
  let hashBottom = contentBottom + bodySize + 4;
  let qrX = contentX + contentWidth - qrSize;
  let qrY = hashBottom;
  if (style === 'CC4' || style === 'CC5') {
    qrX = contentX + (contentWidth - qrSize) / 2;
    qrY = contentBottom;
    dateY = qrY + qrSize + 2;
    hashBottom = dateY + bodySize + 4;
  }

  page.drawText(
    fitText(
      `Fecha y hora: ${signedAt}`,
      style === 'CC2' ? contentWidth - qrSize - 4 : contentWidth,
      regular,
      bodySize
    ),
    {
      x: centered ? contentX : contentX,
      y: dateY,
      size: bodySize,
      font: regular,
      color: muted,
    }
  );

  const hashWidth = style === 'CC2' ? Math.max(20, contentWidth - qrSize - 4) : contentWidth;
  const hashHeight = Math.max(12, cursorTop - hashBottom);
  drawClickSignHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashBottom,
    hashWidth,
    hashHeight,
    regular,
    bold
  );

  if (withQr) {
    if (style === 'CC2') qrY = contentBottom;
    try {
      const qr = await embedQrCode(pdf, verificationUrl);
      if (qr) page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      // The stamp remains readable when QR generation is unavailable.
    }
  }
}

async function drawClickSignMediumStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const role = String(metadata.participant_role || metadata.role || 'Proveedor');
  const act = String(metadata.participant_act || metadata.act || 'Firmante');
  const signedAt = formatDate(response.firma_completada_at);
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const lateral = style === 'CM2';
  const dark = style === 'CM3';
  const framed = style === 'CM4';
  const ticket = style === 'CM5';
  const centered = framed || ticket;
  const inset = Math.max(3, Math.min(7, width * 0.03));

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: lightBorder,
    borderWidth: 0.75,
  });

  let frameX = x;
  let frameWidth = width;
  if (ticket) {
    frameWidth = Math.max(44, width * 0.58);
    frameX = x + (width - frameWidth) / 2;
    page.drawRectangle({
      x: frameX,
      y: y + 2,
      width: frameWidth,
      height: Math.max(4, height - 4),
      color: rgb(1, 1, 1),
      borderColor: lightBorder,
      borderWidth: 0.65,
    });
  }

  const stripeWidth = lateral ? Math.max(3, Math.min(5, width * 0.02)) : 0;
  if (lateral) {
    page.drawRectangle({ x: frameX, y, width: stripeWidth, height, color: blue });
  }
  if (framed) drawCornerMarks(page, frameX + 3, y + 3, frameWidth - 6, height - 6);

  const headerHeight = dark ? Math.max(14, Math.min(22, height * 0.24)) : 0;
  if (dark) {
    page.drawRectangle({
      x: frameX,
      y: y + height - headerHeight,
      width: frameWidth,
      height: headerHeight,
      color: darkHeader,
    });
  }

  const contentX = frameX + inset + stripeWidth;
  const contentWidth = Math.max(24, frameWidth - inset * 2 - stripeWidth);
  const contentBottom = y + inset;
  const contentTop = y + height - inset - headerHeight;
  const titleSize = Math.max(4, Math.min(8, height * 0.085));
  const bodySize = Math.max(2.8, Math.min(5.2, height * 0.052));
  const pillHeight = Math.max(8, bodySize + 4);
  const pillWidth = Math.min(contentWidth, Math.max(42, bodySize * 18));

  const drawAcceptancePill = (pillX: number, pillY: number) => {
    page.drawRectangle({
      x: pillX,
      y: pillY,
      width: pillWidth,
      height: pillHeight,
      color: rgb(0.94, 0.97, 1),
      borderColor: rgb(0.72, 0.84, 1),
      borderWidth: 0.5,
    });
    const checkSize = Math.max(5, pillHeight - 4);
    drawCheck(page, pillX + 2, pillY + 2, checkSize, blue);
    page.drawText(fitText('Aceptación confirmada', pillWidth - checkSize - 7, regular, bodySize), {
      x: pillX + checkSize + 5,
      y: pillY + (pillHeight - bodySize) / 2,
      size: bodySize,
      font: regular,
      color: blue,
    });
  };

  let cursorTop = contentTop;
  if (dark) {
    const headerY = y + height - headerHeight;
    page.drawText(fitText(name, frameWidth - inset * 2 - pillWidth - 4, bold, titleSize), {
      x: frameX + inset,
      y: headerY + (headerHeight - titleSize) / 2,
      size: titleSize,
      font: bold,
      color: rgb(1, 1, 1),
    });
    drawAcceptancePill(
      frameX + frameWidth - inset - pillWidth,
      headerY + (headerHeight - pillHeight) / 2
    );
  } else if (centered) {
    drawAcceptancePill(contentX + (contentWidth - pillWidth) / 2, cursorTop - pillHeight);
    cursorTop -= pillHeight + 3;
    const fittedName = fitText(name, contentWidth, bold, titleSize);
    page.drawText(fittedName, {
      x: contentX + Math.max(0, (contentWidth - bold.widthOfTextAtSize(fittedName, titleSize)) / 2),
      y: cursorTop - titleSize,
      size: titleSize,
      font: bold,
      color: ink,
    });
  } else {
    page.drawText(fitText(name, contentWidth - pillWidth - 4, bold, titleSize), {
      x: contentX,
      y: cursorTop - titleSize,
      size: titleSize,
      font: bold,
      color: ink,
    });
    drawAcceptancePill(contentX + contentWidth - pillWidth, cursorTop - pillHeight);
  }

  if (!dark) cursorTop -= titleSize + 3;
  if (style !== 'CM2') {
    const roleText = `Rol: ${role} · Acto: ${act}`;
    const fittedRole = fitText(roleText, contentWidth, regular, bodySize);
    page.drawText(fittedRole, {
      x: centered
        ? contentX +
          Math.max(0, (contentWidth - regular.widthOfTextAtSize(fittedRole, bodySize)) / 2)
        : contentX,
      y: cursorTop - bodySize,
      size: bodySize,
      font: regular,
      color: muted,
    });
    cursorTop -= bodySize + 4;
  }

  if (style === 'CM2') {
    const columnWidth = contentWidth / 3;
    drawLabelValue(
      page,
      'ROL',
      role,
      contentX,
      cursorTop,
      columnWidth - 2,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'ACTO',
      act,
      contentX + columnWidth,
      cursorTop,
      columnWidth - 2,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'FECHA Y HORA',
      signedAt,
      contentX + columnWidth * 2,
      cursorTop,
      columnWidth - 2,
      regular,
      bold,
      bodySize
    );
    cursorTop -= bodySize * 2 + 6;
  }

  const bottomQr = centered;
  const qrSize = bottomQr
    ? Math.max(19, Math.min(ticket ? 40 : 34, height * (ticket ? 0.28 : 0.24)))
    : Math.max(19, Math.min(36, height * 0.27, width * 0.16));
  const dateY = bottomQr ? contentBottom + qrSize + 2 : contentBottom;
  const hashBottom = dateY + bodySize + 4;
  const hashWidth = bottomQr ? contentWidth : Math.max(22, contentWidth - qrSize - 4);
  const hashHeight = Math.max(12, cursorTop - hashBottom);
  drawClickSignHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashBottom,
    hashWidth,
    hashHeight,
    regular,
    bold
  );

  const fittedDate = fitText(`Fecha y hora: ${signedAt}`, contentWidth, regular, bodySize);
  page.drawText(fittedDate, {
    x: centered
      ? contentX + Math.max(0, (contentWidth - regular.widthOfTextAtSize(fittedDate, bodySize)) / 2)
      : contentX,
    y: dateY,
    size: bodySize,
    font: regular,
    color: muted,
  });

  try {
    const qr = await embedQrCode(pdf, verificationUrl);
    if (qr) {
      page.drawImage(qr, {
        x: bottomQr ? contentX + (contentWidth - qrSize) / 2 : contentX + contentWidth - qrSize,
        y: bottomQr ? contentBottom : hashBottom + Math.max(0, (hashHeight - qrSize) / 2),
        width: qrSize,
        height: qrSize,
      });
    }
  } catch {
    // The stamp remains readable when QR generation is unavailable.
  }
}

async function drawClickSignLongStamp(params: {
  pdf: PDFDocument;
  page: PDFPage;
  response: SignatureStampResponse;
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fonts: DocuboxPdfFonts;
}) {
  const { pdf, page, response, style, x, y, width, height, fonts } = params;
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const name = String(response.participante_nombre || 'Firmante');
  const rfc = String(metadata.rfc || 'RFC no disponible');
  const role = String(metadata.participant_role || metadata.role || 'Proveedor');
  const act = String(metadata.participant_act || metadata.act || 'Firmante');
  const signedAt = formatDate(response.firma_completada_at);
  const ip = String(response.signature_ip || metadata.ip || 'No disponible');
  const rawLocation = metadata.geolocation || metadata.location;
  const location =
    typeof rawLocation === 'string' && rawLocation.trim()
      ? rawLocation.trim()
      : rawLocation && typeof rawLocation === 'object'
        ? `${String((rawLocation as Record<string, unknown>).lat || '')}, ${String((rawLocation as Record<string, unknown>).lng || '')}`
        : 'Ubicación no disponible';
  const device = String(metadata.device || metadata.user_agent || 'Navegador web');
  const channel = String(metadata.otp_channel || metadata.channel || 'Click & Sign');
  const verificationUrl = String(
    metadata.verification_url || 'https://docubox.mx/verificar-documento'
  );
  const lateral = style === 'CL3';
  const framed = style === 'CL4';
  const withAvatar = style !== 'CL2';
  const withAcceptance = style !== 'CL4';
  const withQr = style !== 'CL2';
  const inset = Math.max(4, Math.min(8, width * 0.03));
  const stripeWidth = lateral ? Math.max(3, Math.min(5, width * 0.02)) : 0;

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: lightBorder,
    borderWidth: 0.75,
  });
  if (lateral) page.drawRectangle({ x, y, width: stripeWidth, height, color: blue });
  if (framed) drawCornerMarks(page, x + 4, y + 4, width - 8, height - 8);

  const contentX = x + inset + stripeWidth;
  const contentWidth = Math.max(30, width - inset * 2 - stripeWidth);
  const contentBottom = y + inset;
  const contentTop = y + height - inset;
  const titleSize = Math.max(4.2, Math.min(8.2, height * 0.085));
  const bodySize = Math.max(2.8, Math.min(5.1, height * 0.052));
  const avatarSize = Math.max(14, Math.min(22, height * 0.22));
  const pillHeight = Math.max(8, bodySize + 4);
  const pillWidth = Math.min(contentWidth * 0.38, Math.max(42, bodySize * 18));

  const drawAcceptancePill = (pillX: number, pillY: number) => {
    page.drawRectangle({
      x: pillX,
      y: pillY,
      width: pillWidth,
      height: pillHeight,
      color: rgb(0.94, 0.97, 1),
      borderColor: rgb(0.72, 0.84, 1),
      borderWidth: 0.5,
    });
    const checkSize = Math.max(5, pillHeight - 4);
    drawCheck(page, pillX + 2, pillY + 2, checkSize, blue);
    page.drawText(fitText('Aceptación confirmada', pillWidth - checkSize - 7, regular, bodySize), {
      x: pillX + checkSize + 5,
      y: pillY + (pillHeight - bodySize) / 2,
      size: bodySize,
      font: regular,
      color: blue,
    });
  };

  let titleX = contentX;
  if (withAvatar) {
    const avatarX = contentX + avatarSize / 2;
    const avatarY = contentTop - avatarSize / 2;
    page.drawCircle({
      x: avatarX,
      y: avatarY,
      size: avatarSize / 2,
      color: rgb(0.92, 0.95, 1),
      borderColor: rgb(0.83, 0.88, 0.96),
      borderWidth: 0.5,
    });
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
    const initialsSize = Math.max(4, titleSize * 0.82);
    page.drawText(initials, {
      x: avatarX - bold.widthOfTextAtSize(initials, initialsSize) / 2,
      y: avatarY - initialsSize / 3,
      size: initialsSize,
      font: bold,
      color: blue,
    });
    titleX += avatarSize + 5;
  }

  const titleWidth = Math.max(
    20,
    contentX + contentWidth - titleX - (withAcceptance ? pillWidth + 4 : 0)
  );
  page.drawText(fitText(name, titleWidth, bold, titleSize), {
    x: titleX,
    y: contentTop - titleSize,
    size: titleSize,
    font: bold,
    color: ink,
  });
  if (withAcceptance) {
    drawAcceptancePill(contentX + contentWidth - pillWidth, contentTop - pillHeight);
  }

  const identityY = contentTop - titleSize - bodySize - 2;
  page.drawText(
    fitText(
      `RFC: ${rfc} · Rol: ${role} · Acto: ${act}`,
      contentX + contentWidth - titleX,
      regular,
      bodySize
    ),
    {
      x: titleX,
      y: identityY,
      size: bodySize,
      font: regular,
      color: muted,
    }
  );

  const detailsHeight = Math.max(24, height * (style === 'CL2' ? 0.38 : 0.31));
  const detailsTop = contentBottom + detailsHeight;
  page.drawLine({
    start: { x: contentX, y: detailsTop },
    end: { x: contentX + contentWidth, y: detailsTop },
    thickness: 0.5,
    color: lightBorder,
  });

  const hashBottom = detailsTop + 3;
  const hashTop = identityY - 4;
  drawClickSignHashPanel(
    page,
    response.signature_hash,
    contentX,
    hashBottom,
    contentWidth,
    Math.max(13, hashTop - hashBottom),
    regular,
    bold
  );

  const qrSize = withQr ? Math.max(18, Math.min(36, detailsHeight - 5)) : 0;
  const qrX = contentX + contentWidth - qrSize;
  const qrY = contentBottom + Math.max(0, (detailsHeight - qrSize) / 2);
  const detailsWidth = withQr ? contentWidth - qrSize - 6 : contentWidth;
  const detailsY = detailsTop - bodySize - 2;

  if (style === 'CL1') {
    const columnWidth = detailsWidth / 3;
    drawLabelValue(
      page,
      'FECHA Y HORA',
      signedAt,
      contentX,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'IP',
      ip,
      contentX + columnWidth,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'UBICACIÓN',
      location,
      contentX + columnWidth * 2,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
  } else if (style === 'CL2') {
    const columnWidth = detailsWidth / 2;
    const rowStep = bodySize * 2 + 3;
    const left = [
      ['FECHA Y HORA', signedAt],
      ['IP', ip],
      ['DISPOSITIVO', device],
    ];
    const right = [
      ['CANAL / MÉTODO', channel],
      ['UBICACIÓN', location],
      ['ACEPTACIÓN', 'Documento aceptado electrónicamente'],
    ];
    left.forEach(([label, value], index) =>
      drawLabelValue(
        page,
        label,
        value,
        contentX,
        detailsY - index * rowStep,
        columnWidth - 5,
        regular,
        bold,
        bodySize
      )
    );
    right.forEach(([label, value], index) =>
      drawLabelValue(
        page,
        label,
        value,
        contentX + columnWidth + 4,
        detailsY - index * rowStep,
        columnWidth - 5,
        regular,
        bold,
        bodySize
      )
    );
    page.drawLine({
      start: { x: contentX + columnWidth, y: contentBottom + 2 },
      end: { x: contentX + columnWidth, y: detailsTop - 2 },
      thickness: 0.4,
      color: lightBorder,
    });
  } else if (style === 'CL3') {
    const columnWidth = detailsWidth / 3;
    drawLabelValue(
      page,
      'FECHA Y HORA',
      signedAt,
      contentX,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'IP',
      ip,
      contentX,
      detailsY - bodySize * 2 - 3,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'UBICACIÓN',
      location,
      contentX + columnWidth,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'DISPOSITIVO',
      device,
      contentX + columnWidth * 2,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'CANAL / MÉTODO',
      channel,
      contentX + columnWidth * 2,
      detailsY - bodySize * 2 - 3,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
  } else {
    const columnWidth = detailsWidth / 3;
    drawLabelValue(
      page,
      'FECHA Y HORA',
      signedAt,
      contentX,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'DISPOSITIVO',
      device,
      contentX + columnWidth,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
    drawLabelValue(
      page,
      'CANAL / MÉTODO',
      channel,
      contentX + columnWidth * 2,
      detailsY,
      columnWidth - 3,
      regular,
      bold,
      bodySize
    );
  }

  if (withQr) {
    try {
      const qr = await embedQrCode(pdf, verificationUrl);
      if (qr) page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      // The evidence fields remain visible when QR generation is unavailable.
    }
  }
}

async function drawStamp(
  pdf: PDFDocument,
  page: PDFPage,
  response: SignatureStampResponse,
  field: SignatureStampField | null,
  index: number,
  fonts: DocuboxPdfFonts,
  renderBox?: ResolvedSignatureStampBox
) {
  const { regular, bold } = fonts;
  const metadata = response.signature_metadata || {};
  const method = responseMethod(response);
  const style = responseStyle(response);
  const placement = renderBox || resolveSignatureStampBox(page.getSize(), field, index);
  const { x, y, width: stampWidth, height: stampHeight } = placement;

  if (field && !renderBox) {
    const adaptive = getAdaptiveStampRenderBox(style, stampWidth, stampHeight);
    if (adaptive.scale > 1.001) {
      const normalizedPdf = await PDFDocument.create();
      const normalizedPage = normalizedPdf.addPage([adaptive.width, adaptive.height]);
      const normalizedFonts = await embedDocuboxPdfFonts(normalizedPdf);
      await drawStamp(normalizedPdf, normalizedPage, response, null, index, normalizedFonts, {
        x: 0,
        y: 0,
        width: adaptive.width,
        height: adaptive.height,
      });
      const embeddedStamp = await pdf.embedPage(normalizedPage);
      page.drawPage(embeddedStamp, {
        x,
        y,
        width: stampWidth,
        height: stampHeight,
      });
      return;
    }
  }

  const accent = method === 'autografa' ? green : blue;
  const name = String(response.participante_nombre || 'Firmante');
  const rfc = String(metadata.rfc || 'RFC no disponible');
  const signedAt = formatDate(response.firma_completada_at);
  const ip = String(response.signature_ip || metadata.ip || 'No disponible');
  const verificationUrl = String(metadata.verification_url || 'docubox.mx/verificar-documento');

  if (method === 'efirma') {
    await drawEfirmaStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  if (method === 'autografa' && /^AC[0-5]$/.test(style)) {
    await drawAutografaStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  if (method === 'autografa' && /^AM[1-5]$/.test(style)) {
    await drawAutografaMediumStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  if (method === 'autografa' && /^AL[1-4]$/.test(style)) {
    await drawAutografaLongStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  if (method === 'clicksign' && /^CC[1-5]$/.test(style)) {
    await drawClickSignShortStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  if (method === 'clicksign' && /^CM[1-5]$/.test(style)) {
    await drawClickSignMediumStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  if (method === 'clicksign' && /^CL[1-4]$/.test(style)) {
    await drawClickSignLongStamp({
      pdf,
      page,
      response,
      style,
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      fonts,
    });
    return;
  }

  const compact = stampWidth < 150 || stampHeight < 62;
  const inset = Math.max(4, Math.min(10, stampWidth * 0.05));
  const headerHeight = compact ? 0 : 16;
  page.drawRectangle({
    x,
    y,
    width: stampWidth,
    height: stampHeight,
    color: rgb(1, 1, 1),
    borderColor: accent,
    borderWidth: 0.9,
    opacity: 0.98,
  });
  page.drawRectangle({
    x,
    y,
    width: Math.min(4, Math.max(2, stampWidth * 0.025)),
    height: stampHeight,
    color: accent,
  });
  if (!compact) {
    page.drawText(`DOCUBOX ${style}`, {
      x: x + inset,
      y: y + stampHeight - inset - 8,
      size: Math.min(8, stampHeight * 0.12),
      font: bold,
      color: accent,
    });
  }

  if (method === 'autografa') {
    const source = response.firma_data ? dataUrlToBytes(response.firma_data) : null;
    if (source) {
      try {
        const image =
          source.type === 'png'
            ? await pdf.embedPng(source.bytes)
            : await pdf.embedJpg(source.bytes);
        const footerLines = compact
          ? [name]
          : [name, `SHA-256 ${shortHash(response.signature_hash)}`];
        const footerSize = Math.max(4.2, Math.min(7.5, stampHeight * 0.11));
        const footerHeight = footerLines.length * (footerSize + 2);
        const imageTop = y + stampHeight - inset - headerHeight;
        const imageHeight = Math.max(10, imageTop - (y + inset + footerHeight + 2));
        const imageSize = image.scaleToFit(stampWidth - inset * 2, imageHeight);
        page.drawImage(image, {
          x: x + inset,
          y: y + inset + footerHeight + 2,
          width: imageSize.width,
          height: imageSize.height,
        });
        drawTextLines(
          page,
          footerLines,
          x + inset,
          y + inset + footerHeight - footerSize,
          stampWidth - inset * 2,
          regular,
          footerSize,
          ink
        );
      } catch {
        page.drawText('Trazo de firma disponible', {
          x: x + inset,
          y: y + Math.max(inset, stampHeight / 2),
          size: Math.max(4.2, Math.min(7, stampHeight * 0.11)),
          font: regular,
          color: muted,
        });
      }
    }
    if (!source) {
      const lines = compact ? [name] : [name, `SHA-256 ${shortHash(response.signature_hash)}`];
      drawTextLines(
        page,
        lines,
        x + inset,
        y + inset + (lines.length - 1) * 7,
        stampWidth - inset * 2,
        regular,
        Math.max(4.2, Math.min(7.5, stampHeight * 0.11)),
        ink
      );
    }
    return;
  }

  const lines = [
    name,
    `RFC: ${rfc}`,
    'Aceptacion: confirmada',
    `SHA-256: ${shortHash(response.signature_hash)}`,
    `IP: ${ip}`,
    signedAt,
    verificationUrl,
  ];
  const fontSize = Math.max(4.2, Math.min(7, stampHeight / 13));
  const availableLineCount = Math.max(
    1,
    Math.floor((stampHeight - headerHeight - inset * 2) / (fontSize + 2))
  );
  const compactLines = [name, `SHA-256: ${shortHash(response.signature_hash)}`, verificationUrl];
  const visibleLines =
    lines.length <= availableLineCount ? lines : compactLines.slice(0, availableLineCount);
  drawTextLines(
    page,
    visibleLines,
    x + inset,
    y + stampHeight - inset - headerHeight - fontSize,
    stampWidth - inset * 2,
    regular,
    fontSize,
    ink
  );
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
