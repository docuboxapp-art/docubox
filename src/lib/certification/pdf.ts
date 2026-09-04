import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFPage, PDFFont, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { embedDocuboxPdfFonts } from '@/lib/pdf/embedded-fonts';

export type DocumentSealStatus = 'VALID' | 'INVALID' | 'UNVERIFIED' | 'REVOKED';

export interface DocumentSealVisualData {
  seal_uuid: string;
  status: DocumentSealStatus;
  document_chain_sha256: string;
  seal_sha256: string;
  signature_algorithm: 'RSA-PSS-SHA256' | 'RSA-PKCS1-SHA256';
  key_size_bits: number;
  signing_key_version: string;
  public_key_fingerprint_sha256: string;
  signed_at: string;
  seal_base64: string;
  seal_base64_preview: string;
  verification_url: string;
}

export interface IntegrityCertificatePdfData {
  folio: string;
  documentUuid: string;
  certificationUuid: string;
  verificationUrl: string;
  documentType: string;
  documentVersion: number;
  completedAt: string;
  certifiedAt: string;
  pageCount: number;
  documentBodySha256: string;
  documentChainSha256: string;
  documentChainDisplay: string;
  documentSeal: DocumentSealVisualData;
  evidenceChainSha256: string;
  evidenceChainDisplay: string;
  evidenceSealSha256: string;
  evidenceSealBase64: string;
  evidenceKeyVersion: string;
  certificationRootSha256: string;
  timestamp?: {
    genTime: string;
    tsaName: string;
    policyOid: string;
    serialNumber: string;
    messageImprintSha256: string;
    tokenSha256: string;
  };
}

export type CryptographicPlacementType = 'document_chain' | 'document_seal' | 'timestamp' | 'evidence_chain';

export interface CryptographicPlacement {
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  placementKind?: string | null;
  cryptographicType?: CryptographicPlacementType | null;
}

export interface CryptographicPlacementPdfData {
  documentUuid: string;
  certifiedAt: string;
  documentChainDisplay: string;
  documentChainSha256: string;
  documentSealBase64: string;
  documentSealSha256: string;
  documentKeyVersion: string;
  evidenceChainDisplay: string;
  timestamp?: {
    genTime: string;
    tsaName: string;
    policyOid: string;
    serialNumber: string;
    tokenSha256: string;
  };
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const ink = rgb(0.09, 0.11, 0.16);
const secondary = rgb(0.35, 0.42, 0.54);
const line = rgb(0.84, 0.88, 0.94);
const blue = rgb(0.19, 0.38, 0.92);
const green = rgb(0.02, 0.61, 0.42);
const paleBlue = rgb(0.94, 0.96, 1);
const paleGreen = rgb(0.93, 0.99, 0.96);
const paleGray = rgb(0.96, 0.97, 0.99);

export function abbreviateBase64(value: string) {
  if (value.length <= 240) return value;
  return `${value.slice(0, 160)}\n...\n${value.slice(-64)}`;
}

function sealStatusPresentation(status: DocumentSealStatus) {
  if (status === 'VALID') return { label: 'VALIDO', foreground: green, background: paleGreen, border: rgb(0.45, 0.88, 0.68) };
  if (status === 'REVOKED') return { label: 'LLAVE REVOCADA', foreground: rgb(0.72, 0.32, 0.02), background: rgb(1, 0.96, 0.9), border: rgb(0.96, 0.72, 0.38) };
  if (status === 'INVALID') return { label: 'INVALIDO', foreground: rgb(0.78, 0.16, 0.2), background: rgb(1, 0.94, 0.95), border: rgb(0.96, 0.65, 0.68) };
  return { label: 'NO VERIFICADO', foreground: secondary, background: paleGray, border: line };
}

function truncateHash(value: string, head = 28, tail = 12) {
  if (value.length <= head + tail + 3) return value.toUpperCase();
  return `${value.slice(0, head).toUpperCase()}...${value.slice(-tail).toUpperCase()}`;
}

function formatUtc(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC', hour12: false,
  }).format(new Date(value)).replace(',', '') + ' UTC';
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/);
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
  return lines;
}

function roundedCard(page: PDFPage, x: number, y: number, width: number, height: number, fill = rgb(1, 1, 1), border = line) {
  page.drawRectangle({ x, y, width, height, color: fill, borderColor: border, borderWidth: 1 });
}

function drawHeader(page: PDFPage, logo: Awaited<ReturnType<PDFDocument['embedPng']>>, bold: PDFFont, regular: PDFFont, right: string) {
  const logoWidth = 145;
  const logoHeight = logo.height * (logoWidth / logo.width);
  const badge = 'EVIDENCIA CRIPTOGRÁFICA';
  const badgeWidth = bold.widthOfTextAtSize(badge, 7.5) + 22;
  page.drawImage(logo, {
    x: MARGIN,
    y: PAGE_HEIGHT - 53,
    width: logoWidth,
    height: logoHeight,
  });
  page.drawRectangle({
    x: PAGE_WIDTH - MARGIN - badgeWidth,
    y: PAGE_HEIGHT - 50,
    width: badgeWidth,
    height: 23,
    color: paleBlue,
    borderColor: line,
    borderWidth: 0.7,
  });
  page.drawText(badge, {
    x: PAGE_WIDTH - MARGIN - badgeWidth + 11,
    y: PAGE_HEIGHT - 42,
    size: 7.5,
    font: bold,
    color: rgb(0.08, 0.24, 0.56),
  });
  page.drawText(right, {
    x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(right, 7.2),
    y: PAGE_HEIGHT - 63,
    size: 7.2,
    font: regular,
    color: secondary,
  });
  page.drawLine({ start: { x: MARGIN, y: PAGE_HEIGHT - 72 }, end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 72 }, thickness: 1, color: line });
}

function drawFooter(page: PDFPage, logo: Awaited<ReturnType<PDFDocument['embedPng']>>, regular: PDFFont, pageNumber: number, totalPages = 3) {
  page.drawLine({ start: { x: MARGIN, y: 31 }, end: { x: PAGE_WIDTH - MARGIN, y: 31 }, thickness: 1, color: line });
  const logoWidth = 76;
  page.drawImage(logo, {
    x: MARGIN,
    y: 11,
    width: logoWidth,
    height: logo.height * (logoWidth / logo.width),
  });
  page.drawText('Constancia técnica de integridad y evidencia digital', { x: 219, y: 18, size: 6.5, font: regular, color: secondary });
  const text = `Página ${pageNumber} de ${totalPages}`;
  page.drawText(text, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(text, 6.8), y: 18, size: 6.8, font: regular, color: secondary });
}

function drawKeyValue(page: PDFPage, font: PDFFont, bold: PDFFont, x: number, y: number, label: string, value: string, valueWidth = 240) {
  page.drawText(label.toUpperCase(), { x, y, size: 6.7, font: bold, color: secondary });
  const rendered = value.length > 52 ? truncateHash(value, 30, 12) : value;
  page.drawText(rendered, { x: x + 78, y, size: 7, font, color: ink, maxWidth: valueWidth });
}

function drawCheck(page: PDFPage, x: number, y: number) {
  page.drawCircle({ x, y, size: 5.2, color: green });
  page.drawLine({ start: { x: x - 2.2, y }, end: { x: x - 0.2, y: y - 2 }, thickness: 1.1, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: x - 0.2, y: y - 2 }, end: { x: x + 2.7, y: y + 2.2 }, thickness: 1.1, color: rgb(1, 1, 1) });
}

function drawSealStatusBadge(page: PDFPage, bold: PDFFont, x: number, y: number, status: DocumentSealStatus, width = 92) {
  const presentation = sealStatusPresentation(status);
  page.drawRectangle({ x, y, width, height: 20, color: presentation.background, borderColor: presentation.border, borderWidth: 0.7 });
  if (status === 'VALID') drawCheck(page, x + 13, y + 10);
  page.drawText(presentation.label, { x: x + (status === 'VALID' ? 24 : 10), y: y + 6.3, size: 6.7, font: bold, color: presentation.foreground });
}

function drawTechnicalBlock(page: PDFPage, regular: PDFFont, bold: PDFFont, y: number, index: number, title: string, description: string, content: string, accent: ReturnType<typeof rgb>) {
  roundedCard(page, MARGIN, y, PAGE_WIDTH - MARGIN * 2, 119);
  page.drawRectangle({ x: MARGIN, y, width: 5, height: 119, color: accent });
  page.drawText(`${index}. ${title}`, { x: MARGIN + 18, y: y + 95, size: 10.5, font: bold, color: ink });
  page.drawText(description, { x: MARGIN + 18, y: y + 78, size: 7.2, font: regular, color: secondary });
  page.drawRectangle({ x: MARGIN + 14, y: y + 13, width: PAGE_WIDTH - MARGIN * 2 - 28, height: 52, color: paleGray, borderColor: line, borderWidth: 0.7 });
  const lines = content.split('\n').flatMap((value) => wrapText(value, regular, 5.6, PAGE_WIDTH - MARGIN * 2 - 44)).slice(0, 6);
  lines.forEach((value, lineIndex) => page.drawText(value, { x: MARGIN + 26, y: y + 53 - lineIndex * 7.2, size: 5.6, font: regular, color: rgb(0.2, 0.25, 0.34) }));
}

interface CompleteEvidenceSection {
  title: string;
  fields: Array<[label: string, value: string]>;
}

function completeEvidenceSections(data: IntegrityCertificatePdfData): CompleteEvidenceSection[] {
  const sections: CompleteEvidenceSection[] = [
    {
      title: 'IDENTIFICADORES Y HUELLAS PRINCIPALES',
      fields: [
        ['FOLIO', data.folio],
        ['DOCUMENT_UUID', data.documentUuid],
        ['CERTIFICATION_UUID', data.certificationUuid],
        ['DOCUMENT_VERSION', String(data.documentVersion)],
        ['DOCUMENT_BODY_SHA256', data.documentBodySha256.toUpperCase()],
        ['DOCUMENT_CHAIN_SHA256', data.documentChainSha256.toUpperCase()],
        ['EVIDENCE_CHAIN_SHA256', data.evidenceChainSha256.toUpperCase()],
        ['EVIDENCE_SEAL_SHA256', data.evidenceSealSha256.toUpperCase()],
        ['CERTIFICATION_ROOT_SHA256', data.certificationRootSha256.toUpperCase()],
        ['VERIFICATION_URL', data.verificationUrl],
      ],
    },
    {
      title: 'CADENA ORIGINAL DOCUBOX COMPLETA',
      fields: [['DOCUMENT_CHAIN_DISPLAY', data.documentChainDisplay]],
    },
    {
      title: 'SELLO DIGITAL DOCUBOX COMPLETO',
      fields: [
        ['SEAL_UUID', data.documentSeal.seal_uuid],
        ['STATUS', data.documentSeal.status],
        ['DOCUMENT_CHAIN_SHA256', data.documentSeal.document_chain_sha256.toUpperCase()],
        ['SEAL_SHA256', data.documentSeal.seal_sha256.toUpperCase()],
        ['SIGNATURE_ALGORITHM', data.documentSeal.signature_algorithm],
        ['KEY_SIZE_BITS', String(data.documentSeal.key_size_bits)],
        ['SIGNING_KEY_VERSION', data.documentSeal.signing_key_version],
        ['PUBLIC_KEY_FINGERPRINT_SHA256', data.documentSeal.public_key_fingerprint_sha256.toUpperCase()],
        ['SIGNED_AT', data.documentSeal.signed_at],
        ['SEAL_BASE64', data.documentSeal.seal_base64],
      ],
    },
    {
      title: 'CADENA DE EVIDENCIA COMPLETA',
      fields: [['EVIDENCE_CHAIN_DISPLAY', data.evidenceChainDisplay]],
    },
    {
      title: 'SELLO DE EVIDENCIA COMPLETO',
      fields: [
        ['EVIDENCE_CHAIN_SHA256', data.evidenceChainSha256.toUpperCase()],
        ['EVIDENCE_SEAL_SHA256', data.evidenceSealSha256.toUpperCase()],
        ['EVIDENCE_KEY_VERSION', data.evidenceKeyVersion],
        ['EVIDENCE_SEAL_BASE64', data.evidenceSealBase64],
      ],
    },
  ];

  sections.push(data.timestamp ? {
    title: 'ESTAMPA DE TIEMPO RFC 3161',
    fields: [
      ['STATUS', 'PRESENT'],
      ['GEN_TIME', data.timestamp.genTime],
      ['TSA_NAME', data.timestamp.tsaName],
      ['POLICY_OID', data.timestamp.policyOid],
      ['SERIAL_NUMBER', data.timestamp.serialNumber],
      ['MESSAGE_IMPRINT_SHA256', data.timestamp.messageImprintSha256.toUpperCase()],
      ['TOKEN_SHA256', data.timestamp.tokenSha256.toUpperCase()],
    ],
  } : {
    title: 'ESTAMPA DE TIEMPO RFC 3161',
    fields: [['STATUS', 'NOT_PRESENT']],
  });

  return sections;
}

function drawCompleteEvidenceAppendix(
  pdf: PDFDocument,
  logo: Awaited<ReturnType<PDFDocument['embedPng']>>,
  regular: PDFFont,
  bold: PDFFont,
  mono: PDFFont,
  data: IntegrityCertificatePdfData,
) {
  const pages: PDFPage[] = [];
  const bodySize = 5.5;
  const lineHeight = 8;
  const contentWidth = PAGE_WIDTH - MARGIN * 2 - 20;
  let appendixPageNumber = 0;

  const createPage = (continuedSection?: string) => {
    appendixPageNumber += 1;
    const nextPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(nextPage);
    drawHeader(nextPage, logo, bold, regular, `Valores completos ${appendixPageNumber}`);
    nextPage.drawText('ANEXO DE VALORES CRIPTOGRAFICOS COMPLETOS', { x: MARGIN, y: 690, size: 14, font: bold, color: ink });
    nextPage.drawText('Los valores de este anexo se presentan integramente y sin abreviaturas.', { x: MARGIN, y: 673, size: 7.2, font: regular, color: secondary });
    let nextY = 643;
    if (continuedSection) {
      nextPage.drawText(`${continuedSection} (CONTINUACION)`, { x: MARGIN, y: nextY, size: 8.2, font: bold, color: rgb(0.08, 0.24, 0.56) });
      nextY -= 22;
    }
    return { page: nextPage, y: nextY };
  };

  const firstPage = createPage();
  let page = firstPage.page;
  let y = firstPage.y;

  const ensureRoom = (requiredHeight: number, continuedSection?: string) => {
    if (y - requiredHeight < 48) {
      const nextPage = createPage(continuedSection);
      page = nextPage.page;
      y = nextPage.y;
    }
  };

  for (const section of completeEvidenceSections(data)) {
    ensureRoom(42);
    page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_WIDTH - MARGIN * 2, height: 22, color: paleBlue, borderColor: line, borderWidth: 0.7 });
    page.drawText(section.title, { x: MARGIN + 10, y: y + 3, size: 8.2, font: bold, color: rgb(0.08, 0.24, 0.56) });
    y -= 28;

    for (const [label, value] of section.fields) {
      const lines = wrapTechnicalText(`${label}=${value}`, mono, bodySize, contentWidth);
      for (const [lineIndex, lineText] of lines.entries()) {
        ensureRoom(lineHeight, section.title);
        page.drawText(lineText, {
          x: MARGIN + 10,
          y,
          size: bodySize,
          font: mono,
          color: lineIndex === 0 ? ink : rgb(0.2, 0.25, 0.34),
          maxWidth: contentWidth,
        });
        y -= lineHeight;
      }
      y -= 3;
    }
    y -= 8;
  }

  return pages;
}

export async function generateIntegrityCertificatePdf(data: IntegrityCertificatePdfData) {
  const pdf = await PDFDocument.create();
  const { regular, bold, mono } = await embedDocuboxPdfFonts(pdf);
  const logoBytes = await readFile(path.join(process.cwd(), 'public', 'assets', 'images', 'docubox-logo-2026.png'));
  const logo = await pdf.embedPng(logoBytes);
  const qrDataUrl = await QRCode.toDataURL(data.verificationUrl, { errorCorrectionLevel: 'M', margin: 1, width: 420 });
  const qr = await pdf.embedPng(Buffer.from(qrDataUrl.split(',')[1], 'base64'));

  const page1 = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page1, logo, bold, regular, 'Resumen verificable');

  roundedCard(page1, MARGIN, 624, PAGE_WIDTH - MARGIN * 2, 75);
  page1.drawCircle({ x: 78, y: 661, size: 20, color: blue });
  page1.drawText('OK', { x: 68.5, y: 655.5, size: 11, font: bold, color: rgb(1, 1, 1) });
  page1.drawText('Documento íntegro y certificado', { x: 118, y: 668, size: 15, font: bold, color: ink });
  page1.drawText('El documento, las cadenas y la referencia temporal coinciden con los registros sellados.', { x: 118, y: 650, size: 7.5, font: regular, color: secondary });
  page1.drawRectangle({ x: 448, y: 644, width: 103, height: 32, color: paleGreen, borderColor: rgb(0.45, 0.88, 0.68), borderWidth: 0.8 });
  drawCheck(page1, 466, 660);
  page1.drawText('VALIDACION', { x: 480, y: 661, size: 7.5, font: bold, color: green });
  page1.drawText('EXITOSA', { x: 480, y: 651, size: 7.5, font: bold, color: green });

  roundedCard(page1, MARGIN, 474, 350, 132);
  page1.drawText('Datos del documento', { x: 58, y: 584, size: 11, font: bold, color: ink });
  drawKeyValue(page1, regular, bold, 58, 563, 'Folio', data.folio);
  drawKeyValue(page1, regular, bold, 58, 546, 'UUID', data.documentUuid);
  drawKeyValue(page1, regular, bold, 58, 529, 'Tipo', data.documentType);
  drawKeyValue(page1, regular, bold, 58, 512, 'Version', String(data.documentVersion));
  drawKeyValue(page1, regular, bold, 58, 495, 'Finalizado', formatUtc(data.completedAt));

  roundedCard(page1, 408, 474, 164, 132);
  page1.drawText('Verificacion publica', { x: 424, y: 584, size: 10.5, font: bold, color: ink });
  page1.drawImage(qr, { x: 452, y: 502, width: 76, height: 76 });
  page1.drawText('Escanea para validar', { x: 455, y: 489, size: 6.3, font: regular, color: secondary });

  roundedCard(page1, MARGIN, 365, PAGE_WIDTH - MARGIN * 2, 92);
  page1.drawText('Alcance de la certificacion', { x: 58, y: 437, size: 11, font: bold, color: ink });
  const scope = [
    ['Integridad del documento', 'Detecta cualquier cambio posterior en el PDF.'],
    ['Sello digital Docubox', 'Vincula la huella con una llave KMS autorizada.'],
    ['Cadena de evidencia', 'Protege archivos, eventos y constancias.'],
    ['Firma PAdES-B-B', 'Firma CMS verificable con certificado X.509.'],
  ];
  scope.forEach(([title, text], index) => {
    const x = index % 2 === 0 ? 66 : 330;
    const y = index < 2 ? 410 : 382;
    drawCheck(page1, x, y + 4);
    page1.drawText(title, { x: x + 13, y: y + 4, size: 7.2, font: bold, color: ink });
    page1.drawText(text, { x: x + 13, y: y - 7, size: 6.2, font: regular, color: secondary });
  });

  roundedCard(page1, MARGIN, 282, PAGE_WIDTH - MARGIN * 2, 66);
  page1.drawText('SELLO DIGITAL DOCUBOX', { x: 58, y: 329, size: 10.5, font: bold, color: rgb(0.08, 0.24, 0.56) });
  drawSealStatusBadge(page1, bold, 462, 319, data.documentSeal.status, 88);
  page1.drawText('Cadena original', { x: 58, y: 310, size: 6.4, font: bold, color: secondary });
  page1.drawText(truncateHash(data.documentSeal.document_chain_sha256, 18, 10), { x: 132, y: 310, size: 6.4, font: mono, color: ink });
  page1.drawText('Algoritmo', { x: 315, y: 310, size: 6.4, font: bold, color: secondary });
  page1.drawText(`${data.documentSeal.signature_algorithm} / ${data.documentSeal.key_size_bits} bits`, { x: 368, y: 310, size: 6.4, font: mono, color: ink });
  page1.drawText('Sello', { x: 58, y: 294, size: 6.4, font: bold, color: secondary });
  page1.drawText(truncateHash(data.documentSeal.seal_base64, 34, 14), { x: 132, y: 294, size: 6.2, font: mono, color: ink });
  page1.drawText('Llave', { x: 394, y: 294, size: 6.4, font: bold, color: secondary });
  page1.drawText(data.documentSeal.signing_key_version, { x: 426, y: 294, size: 6.2, font: mono, color: ink, maxWidth: 124 });

  roundedCard(page1, MARGIN, 192, PAGE_WIDTH - MARGIN * 2, 72, paleBlue, rgb(0.72, 0.78, 1));
  page1.drawText('ESTAMPA DE TIEMPO', { x: 58, y: 245, size: 10.5, font: bold, color: rgb(0.21, 0.2, 0.67) });
  if (data.timestamp) {
    page1.drawRectangle({ x: 471, y: 237, width: 78, height: 20, color: paleGreen, borderColor: rgb(0.45, 0.88, 0.68), borderWidth: 0.7 });
    drawCheck(page1, 484, 247);
    page1.drawText('VALIDA', { x: 495, y: 244.5, size: 7, font: bold, color: green });
    drawKeyValue(page1, regular, bold, 58, 221, 'Fecha UTC', formatUtc(data.timestamp.genTime), 195);
    drawKeyValue(page1, regular, bold, 319, 221, 'Estandar', 'RFC 3161', 120);
    drawKeyValue(page1, regular, bold, 58, 205, 'Autoridad TSA', data.timestamp.tsaName, 195);
    drawKeyValue(page1, regular, bold, 319, 205, 'Algoritmo', 'SHA-256', 120);
  } else {
    page1.drawRectangle({ x: 432, y: 237, width: 117, height: 20, color: paleGray, borderColor: line, borderWidth: 0.7 });
    page1.drawText('NO CONFIGURADA', { x: 446, y: 244.5, size: 7, font: bold, color: secondary });
    page1.drawText('PAdES-B-B emitido sin estampa RFC 3161.', { x: 58, y: 220, size: 7.2, font: regular, color: secondary });
    page1.drawText('La estampa de tiempo se incorpora en PAdES-B-T cuando la TSA este configurada.', { x: 58, y: 204, size: 6.4, font: regular, color: secondary });
  }

  roundedCard(page1, MARGIN, 105, PAGE_WIDTH - MARGIN * 2, 69);
  page1.drawText('Huellas criptograficas principales', { x: 58, y: 154, size: 10.5, font: bold, color: ink });
  drawKeyValue(page1, regular, bold, 58, 133, 'Documento', data.documentBodySha256, 390);
  drawKeyValue(page1, regular, bold, 58, 116, 'Evidencia', data.evidenceChainSha256, 390);
  page1.drawText(data.timestamp ? 'La estampa acredita una referencia temporal verificable. No sustituye por si sola una constancia NOM-151.' : 'La estampa RFC 3161 no esta configurada. Esta constancia no sustituye una constancia NOM-151.', { x: MARGIN, y: 88, size: 6.5, font: regular, color: secondary });

  const page2 = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page2, logo, bold, regular, 'Anexo tecnico');
  page2.drawText('ANEXO TECNICO DE VALIDACION', { x: MARGIN, y: 690, size: 16, font: bold, color: ink });
  page2.drawText('Resumen legible de las cadenas y sellos. Los valores integros se incluyen en el anexo final.', { x: MARGIN, y: 672, size: 7.5, font: regular, color: secondary });
  drawTechnicalBlock(page2, regular, bold, 529, 1, 'CADENA ORIGINAL DOCUBOX', 'Objeto canonico que representa el documento certificado.', data.documentChainDisplay, blue);
  const documentSealId = data.documentSeal.seal_uuid;
  drawTechnicalBlock(page2, regular, bold, 392, 2, 'SELLO DIGITAL DOCUBOX', 'Firma RSA-PSS SHA-256 emitida mediante una llave KMS.', `IDENTIFICADOR=${documentSealId}\nESTADO=${data.documentSeal.status}\nHUELLA_CADENA=${data.documentSeal.document_chain_sha256.toUpperCase()}\nHUELLA_SELLO=${data.documentSeal.seal_sha256.toUpperCase()}\nALGORITMO=${data.documentSeal.signature_algorithm} / RSA-${data.documentSeal.key_size_bits}\nLLAVE=${data.documentSeal.signing_key_version}`, green);
  drawTechnicalBlock(page2, regular, bold, 255, 3, 'CADENA DE EVIDENCIA', 'Manifiesto canonico del paquete de evidencia y la bitacora.', data.evidenceChainDisplay, blue);
  drawTechnicalBlock(page2, regular, bold, 118, 4, 'SELLO DE LA CADENA DE EVIDENCIA', 'Sello que permite detectar sustituciones, eliminaciones o alteraciones.', `HASH_CADENA=${data.evidenceChainSha256.toUpperCase()}\nALGORITHM=RSA-PSS-SHA256 / RSA-3072\nKEY_VERSION=${data.evidenceKeyVersion}\nSEAL=${truncateHash(data.evidenceSealBase64, 48, 18)}`, green);
  page2.drawText(`Raiz de certificacion: ${data.certificationRootSha256.toUpperCase()}`, { x: MARGIN, y: 92, size: 6.2, font: regular, color: secondary });
  page2.drawText('Esta constancia facilita la verificacion tecnica de integridad y evidencia. No sustituye una constancia NOM-151 emitida por un PSC acreditado.', { x: MARGIN, y: 78, size: 6.2, font: regular, color: secondary });

  const page3 = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page3, logo, bold, regular, 'Sello digital');
  page3.drawText('SELLO DIGITAL DOCUBOX', { x: MARGIN, y: 690, size: 16, font: bold, color: rgb(0.08, 0.24, 0.56) });
  page3.drawText('Proteccion criptografica de la Cadena Original Docubox', { x: MARGIN, y: 672, size: 8, font: regular, color: secondary });
  drawSealStatusBadge(page3, bold, 468, 680, data.documentSeal.status, 104);

  roundedCard(page3, MARGIN, 422, PAGE_WIDTH - MARGIN * 2, 228);
  const sealRows = [
    ['Identificador del sello', data.documentSeal.seal_uuid],
    ['Hash de la Cadena Original', data.documentSeal.document_chain_sha256.toUpperCase()],
    ['Algoritmo de firma', `${data.documentSeal.signature_algorithm} / llave RSA de ${data.documentSeal.key_size_bits} bits`],
    ['Version de llave', data.documentSeal.signing_key_version],
    ['Huella SHA-256 de la llave publica', data.documentSeal.public_key_fingerprint_sha256.toUpperCase()],
    ['Fecha de generacion', formatUtc(data.documentSeal.signed_at)],
  ];
  sealRows.forEach(([label, value], index) => {
    const y = 620 - index * 34;
    page3.drawText(label.toUpperCase(), { x: 58, y, size: 6.6, font: bold, color: secondary });
    page3.drawText(value, { x: 58, y: y - 13, size: 7.2, font: index === 2 || index === 5 ? regular : mono, color: ink, maxWidth: 492 });
  });

  roundedCard(page3, MARGIN, 224, PAGE_WIDTH - MARGIN * 2, 180, paleGray);
  page3.drawText('SELLO DIGITAL EN BASE64', { x: 58, y: 382, size: 8.3, font: bold, color: rgb(0.08, 0.24, 0.56) });
  const previewLines = data.documentSeal.seal_base64_preview.split('\n').flatMap((source) => {
    if (source === '...') return ['...'];
    return source.match(/.{1,64}/g) || [];
  }).slice(0, 8);
  previewLines.forEach((value, index) => page3.drawText(value, { x: 58, y: 360 - index * 13, size: 6.7, font: mono, color: rgb(0.2, 0.25, 0.34) }));
  page3.drawImage(qr, { x: 472, y: 244, width: 78, height: 78 });
  page3.drawText('Valor completo en el anexo', { x: 451, y: 232, size: 6.1, font: regular, color: secondary });

  roundedCard(page3, MARGIN, 103, PAGE_WIDTH - MARGIN * 2, 101, paleBlue, rgb(0.72, 0.78, 1));
  page3.drawText('COMPROBACION', { x: 58, y: 183, size: 8.2, font: bold, color: rgb(0.08, 0.24, 0.56) });
  const explanation = 'El Sello Digital Docubox es el resultado de firmar criptograficamente la Cadena Original Docubox mediante una llave privada administrada en un servicio seguro de gestion de llaves. Su validacion permite comprobar que la cadena fue emitida por Docubox y que no ha sido modificada despues de su sellado.';
  wrapText(explanation, regular, 7.1, 490).slice(0, 5).forEach((value, index) => page3.drawText(value, { x: 58, y: 164 - index * 12, size: 7.1, font: regular, color: ink }));
  drawCompleteEvidenceAppendix(pdf, logo, regular, bold, mono, data);

  const allPages = pdf.getPages();
  allPages.forEach((page, index) => drawFooter(page, logo, regular, index + 1, allPages.length));

  pdf.setTitle(`Constancia tecnica de integridad - ${data.folio}`);
  pdf.setAuthor('Docubox');
  pdf.setProducer('Docubox Cryptographic Certification Engine 1.0');
  pdf.setKeywords(['integridad', 'evidencia digital', 'RSA-PSS', 'RFC 3161', 'PAdES', 'Docubox']);
  return pdf.save({ useObjectStreams: false });
}

function wrapTechnicalText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const result: string[] = [];
  for (const sourceLine of text.split(/\r?\n/)) {
    const words = sourceLine.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const chunks: string[] = [];
      let remaining = word;
      while (font.widthOfTextAtSize(remaining, size) > maxWidth && remaining.length > 1) {
        let take = Math.max(1, Math.floor(remaining.length * maxWidth / font.widthOfTextAtSize(remaining, size)));
        while (take > 1 && font.widthOfTextAtSize(remaining.slice(0, take), size) > maxWidth) take--;
        chunks.push(remaining.slice(0, take));
        remaining = remaining.slice(take);
      }
      if (remaining) chunks.push(remaining);
      for (const chunk of chunks) {
        const candidate = line ? `${line} ${chunk}` : chunk;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
        else {
          if (line) result.push(line);
          line = chunk;
        }
      }
    }
    if (line) result.push(line);
    line = '';
  }
  return result;
}

function cryptographicPlacementContent(type: CryptographicPlacementType, data: CryptographicPlacementPdfData) {
  if (type === 'document_chain') {
    return { title: 'CADENA ORIGINAL DOCUBOX', content: data.documentChainDisplay };
  }
  if (type === 'evidence_chain') {
    return { title: 'CADENA DE EVIDENCIA', content: data.evidenceChainDisplay };
  }
  if (type === 'timestamp' && data.timestamp) {
    return {
      title: 'ESTAMPA DE TIEMPO RFC 3161',
      content: `FECHA_UTC=${formatUtc(data.timestamp.genTime)}\nTSA=${data.timestamp.tsaName}\nPOLITICA=${data.timestamp.policyOid}\nSERIE=${data.timestamp.serialNumber}\nTOKEN_SHA256=${data.timestamp.tokenSha256.toUpperCase()}`,
    };
  }
  const sealId = `SDL-DBX-${new Date(data.certifiedAt).getUTCFullYear()}-${data.documentUuid.replace(/-/g, '').slice(0, 8).toUpperCase()}-0001`;
  return {
    title: 'SELLO DIGITAL DOCUBOX',
    content: `IDENTIFICADOR=${sealId}\nHUELLA_CADENA=${data.documentChainSha256.toUpperCase()}\nHUELLA_SELLO=${data.documentSealSha256.toUpperCase()}\nALGORITMO=RSA-PSS-SHA256 / RSA-3072\nLLAVE=${data.documentKeyVersion}\nGENERADO=${formatUtc(data.certifiedAt)}\nSELLO=${data.documentSealBase64}`,
  };
}

export async function applyCryptographicPlacements(
  documentBytes: Uint8Array,
  placements: CryptographicPlacement[],
  data: CryptographicPlacementPdfData,
) {
  const cryptoPlacements = placements.filter((placement) => placement.placementKind === 'cryptographic' && placement.cryptographicType && (placement.cryptographicType !== 'timestamp' || data.timestamp));
  if (cryptoPlacements.length === 0) return documentBytes;

  const pdf = await PDFDocument.load(documentBytes, { ignoreEncryption: false });
  const { regular, bold, mono } = await embedDocuboxPdfFonts(pdf);

  for (const placement of cryptoPlacements) {
    const type = placement.cryptographicType as CryptographicPlacementType;
    const pageIndex = Math.max(0, Math.min(pdf.getPageCount() - 1, Number(placement.page || 1) - 1));
    const page = pdf.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const blockWidth = Math.max(90, pageWidth * Math.max(8, Math.min(96, Number(placement.width || 40))) / 100);
    const blockHeight = Math.max(42, pageHeight * Math.max(4, Math.min(50, Number(placement.height || 10))) / 100);
    const x = Math.max(0, Math.min(pageWidth - blockWidth, pageWidth * Math.max(0, Number(placement.x || 0)) / 100));
    const top = pageHeight * Math.max(0, Number(placement.y || 0)) / 100;
    const y = Math.max(0, Math.min(pageHeight - blockHeight, pageHeight - top - blockHeight));
    const padding = Math.max(5, Math.min(10, blockWidth * 0.018));
    const { title, content } = cryptographicPlacementContent(type, data);

    page.drawRectangle({ x, y, width: blockWidth, height: blockHeight, color: rgb(1, 1, 1), borderColor: rgb(0.55, 0.7, 0.96), borderWidth: 0.8, opacity: 0.97 });
    page.drawRectangle({ x, y, width: 3, height: blockHeight, color: blue });
    const titleSize = Math.max(5.5, Math.min(9, blockHeight * 0.105));
    page.drawText(title, { x: x + padding + 3, y: y + blockHeight - padding - titleSize, size: titleSize, font: bold, color: rgb(0.08, 0.24, 0.56), maxWidth: blockWidth - padding * 2 - 3 });
    const bodySize = Math.max(3.6, Math.min(6.5, blockHeight * 0.065));
    const lineHeight = bodySize * 1.3;
    const availableHeight = blockHeight - padding * 2 - titleSize - 5;
    const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const lines = wrapTechnicalText(content, mono, bodySize, blockWidth - padding * 2 - 3).slice(0, maxLines);
    lines.forEach((lineText, index) => {
      page.drawText(lineText, { x: x + padding + 3, y: y + blockHeight - padding - titleSize - 7 - index * lineHeight, size: bodySize, font: mono, color: ink });
    });
    if (lines.length === 0) {
      page.drawText('Valor generado al completar la certificacion.', { x: x + padding + 3, y: y + padding, size: 5, font: regular, color: secondary });
    }
  }

  return pdf.save({ useObjectStreams: false });
}

export async function appendCertificatePages(documentBytes: Uint8Array, certificateBytes: Uint8Array) {
  const documentPdf = await PDFDocument.load(documentBytes, { ignoreEncryption: false });
  const certificatePdf = await PDFDocument.load(certificateBytes);
  const pages = await documentPdf.copyPages(certificatePdf, certificatePdf.getPageIndices());
  pages.forEach((page) => documentPdf.addPage(page));
  return documentPdf.save({ useObjectStreams: false });
}
