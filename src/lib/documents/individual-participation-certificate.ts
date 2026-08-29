import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  accent: rgb(30 / 255, 107 / 255, 1),
  accentDark: rgb(20 / 255, 65 / 255, 145 / 255),
  text: rgb(24 / 255, 24 / 255, 27 / 255),
  muted: rgb(82 / 255, 82 / 255, 91 / 255),
  subtle: rgb(113 / 255, 113 / 255, 122 / 255),
  border: rgb(224 / 255, 228 / 255, 236 / 255),
  softBlue: rgb(239 / 255, 246 / 255, 1),
  softGray: rgb(248 / 255, 248 / 255, 251 / 255),
  white: rgb(1, 1, 1),
};

export interface IndividualParticipationCertificateData {
  logoBytes?: Uint8Array;
  folio: string;
  generatedAt: string;
  participantName: string;
  participantEmail: string;
  participantRole: string;
  participantCurp: string;
  participantRfc: string;
  signatureKind: 'autograph' | 'efirma' | 'click_sign' | 'other';
  signatureMethod: string;
  signatureImage?: string | null;
  signatureHash: string;
  signedAt: string;
  documentId: string;
  documentTitle: string;
  documentCreatedAt: string;
  documentCompletedAt: string;
  issuer: string;
  certificateSerialNumber: string;
  certificateNotBefore: string;
  certificateNotAfter: string;
  ocspStatus: string;
  organization: string;
  country: string;
  certificateValidity: string;
  certificateAlgorithm: string;
  timestampAuthority: string;
  timestampUrl: string;
  signatureLevel: string;
  legalStandard: string;
  consentAccepted: boolean;
  consentAcceptedAt: string;
  consentVersion: string;
  consentText: string;
  ipAddress: string;
  coordinates: string;
  timezone: string;
  device: string;
  userAgent: string;
  originalDocumentHash: string;
  signedDocumentHash: string;
  sealedAt: string;
  verificationUrl: string;
}

type Fonts = { regular: PDFFont; bold: PDFFont };

function text(value: unknown, fallback = 'No disponible') {
  const normalized = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function completeTextSize(value: string, font: PDFFont, preferredSize: number, maxWidth: number, minimumSize = 4.2) {
  const clean = text(value);
  let size = preferredSize;
  while (size > minimumSize && font.widthOfTextAtSize(clean, size) > maxWidth) size -= 0.15;
  return Math.max(size, minimumSize);
}

function splitCompleteLines(value: string, font: PDFFont, size: number, maxWidth: number) {
  const clean = text(value);
  const lines: string[] = [];
  let current = '';
  for (const character of clean) {
    if (font.widthOfTextAtSize(current + character, size) <= maxWidth) {
      current += character;
    } else {
      if (current) lines.push(current);
      current = character;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatUtc(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return text(value);
  return parsed.toISOString();
}

function drawLogo(page: PDFPage, logo: PDFImage | null, fonts: Fonts, y: number) {
  if (logo) {
    const size = logo.scaleToFit(128, 30);
    page.drawImage(logo, { x: MARGIN, y: y - size.height, width: size.width, height: size.height });
  } else {
    page.drawText('Docubox', { x: MARGIN, y: y - 21, size: 22, font: fonts.bold, color: COLORS.text });
  }
}

function drawHeader(page: PDFPage, logo: PDFImage | null, fonts: Fonts, pageLabel: string, subtitle?: string) {
  const top = PAGE_HEIGHT - 34;
  drawLogo(page, logo, fonts, top);
  const labelWidth = fonts.bold.widthOfTextAtSize(pageLabel, 7.5);
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - labelWidth - 22,
    y: top - 25,
    width: labelWidth + 22,
    height: 23,
    color: COLORS.softBlue,
    borderColor: COLORS.border,
    borderWidth: 0.7,
  });
  page.drawText(pageLabel, {
    x: PAGE_WIDTH - MARGIN - labelWidth - 11,
    y: top - 17,
    size: 7.5,
    font: fonts.bold,
    color: COLORS.accentDark,
  });
  if (subtitle) {
    const subtitleSize = completeTextSize(subtitle, fonts.regular, 7.2, 250, 5.8);
    const subtitleWidth = fonts.regular.widthOfTextAtSize(subtitle, subtitleSize);
    page.drawText(subtitle, {
      x: PAGE_WIDTH - MARGIN - subtitleWidth,
      y: top - 41,
      size: subtitleSize,
      font: fonts.regular,
      color: COLORS.muted,
    });
  }
}

function drawFooter(page: PDFPage, logo: PDFImage | null, fonts: Fonts, generatedAt: string, pageNumber: number) {
  page.drawLine({
    start: { x: MARGIN, y: 42 },
    end: { x: PAGE_WIDTH - MARGIN, y: 42 },
    thickness: 0.7,
    color: COLORS.border,
  });
  if (logo) {
    const size = logo.scaleToFit(73, 17);
    page.drawImage(logo, { x: MARGIN, y: 18, width: size.width, height: size.height });
  } else {
    page.drawText('Docubox', { x: MARGIN, y: 21, size: 11, font: fonts.bold, color: COLORS.text });
  }
  const generatedLabel = `Generada automáticamente · ${formatUtc(generatedAt)} UTC`;
  const generatedSize = completeTextSize(generatedLabel, fonts.regular, 6.6, 245, 5.2);
  page.drawText(generatedLabel, {
    x: 207,
    y: 22,
    size: generatedSize,
    font: fonts.regular,
    color: COLORS.subtle,
  });
  page.drawText(`Página ${pageNumber} de 2`, {
    x: PAGE_WIDTH - MARGIN - 56,
    y: 22,
    size: 6.6,
    font: fonts.regular,
    color: COLORS.subtle,
  });
}

function drawSectionTitle(page: PDFPage, fonts: Fonts, title: string, y: number) {
  page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_WIDTH, height: 22, color: COLORS.softBlue });
  page.drawRectangle({ x: MARGIN, y: y - 22, width: 3, height: 22, color: COLORS.accent });
  page.drawText(title, {
    x: MARGIN + 12,
    y: y - 15,
    size: 8.2,
    font: fonts.bold,
    color: COLORS.accentDark,
  });
  return y - 22;
}

function drawRows(
  page: PDFPage,
  fonts: Fonts,
  rows: Array<[string, string]>,
  y: number,
  options?: { labelWidth?: number; rowHeight?: number; valueSize?: number },
) {
  const labelWidth = options?.labelWidth ?? 155;
  const rowHeight = options?.rowHeight ?? 22;
  const valueSize = options?.valueSize ?? 7.8;
  rows.forEach(([label, value], index) => {
    const rowY = y - rowHeight * (index + 1);
    page.drawRectangle({
      x: MARGIN,
      y: rowY,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: index % 2 === 0 ? COLORS.white : COLORS.softGray,
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
      y: rowY + 7.4,
      size: 6.7,
      font: fonts.bold,
      color: COLORS.muted,
    });
    const completeValue = text(value);
    const completeValueSize = completeTextSize(completeValue, fonts.regular, valueSize, CONTENT_WIDTH - labelWidth - 18);
    page.drawText(completeValue, {
      x: MARGIN + labelWidth + 9,
      y: rowY + 7,
      size: completeValueSize,
      font: fonts.regular,
      color: COLORS.text,
    });
  });
  return y - rows.length * rowHeight;
}

function drawSummaryCards(page: PDFPage, fonts: Fonts, data: IndividualParticipationCertificateData, y: number) {
  const gap = 8;
  const cardWidth = (CONTENT_WIDTH - gap * 2) / 3;
  const cards: Array<[string, string, string]> = [
    ['FOLIO DE LA CONSTANCIA', data.folio, 'F'],
    ['GENERADA (UTC)', formatUtc(data.generatedAt), 'T'],
    ['FIRMANTE', data.participantName, 'P'],
  ];
  cards.forEach(([label, value, icon], index) => {
    const x = MARGIN + index * (cardWidth + gap);
    page.drawRectangle({
      x,
      y: y - 44,
      width: cardWidth,
      height: 44,
      color: COLORS.white,
      borderColor: rgb(194 / 255, 211 / 255, 247 / 255),
      borderWidth: 0.75,
    });
    page.drawRectangle({ x: x + 9, y: y - 36, width: 27, height: 27, color: COLORS.softBlue });
    page.drawText(icon, { x: x + 18, y: y - 28, size: 10, font: fonts.bold, color: COLORS.accent });
    page.drawText(label, { x: x + 44, y: y - 15, size: 6.1, font: fonts.bold, color: COLORS.accent });
    const completeValue = text(value);
    const completeValueSize = completeTextSize(completeValue, fonts.regular, 7.1, cardWidth - 53, 4.2);
    page.drawText(completeValue, {
      x: x + 44,
      y: y - 31,
      size: completeValueSize,
      font: fonts.regular,
      color: COLORS.text,
    });
  });
  return y - 44;
}

async function embedSignature(pdf: PDFDocument, value?: string | null) {
  if (!value?.startsWith('data:image/')) return null;
  try {
    const [header, payload] = value.split(',');
    const bytes = Uint8Array.from(Buffer.from(payload, 'base64'));
    return header.includes('image/jpeg') ? pdf.embedJpg(bytes) : pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  lineHeight: number,
  color = COLORS.text,
) {
  const words = text(value).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  lines.forEach((line, index) => page.drawText(line, {
    x,
    y: y - index * lineHeight,
    size,
    font,
    color,
  }));
  return y - lines.length * lineHeight;
}

function signatureDetailSection(data: IndividualParticipationCertificateData) {
  if (data.signatureKind === 'efirma') {
    return {
      title: 'Certificado e.firma SAT',
      rows: [
        ['RFC del firmante', data.participantRfc],
        ['Número de serie', data.certificateSerialNumber],
        ['Entidad emisora', data.issuer],
        ['Válido desde', formatUtc(data.certificateNotBefore)],
        ['Válido hasta', formatUtc(data.certificateNotAfter)],
        ['Algoritmo', data.certificateAlgorithm],
        ['Estado OCSP', data.ocspStatus],
        ['Sellado de tiempo (TSA)', data.timestampAuthority],
        ['Perfil PAdES', data.signatureLevel],
      ] as Array<[string, string]>,
    };
  }
  if (data.signatureKind === 'click_sign') {
    return {
      title: 'Consentimiento Click & Sign',
      rows: [
        ['Aceptación', data.consentAccepted ? 'Registrada' : 'No registrada'],
        ['Fecha de aceptación', formatUtc(data.consentAcceptedAt)],
        ['Versión del consentimiento', data.consentVersion],
        ['Texto presentado', data.consentText],
        ['Dirección IP', data.ipAddress],
        ['Zona horaria', data.timezone],
        ['Dispositivo', data.device],
        ['Agente de usuario', data.userAgent],
      ] as Array<[string, string]>,
    };
  }
  return {
    title: 'Evidencia de firma autógrafa digital',
    rows: [
      ['Hash de la firma', data.signatureHash],
      ['Fecha de firma', formatUtc(data.signedAt)],
      ['Dirección IP', data.ipAddress],
      ['Zona horaria', data.timezone],
      ['Dispositivo', data.device],
      ['Coordenadas', data.coordinates],
      ['Algoritmo', data.certificateAlgorithm],
      ['Estándar legal', data.legalStandard],
    ] as Array<[string, string]>,
  };
}

function drawEvidenceValue(page: PDFPage, fonts: Fonts, label: string, value: string, x: number, y: number, width: number) {
  page.drawText(label.toUpperCase(), { x, y, size: 6.2, font: fonts.bold, color: COLORS.muted });
  const clean = text(value);
  const size = completeTextSize(clean, fonts.regular, 6.8, width, 4.4);
  page.drawText(clean, { x, y: y - 12, size, font: fonts.regular, color: COLORS.text });
}

function drawEvidenceSidePanel(page: PDFPage, fonts: Fonts, data: IndividualParticipationCertificateData) {
  page.drawLine({ start: { x: 355, y: 578 }, end: { x: 355, y: 681 }, thickness: 0.6, color: COLORS.border });
  page.drawText('HUELLA DE LA EVIDENCIA', { x: 374, y: 660, size: 7, font: fonts.bold, color: COLORS.muted });
  const signatureHashLines = splitCompleteLines(data.signatureHash, fonts.regular, 6.1, 160);
  signatureHashLines.forEach((line, index) => page.drawText(line, {
    x: 374,
    y: 638 - index * 8,
    size: 6.1,
    font: fonts.regular,
    color: COLORS.accentDark,
  }));
  page.drawText('MÉTODO', { x: 374, y: 608, size: 7, font: fonts.bold, color: COLORS.muted });
  const signatureMethodSize = completeTextSize(data.signatureMethod, fonts.regular, 7.5, 160, 5.2);
  page.drawText(text(data.signatureMethod), {
    x: 374,
    y: 591,
    size: signatureMethodSize,
    font: fonts.regular,
    color: COLORS.text,
  });
  page.drawText('VÍNCULO', { x: 374, y: 580, size: 7, font: fonts.bold, color: COLORS.muted });
  const linkLabel = data.signatureKind === 'efirma'
    ? 'Documento + certificado + sello'
    : data.signatureKind === 'click_sign'
      ? 'Documento + consentimiento + sesión'
      : 'Documento + participante + trazo';
  page.drawText(linkLabel, { x: 374, y: 565, size: 5.7, font: fonts.regular, color: COLORS.text });
}

function drawSignatureEvidenceCard(
  page: PDFPage,
  fonts: Fonts,
  data: IndividualParticipationCertificateData,
  signature: PDFImage | null,
) {
  page.drawRectangle({
    x: MARGIN,
    y: 559,
    width: CONTENT_WIDTH,
    height: 145,
    color: COLORS.white,
    borderColor: COLORS.border,
    borderWidth: 0.8,
  });
  page.drawText(data.participantName, {
    x: MARGIN + 18,
    y: 680,
    size: 9.5,
    font: fonts.bold,
    color: COLORS.text,
  });

  if (data.signatureKind === 'efirma') {
    page.drawRectangle({ x: MARGIN + 18, y: 619, width: 40, height: 40, color: COLORS.softBlue });
    page.drawText('EF', { x: MARGIN + 28, y: 633, size: 11, font: fonts.bold, color: COLORS.accent });
    page.drawText('CERTIFICADO e.firma SAT', { x: MARGIN + 70, y: 650, size: 7.3, font: fonts.bold, color: COLORS.accentDark });
    drawEvidenceValue(page, fonts, 'RFC', data.participantRfc, MARGIN + 70, 633, 112);
    drawEvidenceValue(page, fonts, 'Número de serie', data.certificateSerialNumber, MARGIN + 190, 633, 102);
    drawEvidenceValue(page, fonts, 'Entidad emisora', data.issuer, MARGIN + 18, 598, 122);
    drawEvidenceValue(page, fonts, 'Estado OCSP', data.ocspStatus, MARGIN + 154, 598, 122);
  } else if (data.signatureKind === 'click_sign') {
    page.drawRectangle({
      x: MARGIN + 18,
      y: 621,
      width: 36,
      height: 36,
      color: data.consentAccepted ? COLORS.softBlue : COLORS.softGray,
      borderColor: data.consentAccepted ? COLORS.accent : COLORS.border,
      borderWidth: 0.8,
    });
    if (data.consentAccepted) {
      page.drawLine({ start: { x: MARGIN + 27, y: 638 }, end: { x: MARGIN + 33, y: 631 }, thickness: 2, color: COLORS.accent });
      page.drawLine({ start: { x: MARGIN + 33, y: 631 }, end: { x: MARGIN + 46, y: 648 }, thickness: 2, color: COLORS.accent });
    }
    page.drawText(data.consentAccepted ? 'ACEPTACIÓN EXPRESA REGISTRADA' : 'ACEPTACIÓN NO REGISTRADA', {
      x: MARGIN + 68,
      y: 647,
      size: 7.4,
      font: fonts.bold,
      color: data.consentAccepted ? COLORS.accentDark : COLORS.muted,
    });
    drawEvidenceValue(page, fonts, 'Fecha y hora UTC', formatUtc(data.consentAcceptedAt), MARGIN + 68, 629, 210);
    drawEvidenceValue(page, fonts, 'Dirección IP', data.ipAddress, MARGIN + 18, 598, 120);
    drawEvidenceValue(page, fonts, 'Zona horaria', data.timezone, MARGIN + 154, 598, 122);
  } else if (signature) {
    const fit = signature.scaleToFit(278, 83);
    page.drawImage(signature, {
      x: MARGIN + 26 + (278 - fit.width) / 2,
      y: 575 + (83 - fit.height) / 2,
      width: fit.width,
      height: fit.height,
    });
  } else {
    page.drawText('Trazo no disponible', { x: MARGIN + 103, y: 615, size: 10, font: fonts.regular, color: COLORS.subtle });
  }
  drawEvidenceSidePanel(page, fonts, data);
}

export async function createIndividualParticipationCertificate(
  data: IndividualParticipationCertificateData,
) {
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
  const signature = await embedSignature(pdf, data.signatureImage);

  const page1 = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page1, logo, fonts, 'CONSTANCIA LEGAL');
  page1.drawText('Constancia individual de participación', {
    x: MARGIN,
    y: 746,
    size: 20,
    font: fonts.bold,
    color: COLORS.text,
  });
  page1.drawText('Evidencia individual del proceso de firma electrónica', {
    x: MARGIN,
    y: 726,
    size: 9,
    font: fonts.regular,
    color: COLORS.muted,
  });
  page1.drawLine({
    start: { x: MARGIN, y: 713 },
    end: { x: PAGE_WIDTH - MARGIN, y: 713 },
    thickness: 2.2,
    color: COLORS.accent,
  });
  page1.drawRectangle({ x: MARGIN, y: 670, width: CONTENT_WIDTH, height: 30, color: COLORS.softGray });
  page1.drawText('DOCUMENTO CONFIDENCIAL', { x: MARGIN + 11, y: 682, size: 7.2, font: fonts.bold, color: COLORS.text });
  const methodHeading = `MÉTODO: ${text(data.signatureMethod).toUpperCase()}`;
  const methodHeadingSize = completeTextSize(methodHeading, fonts.bold, 7.2, 170, 5.2);
  const methodHeadingWidth = fonts.bold.widthOfTextAtSize(methodHeading, methodHeadingSize);
  page1.drawText(methodHeading, {
    x: PAGE_WIDTH - MARGIN - methodHeadingWidth - 10,
    y: 682,
    size: methodHeadingSize,
    font: fonts.bold,
    color: COLORS.accentDark,
  });

  let y = drawSummaryCards(page1, fonts, data, 654) - 18;
  y = drawSectionTitle(page1, fonts, 'Datos del participante', y);
  y = drawRows(page1, fonts, [
    ['Nombre', data.participantName],
    ['Correo electrónico', data.participantEmail],
    ['Rol', data.participantRole],
    ['RFC', data.participantRfc],
    ['CURP', data.participantCurp],
  ], y);
  y -= 14;
  const detailSection = signatureDetailSection(data);
  y = drawSectionTitle(page1, fonts, detailSection.title, y);
  y = drawRows(page1, fonts, detailSection.rows, y, { rowHeight: 17, valueSize: 7 });
  y -= 14;
  y = drawSectionTitle(page1, fonts, 'Datos del documento', y);
  y = drawRows(page1, fonts, [
    ['Identificador', data.documentId],
    ['Título', data.documentTitle],
    ['Creado', formatUtc(data.documentCreatedAt)],
    ['Completado', formatUtc(data.documentCompletedAt)],
  ], y, { rowHeight: 20, valueSize: 7.4 });
  drawFooter(page1, logo, fonts, data.generatedAt, 1);

  const page2 = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page2, logo, fonts, 'EVIDENCIA INDIVIDUAL', 'Constancia individual de participación');
  page2.drawLine({
    start: { x: MARGIN, y: 756 },
    end: { x: PAGE_WIDTH - MARGIN, y: 756 },
    thickness: 0.7,
    color: COLORS.border,
  });
  drawSectionTitle(page2, fonts, 'Evidencia individual de firma', 748);
  drawSignatureEvidenceCard(page2, fonts, data, signature);

  y = 536;
  y = drawSectionTitle(page2, fonts, 'Integridad y verificación', y);
  y = drawRows(page2, fonts, [
    ['Hash del documento original', data.originalDocumentHash],
    ['Hash del documento firmado', data.signedDocumentHash],
    ['Folio de la constancia', data.folio],
    ['Fecha de sellado', formatUtc(data.sealedAt)],
    ['Algoritmo', data.certificateAlgorithm],
    ['URL de verificación', data.verificationUrl],
  ], y, { labelWidth: 180, rowHeight: 22, valueSize: 6.6 });
  y -= 17;
  y = drawSectionTitle(page2, fonts, 'Fundamento legal', y);
  const legalBlocks: Array<[string, string]> = [
    ['Confidencialidad:', 'Este documento contiene datos personales protegidos por la LFPDPPP. Su divulgación a terceros no autorizados está prohibida.'],
    ['Validez jurídica:', 'Certifica la participación y voluntad de firma conforme a los artículos 89 a 97 del Código de Comercio, la LFEA y, cuando corresponda, la NOM-151-SCFI-2016.'],
    ['No repudio:', 'Los elementos registrados constituyen evidencia de la libre y expresa manifestación de voluntad de la persona firmante.'],
  ];
  let legalY = y - 17;
  for (const [heading, body] of legalBlocks) {
    page2.drawText(heading, { x: MARGIN + 2, y: legalY, size: 7.4, font: fonts.bold, color: COLORS.text });
    legalY = drawWrappedText(page2, fonts.regular, body, MARGIN + 2, legalY - 10, 6.4, CONTENT_WIDTH - 4, 7.8, COLORS.muted) - 6;
  }
  page2.drawRectangle({
    x: MARGIN,
    y: legalY - 60,
    width: CONTENT_WIDTH,
    height: 58,
    color: COLORS.softGray,
    borderColor: COLORS.border,
    borderWidth: 0.6,
  });
  drawWrappedText(
    page2,
    fonts.regular,
    `La presente participación electrónica se integra al expediente del documento ${text(data.documentId)}. La huella SHA-256 vincula esta evidencia con el archivo firmado y permite comprobar su integridad mediante la URL de verificación indicada. Los datos técnicos no disponibles no se sustituyen por valores simulados.`,
    MARGIN + 8,
    legalY - 13,
    6.1,
    CONTENT_WIDTH - 16,
    8,
    COLORS.text,
  );
  drawFooter(page2, logo, fonts, data.generatedAt, 2);

  return pdf.save();
}
