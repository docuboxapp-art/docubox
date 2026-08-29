import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_LIMIT = 62;

const COLORS = {
  accent: rgb(30 / 255, 107 / 255, 1),
  accentDark: rgb(20 / 255, 65 / 255, 145 / 255),
  text: rgb(24 / 255, 24 / 255, 27 / 255),
  muted: rgb(82 / 255, 82 / 255, 91 / 255),
  subtle: rgb(113 / 255, 113 / 255, 122 / 255),
  border: rgb(224 / 255, 228 / 255, 236 / 255),
  softBlue: rgb(239 / 255, 246 / 255, 1),
  softGray: rgb(248 / 255, 248 / 255, 251 / 255),
  success: rgb(0 / 255, 153 / 255, 102 / 255),
  softGreen: rgb(236 / 255, 253 / 255, 245 / 255),
  white: rgb(1, 1, 1),
};

export interface Nom151CertificateData {
  logoBytes?: Uint8Array;
  validationCode: string;
  issuedAt: string;
  status: string;
  documentName: string;
  documentId: string;
  folio: string;
  documentStatus: string;
  documentHash: string;
  documentSize: string;
  provider: string;
  endpoint: string;
  signers: Array<{ name: string; email: string }>;
  providerStatus: string;
  messageKey: string;
  providerHash: string;
  asn1Hash: string;
  standard: string;
  certificateType: string;
  algorithm: string;
  verificationUrl: string;
  pscUrl: string;
  representationNotice?: string;
}

type Fonts = { regular: PDFFont; bold: PDFFont };

function text(value: unknown, fallback = 'No disponible') {
  const normalized = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function wrapText(font: PDFFont, value: unknown, size: number, maxWidth: number) {
  const words = text(value).split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(font: PDFFont, value: unknown, size: number, maxWidth: number) {
  const normalized = text(value);
  if (font.widthOfTextAtSize(normalized, size) <= maxWidth) return normalized;
  let shortened = normalized;
  while (shortened.length > 4 && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened.trimEnd()}...`;
}

function drawLogo(page: PDFPage, logo: PDFImage | null, fonts: Fonts) {
  if (logo) {
    const scaled = logo.scaleToFit(126, 29);
    page.drawImage(logo, {
      x: MARGIN,
      y: PAGE_HEIGHT - 35 - scaled.height,
      width: scaled.width,
      height: scaled.height,
    });
    return;
  }
  page.drawText('Docubox', { x: MARGIN, y: PAGE_HEIGHT - 56, size: 22, font: fonts.bold, color: COLORS.text });
}

function drawPageHeader(page: PDFPage, logo: PDFImage | null, fonts: Fonts) {
  drawLogo(page, logo, fonts);
  const badge = 'NOM-151-SCFI-2016';
  const badgeWidth = fonts.bold.widthOfTextAtSize(badge, 7.2) + 20;
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeWidth,
    y: PAGE_HEIGHT - 61,
    width: badgeWidth,
    height: 23,
    color: COLORS.softBlue,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  page.drawText(badge, {
    x: PAGE_WIDTH - MARGIN - badgeWidth + 10,
    y: PAGE_HEIGHT - 53,
    size: 7.2,
    font: fonts.bold,
    color: COLORS.accentDark,
  });
}

function drawFooter(page: PDFPage, logo: PDFImage | null, fonts: Fonts, issuedAt: string, pageNumber: number, pageCount: number) {
  page.drawLine({
    start: { x: MARGIN, y: 42 },
    end: { x: PAGE_WIDTH - MARGIN, y: 42 },
    thickness: 0.7,
    color: COLORS.border,
  });
  if (logo) {
    const scaled = logo.scaleToFit(72, 17);
    page.drawImage(logo, { x: MARGIN, y: 18, width: scaled.width, height: scaled.height });
  } else {
    page.drawText('Docubox', { x: MARGIN, y: 21, size: 11, font: fonts.bold, color: COLORS.text });
  }
  page.drawText(`Emitida: ${text(issuedAt)}`, { x: 198, y: 22, size: 6.4, font: fonts.regular, color: COLORS.subtle });
  page.drawText(`P\u00e1gina ${pageNumber} de ${pageCount}`, {
    x: PAGE_WIDTH - MARGIN - 67,
    y: 22,
    size: 6.4,
    font: fonts.regular,
    color: COLORS.subtle,
  });
}

export async function createNom151Certificate(data: Nom151CertificateData) {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  let logo: PDFImage | null = null;
  if (data.logoBytes) {
    try {
      logo = await pdf.embedPng(data.logoBytes);
    } catch {
      logo = null;
    }
  }

  const qrDataUrl = await QRCode.toDataURL(data.pscUrl, {
    width: 180,
    margin: 1,
    color: { dark: '#1E6BFF', light: '#FFFFFF' },
  });
  const qr = await pdf.embedPng(Uint8Array.from(Buffer.from(qrDataUrl.split(',')[1], 'base64')));

  let page!: PDFPage;
  let y = 0;
  let rowIndex = 0;

  const beginPage = (continuation = false) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageHeader(page, logo, fonts);
    y = PAGE_HEIGHT - 90;
    if (continuation) {
      page.drawText('Constancia de conservaci\u00f3n NOM-151', { x: MARGIN, y, size: 12, font: fonts.bold, color: COLORS.text });
      page.drawText('Continuaci\u00f3n de la evidencia t\u00e9cnica', {
        x: MARGIN,
        y: y - 17,
        size: 7.5,
        font: fonts.regular,
        color: COLORS.muted,
      });
      page.drawLine({
        start: { x: MARGIN, y: y - 29 },
        end: { x: PAGE_WIDTH - MARGIN, y: y - 29 },
        thickness: 1.7,
        color: COLORS.accent,
      });
      y -= 50;
    }
  };

  const ensure = (requiredHeight: number) => {
    if (y - requiredHeight >= FOOTER_LIMIT) return;
    beginPage(true);
  };

  const section = (title: string) => {
    ensure(34);
    page.drawRectangle({ x: MARGIN, y: y - 24, width: CONTENT_WIDTH, height: 24, color: COLORS.softBlue });
    page.drawRectangle({ x: MARGIN, y: y - 24, width: 3, height: 24, color: COLORS.accent });
    page.drawText(title.toUpperCase(), {
      x: MARGIN + 12,
      y: y - 16,
      size: 8.2,
      font: fonts.bold,
      color: COLORS.accentDark,
    });
    y -= 24;
    rowIndex = 0;
  };

  const row = (label: string, value: unknown, options?: { labelWidth?: number; valueSize?: number }) => {
    const labelWidth = options?.labelWidth ?? 164;
    const valueSize = options?.valueSize ?? 7.4;
    const lines = wrapText(fonts.regular, value, valueSize, CONTENT_WIDTH - labelWidth - 20);
    const rowHeight = Math.max(22, lines.length * 10 + 10);
    ensure(rowHeight);
    const rowY = y - rowHeight;
    page.drawRectangle({
      x: MARGIN,
      y: rowY,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: rowIndex % 2 === 0 ? COLORS.white : COLORS.softGray,
      borderColor: COLORS.border,
      borderWidth: 0.35,
    });
    page.drawRectangle({
      x: MARGIN,
      y: rowY,
      width: labelWidth,
      height: rowHeight,
      color: COLORS.softGray,
      borderColor: COLORS.border,
      borderWidth: 0.35,
    });
    page.drawText(label.toUpperCase(), {
      x: MARGIN + 9,
      y: rowY + rowHeight - 14,
      size: 6.6,
      font: fonts.bold,
      color: COLORS.muted,
    });
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN + labelWidth + 9,
        y: rowY + rowHeight - 14 - index * 10,
        size: valueSize,
        font: fonts.regular,
        color: COLORS.text,
      });
    });
    y = rowY;
    rowIndex += 1;
  };

  beginPage();
  page.drawText('Constancia de conservaci\u00f3n NOM-151', { x: MARGIN, y, size: 20, font: fonts.bold, color: COLORS.text });
  page.drawText('Evidencia de conservaci\u00f3n de mensajes de datos emitida por un PSC', {
    x: MARGIN,
    y: y - 20,
    size: 8.8,
    font: fonts.regular,
    color: COLORS.muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: y - 34 },
    end: { x: PAGE_WIDTH - MARGIN, y: y - 34 },
    thickness: 2.2,
    color: COLORS.accent,
  });
  y -= 52;

  ensure(35);
  page.drawRectangle({
    x: MARGIN,
    y: y - 27,
    width: CONTENT_WIDTH,
    height: 27,
    color: COLORS.softGray,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  page.drawText(fitText(
    fonts.bold,
    data.representationNotice || 'Representación informativa Docubox. El artefacto original del PSC se conserva por separado.',
    6.8,
    CONTENT_WIDTH - 20,
  ), {
    x: MARGIN + 10,
    y: y - 17,
    size: 6.8,
    font: fonts.bold,
    color: COLORS.muted,
  });
  y -= 39;

  const gap = 8;
  const cardWidth = (CONTENT_WIDTH - gap * 2) / 3;
  const cards: Array<[string, string, boolean]> = [
    ['C\u00d3DIGO DE VALIDACI\u00d3N', data.validationCode, false],
    ['FECHA DE EMISI\u00d3N', data.issuedAt, false],
    ['ESTATUS', data.status, true],
  ];
  cards.forEach(([label, value, highlighted], index) => {
    const x = MARGIN + index * (cardWidth + gap);
    page.drawRectangle({
      x,
      y: y - 47,
      width: cardWidth,
      height: 47,
      color: highlighted ? COLORS.softGreen : COLORS.softBlue,
      borderColor: COLORS.border,
      borderWidth: 0.75,
    });
    page.drawText(label, { x: x + 10, y: y - 15, size: 6.3, font: fonts.bold, color: COLORS.muted });
    page.drawText(fitText(fonts.bold, value, 7.1, cardWidth - 20), {
      x: x + 10,
      y: y - 32,
      size: 7.1,
      font: fonts.bold,
      color: highlighted ? COLORS.success : COLORS.accentDark,
    });
  });
  y -= 64;

  section('Informaci\u00f3n del documento');
  row('Nombre del documento', data.documentName);
  row('ID del documento', data.documentId);
  row('Folio', data.folio);
  row('Estado', data.documentStatus);
  row('Hash SHA-256 del PDF', data.documentHash, { valueSize: 6.6 });
  row('Tama\u00f1o del PDF', data.documentSize);
  y -= 14;

  section('Solicitud enviada al PSC');
  row('Proveedor', data.provider);
  row('Endpoint', data.endpoint, { valueSize: 6.7 });
  row('N\u00famero de firmantes', String(data.signers.length));
  data.signers.forEach((signer, index) => row(`Firmante ${index + 1}`, `${signer.name} \u00b7 ${signer.email}`));
  y -= 14;

  section('Respuesta del PSC');
  row('C\u00f3digo de validaci\u00f3n', data.validationCode);
  row('Hash del proveedor', data.providerHash, { valueSize: 6.6 });
  row('Estatus del proveedor', data.providerStatus);
  row('Clave de mensaje', data.messageKey);
  row('Hash SHA-256 de constancia .asn1', data.asn1Hash, { valueSize: 6.6 });
  y -= 14;

  ensure(118);
  section('Integridad criptogr\u00e1fica');
  row('Norma aplicable', data.standard);
  row('Tipo de constancia', data.certificateType);
  row('Algoritmo de huella', data.algorithm);
  row('Verificaci\u00f3n Docubox', data.verificationUrl, { valueSize: 6.7 });
  y -= 16;

  ensure(136);
  page.drawRectangle({
    x: MARGIN,
    y: y - 118,
    width: CONTENT_WIDTH,
    height: 118,
    color: COLORS.softBlue,
    borderColor: COLORS.border,
    borderWidth: 0.8,
  });
  page.drawRectangle({ x: MARGIN, y: y - 118, width: 4, height: 118, color: COLORS.accent });
  page.drawText('VALIDACI\u00d3N ANTE EL PRESTADOR DE SERVICIOS DE CERTIFICACI\u00d3N', {
    x: MARGIN + 17,
    y: y - 24,
    size: 7.7,
    font: fonts.bold,
    color: COLORS.accentDark,
  });
  page.drawText('Escanea el c\u00f3digo QR o utiliza el enlace para consultar la constancia.', {
    x: MARGIN + 17,
    y: y - 43,
    size: 7.4,
    font: fonts.regular,
    color: COLORS.muted,
  });
  wrapText(fonts.regular, data.pscUrl, 7.4, 330).forEach((line, index) => {
    page.drawText(line, { x: MARGIN + 17, y: y - 66 - index * 10, size: 7.4, font: fonts.regular, color: COLORS.accentDark });
  });
  page.drawImage(qr, { x: PAGE_WIDTH - MARGIN - 94, y: y - 106, width: 82, height: 82 });
  y -= 134;

  ensure(116);
  section('Fundamento legal');
  const legalLines = [
    'Esta constancia acredita la conservaci\u00f3n del mensaje de datos conforme a la NOM-151-SCFI-2016.',
    'El archivo .asn1 emitido por el PSC contiene la evidencia temporal y criptogr\u00e1fica asociada al documento.',
    'La autenticidad debe comprobarse con el c\u00f3digo de validaci\u00f3n y los controles de integridad incluidos.',
  ];
  page.drawRectangle({
    x: MARGIN,
    y: y - 88,
    width: CONTENT_WIDTH,
    height: 88,
    color: COLORS.softGray,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  legalLines.forEach((line, index) => {
    const lineY = y - 22 - index * 24;
    page.drawCircle({ x: MARGIN + 16, y: lineY + 3, size: 3.2, color: COLORS.accent });
    page.drawText(line, { x: MARGIN + 29, y: lineY, size: 7.2, font: fonts.regular, color: COLORS.text, maxWidth: CONTENT_WIDTH - 43 });
  });

  const pages = pdf.getPages();
  pages.forEach((currentPage, index) => drawFooter(currentPage, logo, fonts, data.issuedAt, index + 1, pages.length));
  return pdf.save();
}
