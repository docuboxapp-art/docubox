import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type PDFPage } from 'pdf-lib';

export type AuditClosureEvent = {
  occurredAt: string;
  action: string;
  description: string;
  actor: string;
  actorEmail?: string;
  actorRole?: string;
  result: string;
  ipAddress?: string;
  source: string;
};

export type AuditClosureCertificateInput = {
  documentId: string;
  documentFolio: string;
  title: string;
  workspaceName: string;
  status: string;
  createdAt: string;
  completedAt: string;
  originalHash: string;
  finalHash: string;
  auditChainHash: string;
  verificationUrl: string;
  events: AuditClosureEvent[];
  generatedAt?: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLORS = {
  accent: rgb(30 / 255, 107 / 255, 1),
  accentDark: rgb(20 / 255, 65 / 255, 145 / 255),
  softBlue: rgb(239 / 255, 246 / 255, 1),
  ink: rgb(24 / 255, 24 / 255, 27 / 255),
  muted: rgb(82 / 255, 82 / 255, 91 / 255),
  subtle: rgb(113 / 255, 113 / 255, 122 / 255),
  line: rgb(224 / 255, 228 / 255, 236 / 255),
  success: rgb(5 / 255, 150 / 255, 105 / 255),
  navy: rgb(15 / 255, 23 / 255, 42 / 255),
  white: rgb(1, 1, 1),
};

function text(value: unknown, fallback = 'No disponible') {
  const normalized = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .trim();
  return normalized || fallback;
}

function formatUtc(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return `${new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

function wrap(font: PDFFont, value: string, size: number, width: number) {
  const words = text(value).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['No disponible'];
}

function fit(font: PDFFont, value: string, size: number, width: number) {
  let result = text(value);
  while (result.length > 1 && font.widthOfTextAtSize(result, size) > width) result = result.slice(0, -1);
  return result === text(value) ? result : `${result.slice(0, -3)}...`;
}

function drawLogo(page: PDFPage, logo: PDFImage | null, bold: PDFFont) {
  if (logo) {
    const size = logo.scaleToFit(145, 38);
    page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - 48, width: size.width, height: size.height });
  } else {
    page.drawText('Docubox', { x: MARGIN, y: PAGE_HEIGHT - 43, size: 24, font: bold, color: COLORS.ink });
  }
}

function drawHeader(page: PDFPage, logo: PDFImage | null, regular: PDFFont, bold: PDFFont, pageNumber: number) {
  drawLogo(page, logo, bold);
  const badge = 'REGISTRO DE AUDITORIA';
  const badgeWidth = bold.widthOfTextAtSize(badge, 8) + 24;
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeWidth,
    y: PAGE_HEIGHT - 52,
    width: badgeWidth,
    height: 28,
    color: COLORS.softBlue,
    borderColor: COLORS.line,
    borderWidth: 0.6,
  });
  page.drawText(badge, {
    x: PAGE_WIDTH - MARGIN - badgeWidth + 12,
    y: PAGE_HEIGHT - 41,
    size: 8,
    font: bold,
    color: COLORS.accentDark,
  });
  page.drawText('Constancia de auditoría hasta el cierre', {
    x: MARGIN,
    y: PAGE_HEIGHT - 92,
    size: 19,
    font: bold,
    color: COLORS.ink,
  });
  page.drawText('Historial verificable de actividad y cierre documental', {
    x: MARGIN,
    y: PAGE_HEIGHT - 112,
    size: 9.5,
    font: regular,
    color: COLORS.muted,
  });
  page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - 127 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 127 },
    thickness: 1.3,
    color: COLORS.accent,
  });
  page.drawLine({
    start: { x: MARGIN, y: 29 },
    end: { x: PAGE_WIDTH - MARGIN, y: 29 },
    thickness: 0.7,
    color: COLORS.line,
  });
  if (logo) {
    const footerLogo = logo.scaleToFit(73, 17);
    page.drawImage(logo, { x: MARGIN, y: 18, width: footerLogo.width, height: footerLogo.height });
  } else {
    page.drawText('Docubox', { x: MARGIN, y: 16, size: 11, font: bold, color: COLORS.ink });
  }
  page.drawText('Registro de auditoría hasta el cierre', { x: 207, y: 16, size: 7.2, font: regular, color: COLORS.subtle });
  const pageLabel = `Página ${pageNumber}`;
  page.drawText(pageLabel, {
    x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageLabel, 7.2),
    y: 16,
    size: 7.2,
    font: regular,
    color: COLORS.subtle,
  });
  return PAGE_HEIGHT - 151;
}

function sectionHeader(page: PDFPage, bold: PDFFont, title: string, y: number) {
  page.drawRectangle({ x: MARGIN, y: y - 23, width: CONTENT_WIDTH, height: 23, color: COLORS.softBlue, borderColor: COLORS.line, borderWidth: 0.6 });
  page.drawRectangle({ x: MARGIN, y: y - 23, width: 3, height: 23, color: COLORS.accent });
  page.drawText(text(title), { x: MARGIN + 12, y: y - 15, size: 9, font: bold, color: COLORS.accentDark });
  return y - 32;
}

function keyValueTable(page: PDFPage, regular: PDFFont, bold: PDFFont, rows: Array<[string, string]>, y: number) {
  const labelWidth = 178;
  const rowHeight = 21;
  const height = rows.length * rowHeight;
  page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT_WIDTH, height, borderColor: COLORS.line, borderWidth: 0.7 });
  page.drawLine({ start: { x: MARGIN + labelWidth, y }, end: { x: MARGIN + labelWidth, y: y - height }, thickness: 0.55, color: COLORS.line });
  rows.forEach(([label, value], index) => {
    const rowY = y - index * rowHeight;
    if (index) page.drawLine({ start: { x: MARGIN, y: rowY }, end: { x: MARGIN + CONTENT_WIDTH, y: rowY }, thickness: 0.55, color: COLORS.line });
    page.drawText(fit(bold, label.toUpperCase(), 6.7, labelWidth - 18), { x: MARGIN + 10, y: rowY - 14, size: 6.7, font: bold, color: COLORS.muted });
    const valueLines = wrap(regular, value, 7.2, CONTENT_WIDTH - labelWidth - 18).slice(0, 2);
    valueLines.forEach((line, lineIndex) => page.drawText(line, { x: MARGIN + labelWidth + 10, y: rowY - 14 - lineIndex * 8, size: 7.2, font: regular, color: COLORS.ink }));
  });
  return y - height;
}

function drawEvents(page: PDFPage, regular: PDFFont, bold: PDFFont, events: AuditClosureEvent[], y: number) {
  const cols = { date: 95, event: 220, actor: 125 };
  const headerHeight = 22;
  page.drawRectangle({ x: MARGIN, y: y - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: COLORS.navy });
  page.drawText('FECHA UTC', { x: MARGIN + 9, y: y - 14, size: 6.7, font: bold, color: COLORS.white });
  page.drawText('EVENTO', { x: MARGIN + cols.date + 9, y: y - 14, size: 6.7, font: bold, color: COLORS.white });
  page.drawText('ACTOR / RESULTADO', { x: MARGIN + cols.date + cols.event + 9, y: y - 14, size: 6.7, font: bold, color: COLORS.white });
  let cursor = y - headerHeight;
  for (const event of events) {
    const eventLines = wrap(regular, event.description || event.action, 7.1, cols.event - 18).slice(0, 3);
    const actorLines = wrap(regular, `${event.actor} · ${event.result}${event.ipAddress ? ` · IP ${event.ipAddress}` : ''}`, 6.8, cols.actor - 14).slice(0, 3);
    const rowHeight = Math.max(25, Math.max(eventLines.length, actorLines.length) * 8 + 10);
    page.drawRectangle({ x: MARGIN, y: cursor - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: COLORS.white, borderColor: COLORS.line, borderWidth: 0.55 });
    page.drawLine({ start: { x: MARGIN + cols.date, y: cursor }, end: { x: MARGIN + cols.date, y: cursor - rowHeight }, thickness: 0.55, color: COLORS.line });
    page.drawLine({ start: { x: MARGIN + cols.date + cols.event, y: cursor }, end: { x: MARGIN + cols.date + cols.event, y: cursor - rowHeight }, thickness: 0.55, color: COLORS.line });
    page.drawText(formatUtc(event.occurredAt), { x: MARGIN + 9, y: cursor - 13, size: 6.3, font: regular, color: COLORS.muted });
    eventLines.forEach((line, index) => page.drawText(line, { x: MARGIN + cols.date + 9, y: cursor - 13 - index * 8, size: 7.1, font: regular, color: COLORS.ink }));
    actorLines.forEach((line, index) => page.drawText(line, { x: MARGIN + cols.date + cols.event + 9, y: cursor - 13 - index * 8, size: 6.8, font: regular, color: index === 0 && event.result.toLowerCase() === 'exitoso' ? COLORS.success : COLORS.muted }));
    cursor -= rowHeight;
  }
  return cursor;
}

async function loadLogo(pdf: PDFDocument) {
  try {
    const bytes = await readFile(join(process.cwd(), 'public', 'assets', 'images', 'docubox-logo-2026.png'));
    return pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

export async function buildAuditClosureCertificate(input: AuditClosureCertificateInput) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Constancia de auditoría hasta el cierre - ${text(input.title)}`);
  pdf.setAuthor('Docubox');
  pdf.setSubject('Registro verificable de auditoría documental');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);
  const generatedAt = input.generatedAt || new Date().toISOString();
  const events = input.events.length ? input.events : [{
    occurredAt: input.createdAt,
    action: 'documento_creado',
    description: 'Documento creado',
    actor: 'Docubox',
    result: 'exitoso',
    source: 'document',
  }];

  let pageNumber = 1;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = drawHeader(page, logo, regular, bold, pageNumber);

  y = sectionHeader(page, bold, 'Resumen del documento', y);
  y = keyValueTable(page, regular, bold, [
    ['Título', text(input.title)],
    ['Identificador', text(input.documentId)],
    ['Folio', text(input.documentFolio)],
    ['Espacio de trabajo', text(input.workspaceName)],
    ['Estado al cierre', text(input.status)],
    ['Creado (UTC)', formatUtc(input.createdAt)],
    ['Completado (UTC)', formatUtc(input.completedAt)],
  ], y) - 18;

  y = sectionHeader(page, bold, 'Historial de actividad y auditoría', y);
  y = drawEvents(page, regular, bold, events, y) - 18;

  if (y < 235) {
    pageNumber += 1;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = drawHeader(page, logo, regular, bold, pageNumber);
  }

  y = sectionHeader(page, bold, 'Cierre e integridad documental', y);
  y = keyValueTable(page, regular, bold, [
    ['Estado final', text(input.status)],
    ['Hash SHA-256 original', text(input.originalHash)],
    ['Hash SHA-256 final', text(input.finalHash)],
    ['Hash de la cadena de auditoría', text(input.auditChainHash)],
    ['URL de verificación', text(input.verificationUrl)],
  ], y) - 18;

  page.drawRectangle({ x: MARGIN, y: y - 61, width: CONTENT_WIDTH, height: 61, color: COLORS.softBlue, borderColor: COLORS.line, borderWidth: 0.7 });
  page.drawText('ALCANCE DE ESTA CONSTANCIA', { x: MARGIN + 12, y: y - 16, size: 8.2, font: bold, color: COLORS.accentDark });
  const scope = 'Este documento consolida los eventos registrados en Docubox desde la creación hasta el cierre del documento. Los eventos se presentan en orden cronológico y conservan el actor, resultado y datos técnicos disponibles en la bitácora.';
  wrap(regular, scope, 7.5, CONTENT_WIDTH - 24).slice(0, 4).forEach((line, index) => page.drawText(line, { x: MARGIN + 12, y: y - 30 - index * 9, size: 7.5, font: regular, color: COLORS.muted }));
  y -= 82;

  page.drawText('Fundamento y conservación', { x: MARGIN, y, size: 9, font: bold, color: COLORS.accentDark });
  const legal = 'La bitácora de auditoría se conserva asociada al documento y sus eventos no deben modificarse después del cierre. Esta constancia describe la evidencia registrada; no sustituye una firma criptográfica PAdES ni una constancia NOM-151.';
  wrap(regular, legal, 7.5, CONTENT_WIDTH).slice(0, 4).forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - 14 - index * 9, size: 7.5, font: regular, color: COLORS.muted }));
  page.drawText(`Generada automáticamente · ${formatUtc(generatedAt)}`, { x: MARGIN, y: 42, size: 7, font: regular, color: COLORS.subtle });

  return pdf.save();
}
