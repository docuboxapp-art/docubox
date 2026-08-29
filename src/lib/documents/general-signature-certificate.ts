import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

export type GeneralCertificateParticipant = {
  name: string;
  email: string;
  role: string;
  method: string;
  signedAt: string | null;
  status: string;
};

export type GeneralCertificateEvent = {
  label: string;
  occurredAt: string;
  actor: string;
};

export type GeneralCertificateSeal = {
  status: string;
  provider: string;
  identifier: string;
  occurredAt: string | null;
};

export type GeneralCertificateNom151Integrity = {
  certifiedPdfHash: string;
  providerPdfHash: string;
  evidenceFileHash: string;
  validationStatus: string;
};

export type GeneralSignatureCertificateInput = {
  folio: string;
  documentId: string;
  title: string;
  workspaceName: string;
  originalHash: string;
  finalHash: string;
  evidenceHash: string;
  createdAt: string;
  completedAt: string;
  workflowMode: string;
  participants: GeneralCertificateParticipant[];
  certificateId: string;
  verificationUrl: string;
  timestamp: GeneralCertificateSeal;
  nom151: GeneralCertificateSeal;
  nom151Integrity?: GeneralCertificateNom151Integrity;
  certification: GeneralCertificateSeal;
  events: GeneralCertificateEvent[];
  generatedAt?: string;
};

const PAGE_SIZE: [number, number] = [612, 792];
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const COLORS = {
  accent: rgb(30 / 255, 107 / 255, 1),
  accentDark: rgb(11 / 255, 58 / 255, 151 / 255),
  accentSoft: rgb(239 / 255, 245 / 255, 1),
  accentSofter: rgb(247 / 255, 250 / 255, 1),
  ink: rgb(24 / 255, 24 / 255, 27 / 255),
  navy: rgb(15 / 255, 23 / 255, 42 / 255),
  muted: rgb(82 / 255, 82 / 255, 91 / 255),
  subtle: rgb(113 / 255, 113 / 255, 122 / 255),
  line: rgb(226 / 255, 232 / 255, 240 / 255),
  success: rgb(5 / 255, 150 / 255, 105 / 255),
  white: rgb(1, 1, 1),
};

function safeText(value: unknown, fallback = 'No disponible') {
  const normalized = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .trim();
  return normalized || fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return `${new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: true,
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

function fitText(font: PDFFont, value: string, size: number, maxWidth: number) {
  const display = safeText(value);
  if (font.widthOfTextAtSize(display, size) <= maxWidth) return display;
  let shortened = display;
  while (shortened.length > 1 && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}...`;
}

function completeTextSize(font: PDFFont, value: string, preferredSize: number, maxWidth: number, minimumSize = 4.2) {
  const display = safeText(value);
  let size = preferredSize;
  while (size > minimumSize && font.widthOfTextAtSize(display, size) > maxWidth) size -= 0.15;
  return Math.max(size, minimumSize);
}

function splitLines(font: PDFFont, value: string, size: number, maxWidth: number) {
  const words = safeText(value).split(/\s+/);
  const lines: string[] = [];
  let current = '';

  const pushLongWord = (word: string) => {
    let chunk = '';
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) <= maxWidth) {
        chunk += character;
      } else {
        if (chunk) lines.push(chunk);
        chunk = character;
      }
    }
    return chunk;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = font.widthOfTextAtSize(word, size) > maxWidth ? pushLongWord(word) : word;
  }
  if (current) lines.push(current);
  return lines;
}

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  color = COLORS.ink,
  lineHeight = size + 2,
) {
  const lines = splitLines(font, value, size, maxWidth);
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, size, font, color }));
  return y - lines.length * lineHeight;
}

function drawRoundedBox(page: PDFPage, x: number, y: number, width: number, height: number, fill = COLORS.white) {
  page.drawRectangle({ x, y, width, height, color: fill, borderColor: COLORS.line, borderWidth: 0.75 });
}

function drawSectionHeader(page: PDFPage, bold: PDFFont, title: string, y: number) {
  page.drawRectangle({ x: MARGIN, y: y - 23, width: CONTENT_WIDTH, height: 23, color: COLORS.accentSoft, borderColor: COLORS.line, borderWidth: 0.6 });
  page.drawRectangle({ x: MARGIN, y: y - 23, width: 3, height: 23, color: COLORS.accent });
  page.drawText(safeText(title), { x: MARGIN + 11, y: y - 15, size: 8.5, font: bold, color: COLORS.accentDark });
  return y - 31;
}

function drawKeyValueTable(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  rows: Array<[string, string]>,
  y: number,
  options: { rowHeight?: number; labelWidth?: number; valueSize?: number } = {},
) {
  const rowHeight = options.rowHeight ?? 20;
  const labelWidth = options.labelWidth ?? 185;
  const valueSize = options.valueSize ?? 7.35;
  const tableHeight = rows.length * rowHeight;
  page.drawRectangle({ x: MARGIN, y: y - tableHeight, width: CONTENT_WIDTH, height: tableHeight, borderColor: COLORS.line, borderWidth: 0.7 });
  page.drawLine({ start: { x: MARGIN + labelWidth, y }, end: { x: MARGIN + labelWidth, y: y - tableHeight }, thickness: 0.55, color: COLORS.line });
  rows.forEach(([label, value], index) => {
    const rowTop = y - index * rowHeight;
    if (index > 0) page.drawLine({ start: { x: MARGIN, y: rowTop }, end: { x: MARGIN + CONTENT_WIDTH, y: rowTop }, thickness: 0.55, color: COLORS.line });
    page.drawText(fitText(bold, safeText(label).toUpperCase(), 6.5, labelWidth - 18), {
      x: MARGIN + 10,
      y: rowTop - 13,
      size: 6.5,
      font: bold,
      color: COLORS.muted,
    });
    const completeValue = safeText(value);
    const completeValueSize = completeTextSize(regular, completeValue, valueSize, CONTENT_WIDTH - labelWidth - 18);
    page.drawText(completeValue, {
      x: MARGIN + labelWidth + 10,
      y: rowTop - 13,
      size: completeValueSize,
      font: regular,
      color: COLORS.ink,
    });
  });
  return y - tableHeight;
}

function drawHeader(page: PDFPage, logo: PDFImage, regular: PDFFont, bold: PDFFont) {
  const { width, height } = page.getSize();
  const logoWidth = 155;
  const logoHeight = logo.height * (logoWidth / logo.width);
  page.drawImage(logo, { x: MARGIN, y: height - 51, width: logoWidth, height: logoHeight });
  page.drawRectangle({ x: width - MARGIN - 113, y: height - 52, width: 113, height: 28, color: COLORS.accentSoft });
  page.drawText('CONSTANCIA LEGAL', { x: width - MARGIN - 98, y: height - 41, size: 8.1, font: bold, color: COLORS.accentDark });
  page.drawText('Constancia general del proceso de firma', { x: MARGIN, y: height - 91, size: 20, font: bold, color: COLORS.ink });
  page.drawText('Evidencia consolidada del proceso de firma electrónica', { x: MARGIN, y: height - 111, size: 9.7, font: regular, color: COLORS.muted });
  page.drawLine({ start: { x: MARGIN, y: height - 126 }, end: { x: width - MARGIN, y: height - 126 }, thickness: 1.3, color: COLORS.accent });
  return height - 142;
}

function drawTechnicalHeader(page: PDFPage, logo: PDFImage, regular: PDFFont, bold: PDFFont) {
  const { width, height } = page.getSize();
  const logoWidth = 155;
  const logoHeight = logo.height * (logoWidth / logo.width);
  const badgeWidth = 113;
  const badgeX = width - MARGIN - badgeWidth;
  const subtitle = 'Constancia general del proceso de firma';

  page.drawImage(logo, {
    x: MARGIN,
    y: height - 51,
    width: logoWidth,
    height: logoHeight,
  });
  page.drawRectangle({
    x: badgeX,
    y: height - 52,
    width: badgeWidth,
    height: 28,
    color: COLORS.accentSoft,
  });
  page.drawText('CONSTANCIA LEGAL', {
    x: badgeX + 15,
    y: height - 41,
    size: 8.1,
    font: bold,
    color: COLORS.accentDark,
  });
  page.drawText(subtitle, {
    x: width - MARGIN - regular.widthOfTextAtSize(subtitle, 7.1),
    y: height - 68,
    size: 7.1,
    font: regular,
    color: COLORS.muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: height - 76 },
    end: { x: width - MARGIN, y: height - 76 },
    thickness: 1.3,
    color: COLORS.accent,
  });

  return height - 91;
}

function drawMetricIcon(page: PDFPage, x: number, y: number, type: 'document' | 'calendar' | 'people') {
  page.drawRectangle({ x, y, width: 26, height: 26, color: COLORS.accentSoft });
  const cx = x + 13;
  const cy = y + 13;
  if (type === 'document') {
    page.drawRectangle({ x: x + 8, y: y + 6, width: 10, height: 14, borderColor: COLORS.accent, borderWidth: 1 });
    page.drawLine({ start: { x: x + 10, y: y + 15 }, end: { x: x + 16, y: y + 15 }, thickness: 0.8, color: COLORS.accent });
    page.drawLine({ start: { x: x + 10, y: y + 11 }, end: { x: x + 16, y: y + 11 }, thickness: 0.8, color: COLORS.accent });
  } else if (type === 'calendar') {
    page.drawRectangle({ x: x + 6.5, y: y + 6.5, width: 13, height: 13, borderColor: COLORS.accent, borderWidth: 1 });
    page.drawLine({ start: { x: x + 6.5, y: y + 15.5 }, end: { x: x + 19.5, y: y + 15.5 }, thickness: 1, color: COLORS.accent });
    page.drawCircle({ x: cx, y: cy - 1, size: 2.6, borderColor: COLORS.accent, borderWidth: 0.8 });
  } else {
    page.drawCircle({ x: cx - 3.5, y: cy + 3.5, size: 2.4, borderColor: COLORS.accent, borderWidth: 0.9 });
    page.drawCircle({ x: cx + 3.5, y: cy + 3.5, size: 2.4, borderColor: COLORS.accent, borderWidth: 0.9 });
    page.drawCircle({ x: cx, y: cy + 6.5, size: 2.5, borderColor: COLORS.accent, borderWidth: 0.9 });
    page.drawLine({ start: { x: cx - 7, y: cy - 5 }, end: { x: cx + 7, y: cy - 5 }, thickness: 1, color: COLORS.accent });
  }
}

function drawMetricCards(page: PDFPage, regular: PDFFont, bold: PDFFont, input: GeneralSignatureCertificateInput, y: number) {
  const gap = 9;
  const cardWidth = (CONTENT_WIDTH - gap * 2) / 3;
  const cards: Array<{ label: string; value: string; type: 'document' | 'calendar' | 'people' }> = [
    { label: 'FOLIO', value: input.folio, type: 'document' },
    { label: 'COMPLETADO (UTC)', value: formatDate(input.completedAt), type: 'calendar' },
    { label: 'PARTICIPANTES', value: String(input.participants.length), type: 'people' },
  ];
  cards.forEach((card, index) => {
    const x = MARGIN + index * (cardWidth + gap);
    drawRoundedBox(page, x, y - 54, cardWidth, 54, COLORS.white);
    drawMetricIcon(page, x + 9, y - 40, card.type);
    page.drawText(card.label, { x: x + 43, y: y - 18, size: 6.6, font: bold, color: COLORS.accent });
    const valueFont = index === 1 ? regular : bold;
    const valueSize = completeTextSize(valueFont, card.value, 7.6, cardWidth - 52, 4.8);
    page.drawText(safeText(card.value), {
      x: x + 43,
      y: y - 35,
      size: valueSize,
      font: valueFont,
      color: COLORS.ink,
    });
  });
  return y - 68;
}

function drawParticipantTable(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  participants: GeneralCertificateParticipant[],
  y: number,
) {
  const widths = [118, 104, 73, 95, 93, 56];
  const starts = widths.reduce<number[]>((result, width, index) => {
    result.push(index === 0 ? MARGIN : result[index - 1] + widths[index - 1]);
    return result;
  }, []);
  const headers = ['NOMBRE', 'CORREO', 'ROL', 'MÉTODO', 'FIRMADO (UTC)', 'ESTADO'];
  page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_WIDTH, height: 22, color: COLORS.navy });
  headers.forEach((header, index) => page.drawText(header, { x: starts[index] + 7, y: y - 14, size: 5.9, font: bold, color: COLORS.white }));
  y -= 22;
  participants.forEach((participant) => {
    const rowHeight = 34;
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: COLORS.white, borderColor: COLORS.line, borderWidth: 0.5 });
    const values = [
      participant.name,
      participant.email,
      participant.role,
      participant.method,
      participant.signedAt ? formatDate(participant.signedAt) : 'Pendiente',
      participant.status,
    ];
    values.forEach((value, index) => {
      const valueFont = index === 5 && participant.status.toLowerCase() === 'firmado' ? bold : regular;
      const color = index === 5 && participant.status.toLowerCase() === 'firmado' ? COLORS.success : COLORS.ink;
      const lines = splitLines(valueFont, value, 6.1, widths[index] - 13).slice(0, 2);
      lines.forEach((line, lineIndex) => page.drawText(line, {
        x: starts[index] + 7,
        y: y - 13 - lineIndex * 8.5,
        size: 6.1,
        font: valueFont,
        color,
      }));
    });
    y -= rowHeight;
  });
  return y;
}

function drawSealCard(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  x: number,
  y: number,
  width: number,
  title: string,
  seal: GeneralCertificateSeal,
) {
  const height = 93;
  drawRoundedBox(page, x, y - height, width, height, COLORS.white);
  page.drawCircle({ x: x + 17, y: y - 17, size: 7, borderColor: COLORS.accent, borderWidth: 1 });
  page.drawCircle({ x: x + 17, y: y - 17, size: 2, color: COLORS.accent });
  page.drawText(fitText(bold, title, 7.2, width - 39), { x: x + 31, y: y - 19, size: 7.2, font: bold, color: COLORS.accentDark });
  page.drawLine({ start: { x, y: y - 29 }, end: { x: x + width, y: y - 29 }, thickness: 0.5, color: COLORS.line });
  const rows = [
    ['ESTADO', seal.status],
    ['PROVEEDOR', seal.provider],
    ['IDENTIFICADOR', seal.identifier],
    ['FECHA (UTC)', seal.occurredAt ? formatDate(seal.occurredAt) : 'No disponible'],
  ];
  rows.forEach(([label, value], index) => {
    const rowY = y - 42 - index * 12.5;
    page.drawText(label, { x: x + 9, y: rowY, size: 5.6, font: bold, color: COLORS.muted });
    const valueSize = completeTextSize(regular, value, 5.8, width - 82, 4.2);
    page.drawText(safeText(value), { x: x + 72, y: rowY, size: valueSize, font: regular, color: COLORS.ink });
  });
  return y - height;
}

function drawEventTable(page: PDFPage, regular: PDFFont, bold: PDFFont, events: GeneralCertificateEvent[], y: number) {
  const rows = events.slice(0, 5);
  const rowHeight = 18;
  const lineX = MARGIN + 14;
  rows.forEach((event, index) => {
    const rowTop = y - index * rowHeight;
    if (index < rows.length - 1) {
      page.drawLine({ start: { x: lineX, y: rowTop - 9 }, end: { x: lineX, y: rowTop - 27 }, thickness: 0.8, color: COLORS.accent });
    }
    page.drawCircle({ x: lineX, y: rowTop - 9, size: 2.7, color: COLORS.accent });
    page.drawRectangle({ x: MARGIN + 27, y: rowTop - rowHeight, width: CONTENT_WIDTH - 27, height: rowHeight, borderColor: COLORS.line, borderWidth: 0.45 });
    const eventLabelSize = completeTextSize(regular, event.label, 6.2, 220, 4.5);
    page.drawText(safeText(event.label), { x: MARGIN + 36, y: rowTop - 12, size: eventLabelSize, font: regular, color: COLORS.ink });
    const eventDate = formatDate(event.occurredAt);
    const eventDateSize = completeTextSize(regular, eventDate, 6, 155, 4.8);
    page.drawText(eventDate, { x: MARGIN + 260, y: rowTop - 12, size: eventDateSize, font: regular, color: COLORS.ink });
    const eventActorSize = completeTextSize(bold, event.actor, 6, 95, 4.5);
    page.drawText(safeText(event.actor), { x: MARGIN + 430, y: rowTop - 12, size: eventActorSize, font: bold, color: COLORS.muted });
  });
  return y - rows.length * rowHeight;
}

function drawVerificationPanel(
  page: PDFPage,
  qr: PDFImage,
  regular: PDFFont,
  bold: PDFFont,
  input: GeneralSignatureCertificateInput,
  y: number,
) {
  const height = 92;
  drawRoundedBox(page, MARGIN, y - height, CONTENT_WIDTH, height, COLORS.accentSofter);
  page.drawText('VERIFICA LA AUTENTICIDAD DE ESTE DOCUMENTO', { x: MARGIN + 11, y: y - 17, size: 7.7, font: bold, color: COLORS.accentDark });
  drawWrappedText(page, regular, 'Escanea el código QR o consulta la URL para verificar la integridad y autenticidad de este documento.', MARGIN + 11, y - 34, 6.3, 155, COLORS.muted, 8.2);
  const fields = [
    ['URL DE VERIFICACIÓN', input.verificationUrl],
    ['FOLIO DE CONSULTA', input.folio],
    ['ID DEL DOCUMENTO', input.documentId],
    ['ID DE CONSTANCIA', input.certificateId],
  ];
  const fieldPositions = [
    [MARGIN + 183, y - 34],
    [MARGIN + 183, y - 65],
    [MARGIN + 322, y - 34],
    [MARGIN + 322, y - 65],
  ];
  fields.forEach(([label, value], index) => {
    const [x, fieldY] = fieldPositions[index];
    page.drawText(label, { x, y: fieldY, size: 5.5, font: bold, color: COLORS.accent });
    const maxWidth = index < 2 ? 128 : 111;
    if (index === 0) {
      const urlLines = splitLines(regular, safeText(value), 4.7, maxWidth);
      urlLines.forEach((line, lineIndex) => page.drawText(line, {
        x,
        y: fieldY - 10 - lineIndex * 5.2,
        size: 4.7,
        font: regular,
        color: COLORS.ink,
      }));
      return;
    }
    const valueSize = completeTextSize(regular, value, 5.7, maxWidth, 3.7);
    page.drawText(safeText(value), { x, y: fieldY - 10, size: valueSize, font: regular, color: COLORS.ink });
  });
  page.drawImage(qr, { x: MARGIN + CONTENT_WIDTH - 78, y: y - 82, width: 68, height: 68 });
  return y - height;
}

function drawFooter(page: PDFPage, logo: PDFImage, regular: PDFFont, pageNumber: number, totalPages: number, generatedAt: string) {
  const { width } = page.getSize();
  page.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: width - MARGIN, y: 30 }, thickness: 0.6, color: COLORS.line });
  const logoWidth = 80;
  page.drawImage(logo, { x: MARGIN, y: 12, width: logoWidth, height: logo.height * (logoWidth / logo.width) });
  const generated = `Generada automáticamente · ${new Date(generatedAt).toISOString()}`;
  const generatedSize = completeTextSize(regular, generated, 6.4, 255, 5);
  page.drawText(generated, { x: 170, y: 15, size: generatedSize, font: regular, color: COLORS.subtle });
  page.drawText(`Página ${pageNumber} de ${totalPages}`, { x: width - MARGIN - 55, y: 15, size: 6.4, font: regular, color: COLORS.muted });
}

async function loadBrandLogo(pdf: PDFDocument) {
  const bytes = await readFile(join(process.cwd(), 'public', 'assets', 'images', 'docubox-logo-2026.png'));
  return pdf.embedPng(bytes);
}

export async function buildGeneralSignatureCertificate(input: GeneralSignatureCertificateInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadBrandLogo(pdf);
  const qrDataUrl = await QRCode.toDataURL(input.verificationUrl, {
    margin: 1,
    width: 220,
    errorCorrectionLevel: 'M',
    color: { dark: '#1E6BFF', light: '#FFFFFF' },
  });
  const qrBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
  const qr = await pdf.embedPng(qrBytes);
  const pages: PDFPage[] = [];

  const firstPage = pdf.addPage(PAGE_SIZE);
  pages.push(firstPage);
  let y = drawHeader(firstPage, logo, regular, bold);
  firstPage.drawRectangle({ x: MARGIN, y: y - 30, width: CONTENT_WIDTH, height: 30, color: COLORS.accentSoft, borderColor: COLORS.line, borderWidth: 0.6 });
  firstPage.drawText('DOCUMENTO COMPARTIDO ENTRE LAS PARTES', { x: MARGIN + 12, y: y - 19, size: 7.2, font: bold, color: COLORS.accentDark });
  const status = 'ESTADO: COMPLETADO';
  firstPage.drawText(status, { x: MARGIN + CONTENT_WIDTH - bold.widthOfTextAtSize(status, 7.2) - 12, y: y - 19, size: 7.2, font: bold, color: COLORS.accent });
  y -= 43;
  y = drawMetricCards(firstPage, regular, bold, input, y);
  y = drawSectionHeader(firstPage, bold, 'Datos del documento', y);
  y = drawKeyValueTable(firstPage, regular, bold, [
    ['Identificador', input.documentId],
    ['Título', input.title],
    ['Espacio de trabajo', input.workspaceName],
    ['SHA-256 del documento', input.finalHash],
    ['Creado', formatDate(input.createdAt)],
  ], y, { rowHeight: 19 });
  y -= 10;
  y = drawSectionHeader(firstPage, bold, 'Resumen del proceso', y);
  const signedCount = input.participants.filter((participant) => participant.status.toLowerCase() === 'firmado').length;
  y = drawKeyValueTable(firstPage, regular, bold, [
    ['Modalidad', input.workflowMode],
    ['Firmas completadas', `${signedCount} de ${input.participants.length}`],
    ['Estado', 'COMPLETADO'],
    ['Inicio del expediente', formatDate(input.createdAt)],
    ['Finalización', formatDate(input.completedAt)],
  ], y, { rowHeight: 18 });
  y -= 10;
  y = drawSectionHeader(firstPage, bold, 'Participantes y estado de firma', y);
  const firstPageParticipants = input.participants.slice(0, 4);
  y = drawParticipantTable(firstPage, regular, bold, firstPageParticipants, y);
  firstPage.drawText('Los correos se muestran parcialmente enmascarados para proteger los datos personales de las personas participantes.', {
    x: MARGIN + 1,
    y: y - 13,
    size: 6.2,
    font: regular,
    color: COLORS.muted,
  });

  const remainingParticipants = input.participants.slice(4);
  for (let offset = 0; offset < remainingParticipants.length; offset += 14) {
    const continuation = pdf.addPage(PAGE_SIZE);
    pages.push(continuation);
    let continuationY = drawHeader(continuation, logo, regular, bold);
    continuationY = drawSectionHeader(continuation, bold, 'Participantes y estado de firma (continuación)', continuationY);
    drawParticipantTable(continuation, regular, bold, remainingParticipants.slice(offset, offset + 14), continuationY);
  }

  const technicalPage = pdf.addPage(PAGE_SIZE);
  pages.push(technicalPage);
  y = drawTechnicalHeader(technicalPage, logo, regular, bold);
  y = drawSectionHeader(technicalPage, bold, 'Integridad documental', y);
  const integrityRows: Array<[string, string]> = [
    ['SHA-256 del documento original', input.originalHash],
    ['SHA-256 del documento final firmado', input.finalHash],
    ['SHA-256 del expediente de evidencia', input.evidenceHash],
    ['Algoritmo', 'SHA-256'],
    ['Versión del expediente', '1.0'],
    ['ID de constancia general', input.certificateId],
  ];
  if (input.nom151Integrity) {
    integrityRows.splice(3, 0,
      ['SHA-256 del PDF enviado al PSC', input.nom151Integrity.certifiedPdfHash],
      ['SHA-256 reportado por el PSC', input.nom151Integrity.providerPdfHash],
      ['SHA-256 de la constancia NOM-151', input.nom151Integrity.evidenceFileHash],
      ['Validación del hash NOM-151', input.nom151Integrity.validationStatus],
    );
  }
  y = drawKeyValueTable(technicalPage, regular, bold, integrityRows, y, { rowHeight: 14.2, labelWidth: 205, valueSize: 6.05 });
  y -= 8;
  y = drawSectionHeader(technicalPage, bold, 'Sellado y certificación', y);
  const gap = 10;
  const sealWidth = (CONTENT_WIDTH - gap * 2) / 3;
  drawSealCard(technicalPage, regular, bold, MARGIN, y, sealWidth, 'SELLO DE TIEMPO RFC 3161', input.timestamp);
  drawSealCard(technicalPage, regular, bold, MARGIN + sealWidth + gap, y, sealWidth, 'NOM-151-SCFI-2016', input.nom151);
  drawSealCard(technicalPage, regular, bold, MARGIN + (sealWidth + gap) * 2, y, sealWidth, 'CERTIFICACIÓN DOCUBOX', input.certification);
  y -= 101;
  y = drawSectionHeader(technicalPage, bold, 'Eventos principales del proceso', y);
  y = drawEventTable(technicalPage, regular, bold, input.events, y);
  y -= 10;
  y = drawVerificationPanel(technicalPage, qr, regular, bold, input, y);
  y -= 10;
  y = drawSectionHeader(technicalPage, bold, 'Fundamento y alcance', y);
  const legalItems = [
    'Esta constancia acredita la finalización del proceso de firma electrónica registrado en Docubox.',
    'La integridad del documento y del expediente puede verificarse mediante las huellas criptográficas y el portal indicado.',
    'Las evidencias electrónicas se conservan conforme a las políticas aplicables y, cuando corresponda, mediante RFC 3161 o NOM-151-SCFI-2016.',
    'Los datos personales se tratan conforme a la LFPDPPP y su divulgación no autorizada está prohibida.',
    'Fundamento: Código de Comercio (Arts. 89-97), LFEA, NOM-151-SCFI-2016 y demás disposiciones aplicables.',
  ];
  const legalBoxHeight = 72;
  drawRoundedBox(technicalPage, MARGIN, y - legalBoxHeight, CONTENT_WIDTH, legalBoxHeight, COLORS.white);
  y -= 14;
  legalItems.forEach((item) => {
    technicalPage.drawCircle({ x: MARGIN + 15, y: y + 2.15, size: 1.55, color: COLORS.accent });
    y = drawWrappedText(technicalPage, regular, item, MARGIN + 25, y, 6.5, CONTENT_WIDTH - 39, COLORS.ink, 8.25) - 1.2;
  });

  const generatedAt = input.generatedAt || new Date().toISOString();
  pages.forEach((page, index) => drawFooter(page, logo, regular, index + 1, pages.length, generatedAt));
  pdf.setTitle(`Constancia general del proceso de firma - ${input.title}`);
  pdf.setAuthor('Docubox');
  pdf.setSubject('Evidencia consolidada del proceso de firma electrónica');
  pdf.setCreator('Docubox');
  pdf.setProducer('Docubox');
  pdf.setCreationDate(new Date(generatedAt));
  return pdf.save();
}
