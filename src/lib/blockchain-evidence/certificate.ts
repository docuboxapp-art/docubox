import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import QRCode from 'qrcode';

const PAGE_SIZE: [number, number] = [612, 792];
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const COLORS = {
  accent: rgb(30 / 255, 107 / 255, 1),
  accentDark: rgb(11 / 255, 58 / 255, 151 / 255),
  accentSoft: rgb(239 / 255, 245 / 255, 1),
  accentSofter: rgb(247 / 255, 250 / 255, 1),
  ink: rgb(24 / 255, 24 / 255, 27 / 255),
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
    hour12: true,
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

function completeTextSize(
  font: PDFFont,
  value: string,
  preferredSize: number,
  maxWidth: number,
  minimumSize = 4.8
) {
  let size = preferredSize;
  while (size > minimumSize && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.1;
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
  lineHeight = size + 2
) {
  const lines = splitLines(font, value, size, maxWidth);
  lines.forEach((line, index) =>
    page.drawText(line, { x, y: y - index * lineHeight, size, font, color })
  );
  return y - lines.length * lineHeight;
}

function drawBox(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = COLORS.white
) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: fill,
    borderColor: COLORS.line,
    borderWidth: 0.75,
  });
}

function drawHeader(page: PDFPage, logo: PDFImage, regular: PDFFont, bold: PDFFont) {
  const { width, height } = page.getSize();
  const logoWidth = 155;
  page.drawImage(logo, {
    x: MARGIN,
    y: height - 51,
    width: logoWidth,
    height: logo.height * (logoWidth / logo.width),
  });
  const badgeWidth = 136;
  const badgeX = width - MARGIN - badgeWidth;
  page.drawRectangle({
    x: badgeX,
    y: height - 52,
    width: badgeWidth,
    height: 28,
    color: COLORS.accentSoft,
  });
  page.drawText('EVIDENCIA BLOCKCHAIN', {
    x: badgeX + 13,
    y: height - 41,
    size: 7.7,
    font: bold,
    color: COLORS.accentDark,
  });
  page.drawText('Constancia de Anclaje Criptográfico en Bitcoin', {
    x: MARGIN,
    y: height - 91,
    size: 19,
    font: bold,
    color: COLORS.ink,
  });
  page.drawText('Evidencia criptográfica verificable mediante OpenTimestamps y la red Bitcoin', {
    x: MARGIN,
    y: height - 111,
    size: 9.2,
    font: regular,
    color: COLORS.muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: height - 126 },
    end: { x: width - MARGIN, y: height - 126 },
    thickness: 1.3,
    color: COLORS.accent,
  });
  return height - 142;
}

function drawSectionHeader(page: PDFPage, bold: PDFFont, title: string, y: number) {
  page.drawRectangle({
    x: MARGIN,
    y: y - 23,
    width: CONTENT_WIDTH,
    height: 23,
    color: COLORS.accentSoft,
    borderColor: COLORS.line,
    borderWidth: 0.6,
  });
  page.drawRectangle({ x: MARGIN, y: y - 23, width: 3, height: 23, color: COLORS.accent });
  page.drawText(title, {
    x: MARGIN + 11,
    y: y - 15,
    size: 8.5,
    font: bold,
    color: COLORS.accentDark,
  });
  return y - 31;
}

function drawStatusBand(page: PDFPage, bold: PDFFont, y: number) {
  page.drawRectangle({
    x: MARGIN,
    y: y - 30,
    width: CONTENT_WIDTH,
    height: 30,
    color: COLORS.accentSofter,
    borderColor: COLORS.line,
    borderWidth: 0.6,
  });
  page.drawCircle({ x: MARGIN + 16, y: y - 15, size: 7, color: COLORS.success });
  page.drawLine({
    start: { x: MARGIN + 12.5, y: y - 15 },
    end: { x: MARGIN + 15, y: y - 18 },
    thickness: 1.2,
    color: COLORS.white,
  });
  page.drawLine({
    start: { x: MARGIN + 15, y: y - 18 },
    end: { x: MARGIN + 20, y: y - 11.5 },
    thickness: 1.2,
    color: COLORS.white,
  });
  page.drawText('ANCLAJE BITCOIN VERIFICADO', {
    x: MARGIN + 31,
    y: y - 19,
    size: 7.5,
    font: bold,
    color: COLORS.success,
  });
  const state = 'ESTADO CRIPTOGRÁFICO: VERIFICADO';
  page.drawText(state, {
    x: MARGIN + CONTENT_WIDTH - bold.widthOfTextAtSize(state, 7.2) - 12,
    y: y - 19,
    size: 7.2,
    font: bold,
    color: COLORS.accentDark,
  });
  return y - 43;
}

function drawMetricCards(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  metrics: Array<[string, string]>,
  y: number
) {
  const gap = 9;
  const width = (CONTENT_WIDTH - gap * 2) / 3;
  metrics.forEach(([label, value], index) => {
    const x = MARGIN + index * (width + gap);
    drawBox(page, x, y - 50, width, 50);
    page.drawRectangle({ x: x + 9, y: y - 37, width: 25, height: 25, color: COLORS.accentSoft });
    page.drawCircle({
      x: x + 21.5,
      y: y - 24.5,
      size: 5.5,
      borderColor: COLORS.accent,
      borderWidth: 1,
    });
    page.drawCircle({ x: x + 21.5, y: y - 24.5, size: 1.8, color: COLORS.accent });
    page.drawText(label, { x: x + 43, y: y - 18, size: 6.4, font: bold, color: COLORS.accent });
    const display = safeText(value);
    const valueSize = completeTextSize(regular, display, 7.2, width - 52, 4.7);
    page.drawText(display, {
      x: x + 43,
      y: y - 34,
      size: valueSize,
      font: regular,
      color: COLORS.ink,
    });
  });
  return y - 63;
}

function drawKeyValueTable(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  mono: PDFFont,
  rows: Array<{ label: string; value: string; monospaced?: boolean }>,
  y: number,
  options: { rowHeight?: number; labelWidth?: number; valueSize?: number } = {}
) {
  const rowHeight = options.rowHeight ?? 17;
  const labelWidth = options.labelWidth ?? 177;
  const tableHeight = rows.length * rowHeight;
  page.drawRectangle({
    x: MARGIN,
    y: y - tableHeight,
    width: CONTENT_WIDTH,
    height: tableHeight,
    borderColor: COLORS.line,
    borderWidth: 0.7,
  });
  page.drawLine({
    start: { x: MARGIN + labelWidth, y },
    end: { x: MARGIN + labelWidth, y: y - tableHeight },
    thickness: 0.55,
    color: COLORS.line,
  });
  rows.forEach((row, index) => {
    const rowTop = y - index * rowHeight;
    if (index > 0)
      page.drawLine({
        start: { x: MARGIN, y: rowTop },
        end: { x: MARGIN + CONTENT_WIDTH, y: rowTop },
        thickness: 0.55,
        color: COLORS.line,
      });
    page.drawText(row.label.toUpperCase(), {
      x: MARGIN + 10,
      y: rowTop - 11.5,
      size: 6.2,
      font: bold,
      color: COLORS.muted,
    });
    const value = safeText(row.value);
    const valueFont = row.monospaced ? mono : regular;
    const preferredSize = row.monospaced ? 6 : (options.valueSize ?? 7.1);
    const valueSize = completeTextSize(
      valueFont,
      value,
      preferredSize,
      CONTENT_WIDTH - labelWidth - 19,
      4.7
    );
    page.drawText(value, {
      x: MARGIN + labelWidth + 10,
      y: rowTop - 11.5,
      size: valueSize,
      font: valueFont,
      color: COLORS.ink,
    });
  });
  return y - tableHeight;
}

function drawVerificationPanel(
  page: PDFPage,
  qr: PDFImage,
  regular: PDFFont,
  bold: PDFFont,
  verificationUrl: string,
  publicToken: string,
  y: number
) {
  const height = 88;
  drawBox(page, MARGIN, y - height, CONTENT_WIDTH, height, COLORS.accentSofter);
  page.drawText('VERIFICA LA INTEGRIDAD DE ESTA EVIDENCIA', {
    x: MARGIN + 11,
    y: y - 17,
    size: 7.7,
    font: bold,
    color: COLORS.accentDark,
  });
  drawWrappedText(
    page,
    regular,
    'Escanea el código QR o consulta la dirección para revisar la prueba OpenTimestamps y su anclaje Bitcoin.',
    MARGIN + 11,
    y - 34,
    6.3,
    155,
    COLORS.muted,
    8.2
  );
  const valueX = MARGIN + 183;
  page.drawText('URL DE VERIFICACIÓN', {
    x: valueX,
    y: y - 29,
    size: 5.5,
    font: bold,
    color: COLORS.accent,
  });
  drawWrappedText(page, regular, verificationUrl, valueX, y - 39, 5, 273, COLORS.ink, 6.2);
  page.drawText('ID PÚBLICO VERIFICABLE', {
    x: valueX,
    y: y - 64,
    size: 5.5,
    font: bold,
    color: COLORS.accent,
  });
  const tokenSize = completeTextSize(regular, publicToken, 5.5, 273, 4.5);
  page.drawText(publicToken, {
    x: valueX,
    y: y - 75,
    size: tokenSize,
    font: regular,
    color: COLORS.ink,
  });
  page.drawImage(qr, { x: MARGIN + CONTENT_WIDTH - 78, y: y - 78, width: 68, height: 68 });
  return y - height;
}

function drawScope(page: PDFPage, regular: PDFFont, bold: PDFFont, y: number) {
  y = drawSectionHeader(page, bold, 'Alcance de esta constancia', y);
  const height = 67;
  drawBox(page, MARGIN, y - height, CONTENT_WIDTH, height);
  const paragraphs = [
    'Esta constancia acredita la existencia de una evidencia criptográfica asociada al documento y su anclaje verificable mediante OpenTimestamps sobre la red Bitcoin.',
    'No sustituye por sí misma otros mecanismos de firma electrónica, sellado de tiempo, conservación o certificación aplicables. OpenTimestamps no actúa como autoridad certificadora y Bitcoin no certifica identidad, consentimiento ni validez jurídica.',
  ];
  let cursor = y - 14;
  for (const paragraph of paragraphs) {
    page.drawCircle({ x: MARGIN + 15, y: cursor + 2.1, size: 1.5, color: COLORS.accent });
    cursor =
      drawWrappedText(
        page,
        regular,
        paragraph,
        MARGIN + 25,
        cursor,
        6.4,
        CONTENT_WIDTH - 39,
        COLORS.ink,
        8.1
      ) - 2;
  }
  return y - height;
}

function drawFooter(page: PDFPage, logo: PDFImage, regular: PDFFont, verifiedAt: string) {
  const { width } = page.getSize();
  page.drawLine({
    start: { x: MARGIN, y: 30 },
    end: { x: width - MARGIN, y: 30 },
    thickness: 0.6,
    color: COLORS.line,
  });
  const logoWidth = 80;
  page.drawImage(logo, {
    x: MARGIN,
    y: 12,
    width: logoWidth,
    height: logo.height * (logoWidth / logo.width),
  });
  const generated = `Verificación completada · ${new Date(verifiedAt).toISOString()}`;
  const size = completeTextSize(regular, generated, 6.4, 280, 5);
  page.drawText(generated, { x: 170, y: 15, size, font: regular, color: COLORS.subtle });
  page.drawText('Página 1 de 1', {
    x: width - MARGIN - 55,
    y: 15,
    size: 6.4,
    font: regular,
    color: COLORS.muted,
  });
}

async function loadBrandLogo(pdf: PDFDocument) {
  const bytes = await readFile(
    join(process.cwd(), 'public', 'assets', 'images', 'docubox-logo-2026.png')
  );
  return pdf.embedPng(bytes);
}

export async function createBitcoinAnchorCertificate(input: {
  publicToken: string;
  documentHash: string;
  manifestHash: string;
  proofHash: string;
  blockHeight: number;
  blockHash: string | null;
  attestedAt: string | null;
  verifiedAt: string;
  verificationUrl: string;
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const logo = await loadBrandLogo(pdf);
  const qrData = await QRCode.toDataURL(input.verificationUrl, {
    margin: 1,
    width: 220,
    errorCorrectionLevel: 'M',
    color: { dark: '#1E6BFF', light: '#FFFFFF' },
  });
  const qr = await pdf.embedPng(Buffer.from(qrData.split(',')[1], 'base64'));
  const page = pdf.addPage(PAGE_SIZE);
  const year = new Date(input.verifiedAt).getUTCFullYear();
  const folio = `DBX-BTC-${year}-${input.publicToken.slice(0, 8).toUpperCase()}`;

  let y = drawHeader(page, logo, regular, bold);
  y = drawStatusBand(page, bold, y);
  y = drawMetricCards(
    page,
    regular,
    bold,
    [
      ['FOLIO', folio],
      ['VERIFICADO (UTC)', formatDate(input.verifiedAt)],
      ['BLOQUE BITCOIN', String(input.blockHeight)],
    ],
    y
  );
  y = drawSectionHeader(page, bold, 'Identificación de la evidencia', y);
  y = drawKeyValueTable(
    page,
    regular,
    bold,
    mono,
    [
      { label: 'ID público verificable', value: input.publicToken },
      { label: 'Documento', value: 'Documento electrónico Docubox' },
      { label: 'Protocolo y blockchain', value: 'OpenTimestamps / Bitcoin' },
      { label: 'Algoritmo', value: 'SHA-256' },
      { label: 'Formato de prueba', value: 'OpenTimestamps (.ots)' },
      {
        label: 'Fecha acreditada por la prueba',
        value: formatDate(input.attestedAt || input.verifiedAt),
      },
    ],
    y,
    { rowHeight: 16.5 }
  );
  y -= 8;
  y = drawSectionHeader(page, bold, 'Valores criptográficos completos', y);
  y = drawKeyValueTable(
    page,
    regular,
    bold,
    mono,
    [
      { label: 'SHA-256 del documento', value: input.documentHash, monospaced: true },
      { label: 'SHA-256 del manifiesto', value: input.manifestHash, monospaced: true },
      { label: 'SHA-256 de la prueba .ots', value: input.proofHash, monospaced: true },
      {
        label: 'Hash del bloque Bitcoin',
        value: input.blockHash || 'No persistido en este modo de verificación',
        monospaced: Boolean(input.blockHash),
      },
    ],
    y,
    { rowHeight: 21, labelWidth: 177, valueSize: 6 }
  );
  y -= 8;
  y = drawVerificationPanel(page, qr, regular, bold, input.verificationUrl, input.publicToken, y);
  y -= 8;
  drawScope(page, regular, bold, y);
  drawFooter(page, logo, regular, input.verifiedAt);

  pdf.setTitle('Constancia de Anclaje Criptográfico en Bitcoin');
  pdf.setAuthor('Docubox');
  pdf.setSubject('Evidencia criptográfica OpenTimestamps anclada en Bitcoin');
  pdf.setCreator('Docubox');
  pdf.setProducer('Docubox');
  pdf.setCreationDate(new Date(input.verifiedAt));
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}
