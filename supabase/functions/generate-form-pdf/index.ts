import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import QRCode from 'https://esm.sh/qrcode@1.5.4';
import { requiresFormSignature } from '../_shared/form-signature-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


function hexToRgb(hex: string) {
  const normalized = (hex || '#1E6BFF').replace('#', '');
  return rgb(
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  );
}

async function embedFormFonts(pdf: PDFDocument, typography: unknown) {
  const family = typeof typography === 'string' ? typography : 'sans';
  const standardPair = family === 'serif' || /^(Times New Roman|Georgia|Garamond|Palatino|Merriweather|PT Serif|Libre Baskerville)$/i.test(family)
    ? [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold]
    : /^(Courier New|Courier Prime|Source Code Pro|Fira Code|Space Mono|Inconsolata|Anonymous Pro|Share Tech Mono)$/i.test(family)
      ? [StandardFonts.Courier, StandardFonts.CourierBold]
      : [StandardFonts.Helvetica, StandardFonts.HelveticaBold];
  const fallback = async () => ({
    regular: await pdf.embedFont(standardPair[0]),
    bold: await pdf.embedFont(standardPair[1]),
  });

  if (family === 'sans' || family === 'serif') {
    return fallback();
  }
  if (!/^[A-Za-z0-9 ]{1,50}$/.test(family)) return fallback();

  try {
    const stylesheet = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700`,
      { headers: { 'User-Agent': 'curl/7.68.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!stylesheet.ok) throw new Error('No se pudo cargar la tipografía');
    const css = await stylesheet.text();
    const faces = Array.from(css.matchAll(/@font-face\s*\{([^}]+)\}/g), (match) => match[1]);
    const fontUrl = (weight: number) => {
      const face = faces.find((block) => new RegExp(`font-weight:\\s*${weight}\\s*;`).test(block) && block.includes("format('truetype')"));
      const url = face?.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/)?.[1];
      if (!url || new URL(url).hostname !== 'fonts.gstatic.com') throw new Error('Fuente no disponible');
      return url;
    };
    const regularUrl = fontUrl(400);
    let boldUrl = regularUrl;
    try { boldUrl = fontUrl(700); } catch { /* Algunas familias solo tienen un peso. */ }
    const loadFont = async (url: string) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('No se pudo descargar la fuente');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 2_000_000 || bytes.length < 1000) throw new Error('Archivo de fuente inválido');
      return bytes;
    };
    const regularBytes = await loadFont(regularUrl);
    const boldBytes = boldUrl === regularUrl ? regularBytes : await loadFont(boldUrl);
    pdf.registerFontkit(fontkit);
    return {
      regular: await pdf.embedFont(regularBytes, { subset: true }),
      bold: await pdf.embedFont(boldBytes, { subset: true }),
    };
  } catch {
    return fallback();
  }
}

function stringifyAnswer(value: unknown, type?: string): string {
  if (typeof value === 'string' && value.startsWith('data:')) return 'Archivo adjunto';
  if (value === true) return 'Sí, acepto';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (type === 'fiscal_address' && value && typeof value === 'object') {
    const address = value as Record<string, unknown>;
    const text = (key: string) => typeof address[key] === 'string' ? String(address[key]).trim() : '';
    return [
      [text('street'), text('exteriorNumber'), text('interiorNumber') && `Int. ${text('interiorNumber')}`].filter(Boolean).join(' '),
      text('neighborhood'), text('city'), text('state'),
    ].filter(Boolean).join(', ') || 'Sin respuesta';
  }
  if (value && typeof value === 'object') return 'Evidencia capturada';
  return String(value ?? 'Sin respuesta');
}

function responseAnswer(answers: Record<string, unknown>, field: any): unknown {
  return answers[field.id] ?? answers[field.slug];
}

function submittedEmail(row: any, fields: any[]): string {
  if (typeof row.respondent_email === 'string' && row.respondent_email.trim()) return row.respondent_email.trim();
  const emailField = fields.find((field) => field.type === 'email');
  const answer = emailField && responseAnswer(row.response_data || {}, emailField);
  return typeof answer === 'string' && answer.trim() ? answer.trim() : 'No proporcionado';
}

function responseAttachments(answers: Record<string, unknown>, fields: any[]) {
  return fields.flatMap((field) => {
    if (field.type !== 'imagen' && field.type !== 'documento') return [];
    const value = responseAnswer(answers, field);
    if (typeof value !== 'string') return [];
    const match = value.match(/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return [];
    const extension = match[1] === 'application/pdf' ? 'pdf' : match[1].split('/')[1] === 'jpeg' ? 'jpg' : match[1].split('/')[1];
    return [{ label: String(field.label || 'Archivo'), filename: `${String(field.slug || field.id || 'anexo').replace(/[^a-z0-9_-]/gi, '_')}.${extension}`, mimeType: match[1], data: match[2] }];
  });
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const original of paragraph.trim().split(/\s+/)) {
      let word = original;
      while (word.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalAnswerData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAnswerData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonicalAnswerData(item)]));
  }
  return value;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceRole = (globalThis as any).Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authorization = req.headers.get('Authorization')?.replace('Bearer ', '') || '';
    if (!serviceRole || authorization !== serviceRole) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = (globalThis as any).Deno?.env.get('SUPABASE_URL') || '';
    const siteUrl = (globalThis as any).Deno?.env.get('NEXT_PUBLIC_SITE_URL') || 'https://docubox-docubox.vercel.app';
    const supabase = createClient(supabaseUrl, serviceRole);
    const { response_id } = await req.json();
    if (!response_id) return new Response(JSON.stringify({ error: 'response_id es requerido' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: responseRow, error } = await supabase
      .from('form_responses')
      .select('*, form_templates(*)')
      .eq('id', response_id)
      .single();
    if (error || !responseRow) return new Response(JSON.stringify({ error: 'Respuesta no encontrada' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const template = responseRow.form_templates;
    const fields = template.form_schema?.fields || template.schema || [];
    const requiresSignature = requiresFormSignature(template.settings, fields);
    const sections = template.form_schema?.sections || template.settings?.sections || [{ id: 'general', title: 'Información', showInPdf: true }];
    const pdfSchema = Object.keys(template.pdf_schema || {}).length ? template.pdf_schema : template.settings?.pdfSchema || {};
    const pageDimensions = pdfSchema.pageSize === 'a4' ? [595.28, 841.89] : [612, 792];
    if (pdfSchema.orientation === 'landscape') pageDimensions.reverse();
    const PAGE = { width: pageDimensions[0], height: pageDimensions[1], margin: pdfSchema.margins === 'narrow' ? 28 : pdfSchema.margins === 'wide' ? 72 : 54 };
    const primary = hexToRgb(pdfSchema.primaryColor || '#1E6BFF');
    const folio = responseRow.folio || `FORM-${new Date().getFullYear()}-${response_id.slice(0, 8).toUpperCase()}`;
    const validationUrl = `${siteUrl}/validar-formulario/${response_id}`;
    const answers = responseRow.response_data || {};
    const answerHash = pdfSchema.showHash !== false
      ? await sha256Hex(new TextEncoder().encode(JSON.stringify(canonicalAnswerData(answers)))) : '';

    const pdf = await PDFDocument.create();
    const { regular, bold } = await embedFormFonts(pdf, pdfSchema.typography);
    let page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - PAGE.margin;

    const newPage = () => {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    };
    const ensureSpace = (height: number) => { if (y - height < PAGE.margin + 30) newPage(); };

    const alignedX = (text: string, size: number) => {
      const width = bold.widthOfTextAtSize(text, size);
      return pdfSchema.headerAlignment === 'center' ? Math.max(PAGE.margin, (PAGE.width - width) / 2) : pdfSchema.headerAlignment === 'right' ? Math.max(PAGE.margin, PAGE.width - PAGE.margin - width) : PAGE.margin;
    };
    if (pdfSchema.coverPage === true) {
      const coverHeader = pdfSchema.header ?? 'DOCUBOX · FORMULARIO FIRMABLE';
      for (const line of wrapText(coverHeader, Math.floor((PAGE.width - PAGE.margin * 2) / 6))) {
        page.drawText(line, { x: alignedX(line, 10), y, size: 10, font: bold, color: primary }); y -= 14;
      }
      y -= 76;
      for (const line of wrapText(template.name, Math.max(20, Math.floor((PAGE.width - PAGE.margin * 2) / 12)))) {
        page.drawText(line, { x: alignedX(line, 24), y, size: 24, font: bold, color: rgb(0.09, 0.09, 0.11) });
        y -= 30;
      }
      if (pdfSchema.showDescription !== false && template.description) {
        y -= 12;
        for (const line of wrapText(template.description, Math.max(20, Math.floor((PAGE.width - PAGE.margin * 2) / 6)))) {
          page.drawText(line, { x: PAGE.margin, y, size: 10, font: regular, color: rgb(0.32, 0.32, 0.36) });
          y -= 15;
        }
      }
      if (pdfSchema.showFolio !== false) page.drawText(`Folio: ${folio}`, { x: PAGE.margin, y: PAGE.margin + 40, size: 9, font: regular, color: rgb(0.32, 0.32, 0.36) });
      newPage();
    }
    const headerText = pdfSchema.header ?? 'DOCUBOX · FORMULARIO FIRMABLE';
    for (const line of wrapText(headerText, Math.floor((PAGE.width - PAGE.margin * 2) / 5))) {
      page.drawText(line, { x: alignedX(line, 8), y, size: 8, font: bold, color: primary }); y -= 11;
    }
    y -= 15;
    wrapText(template.name, 55).forEach((line) => { page.drawText(line, { x: alignedX(line, 18), y, size: 18, font: bold, color: rgb(0.09, 0.09, 0.11) }); y -= 22; });
    y -= 8;
    if (pdfSchema.showDescription !== false && template.description) {
      for (const line of wrapText(template.description, Math.floor((PAGE.width - PAGE.margin * 2) / 6))) { ensureSpace(16); page.drawText(line, { x: PAGE.margin, y, size: 10, font: regular, color: rgb(0.32, 0.32, 0.36) }); y -= 14; }
      y -= 8;
    }
    if (pdfSchema.showFolio !== false) page.drawText(`Folio: ${folio}`, { x: PAGE.margin, y, size: 9, font: regular, color: rgb(0.32, 0.32, 0.36) });
    if (pdfSchema.showDate !== false) page.drawText(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { x: PAGE.width - PAGE.margin - 110, y, size: 9, font: regular, color: rgb(0.32, 0.32, 0.36) });
    y -= 22;
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: rgb(0.92, 0.92, 0.94) });
    y -= 24;
    if (pdfSchema.showRespondentEmail !== false || pdfSchema.showIp !== false) {
      const metadata = [
        ...(pdfSchema.showRespondentEmail !== false ? [`Correo del participante: ${submittedEmail(responseRow, fields)}`] : []),
        ...(pdfSchema.showIp !== false ? [`Dirección IP: ${responseRow.ip_address || 'No disponible'}`] : []),
      ];
      for (const item of metadata) {
        for (const line of wrapText(item, Math.max(35, Math.floor((PAGE.width - PAGE.margin * 2) / 5)))) {
          ensureSpace(15);
          page.drawText(line, { x: PAGE.margin, y, size: 9, font: regular, color: rgb(0.32, 0.32, 0.36) });
          y -= 13;
        }
      }
      y -= 8;
    }

    const pdfSections = sections.filter((section: any) => section.showInPdf !== false);
    for (const [sectionIndex, section] of pdfSections.entries()) {
      const sectionFields = fields.filter((field: any) =>
        (field.pdf?.sectionId || field.sectionId) === section.id &&
        field.pdf?.show !== false &&
        (pdfSchema.showUnanswered === true || (answers[field.id] ?? answers[field.slug]) !== undefined && (answers[field.id] ?? answers[field.slug]) !== null && (answers[field.id] ?? answers[field.slug]) !== '')
      );
      if (!sectionFields.length) continue;
      if ((section.pageBreakBefore && sectionIndex > 0) || sectionFields[0]?.pdf?.pageBreakBefore) newPage();
      ensureSpace(55);
      page.drawRectangle({ x: PAGE.margin, y: y - 3, width: 3, height: 16, color: primary });
      page.drawText(`${pdfSchema.showSectionNumbers === false ? '' : `${sectionIndex + 1}. `}${section.title}`, { x: PAGE.margin + 12, y, size: 12, font: bold, color: rgb(0.09, 0.09, 0.11) });
      y -= 27;
      const twoColumns = pdfSchema.columns !== 'one';
      const gap = 20;
      const columnWidth = (PAGE.width - PAGE.margin * 2 - gap) / 2;
      let rightColumn = false;
      let rowTop = y;
      let rowBottom = y;
      for (const [fieldIndex, field] of sectionFields.entries()) {
        if (fieldIndex > 0 && field.pdf?.pageBreakBefore) {
          if (rightColumn) y = rowBottom;
          newPage();
          rightColumn = false;
          rowTop = y;
          rowBottom = y;
        }
        const fullWidth = !twoColumns || ['textarea', 'fiscal_address', 'declaration', 'consentimiento', 'signature_block'].includes(field.type);
        if (fullWidth && rightColumn) { y = rowBottom; rightColumn = false; rowTop = y; }
        const width = fullWidth ? PAGE.width - PAGE.margin * 2 : columnWidth;
        const answer = stringifyAnswer(responseRow.response_data?.[field.id] ?? responseRow.response_data?.[field.slug], field.type);
        const lines = wrapText(answer, Math.max(12, Math.floor(width / 6)));
        const labels = wrapText(field.pdf?.label || field.label, Math.max(12, Math.floor(width / 5)));
        const height = field.type === 'signature_block' ? 112 : 22 + labels.length * 11 + lines.length * 13;
        if (!rightColumn) { ensureSpace(height); rowTop = y; rowBottom = y; }
        else if (rowTop - height < PAGE.margin + 30) { y = rowBottom; newPage(); rightColumn = false; rowTop = y; rowBottom = y; }
        const x = PAGE.margin + (rightColumn ? columnWidth + gap : 0);
        y = rowTop;
        for (const label of labels) { page.drawText(label, { x, y, size: 8, font: bold, color: rgb(0.44, 0.44, 0.48) }); y -= 11; }
        if (field.type === 'signature_block') {
          y -= 82;
          page.drawRectangle({ x, y, width, height: 76, borderColor: rgb(0.78, 0.81, 0.86), borderWidth: 0.8 });
          page.drawText('Espacio reservado para firma', { x: x + 12, y: y + 38, size: 9, font: regular, color: rgb(0.44, 0.44, 0.48) });
        } else {
          for (const line of lines) { page.drawText(line, { x, y, size: 10, font: regular, color: rgb(0.15, 0.15, 0.17) }); y -= 13; }
          page.drawLine({ start: { x, y: y + 5 }, end: { x: x + width, y: y + 5 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.92) });
        }
        y -= 10;
        rowBottom = Math.min(rowBottom, y);
        if (!fullWidth && !rightColumn) { rightColumn = true; y = rowTop; }
        else { rightColumn = false; y = rowBottom; rowTop = y; }
      }
      y = rowBottom;
      y -= 8;
    }

    if (pdfSchema.consentPage === true) {
      newPage();
      page.drawText('CONSENTIMIENTO Y DECLARACIONES', { x: PAGE.margin, y, size: 14, font: bold, color: primary });
      y -= 32;
      const consentFields = fields.filter((field: any) => ['consentimiento', 'declaration'].includes(field.type));
      if (!consentFields.length) {
        page.drawText('No se configuraron campos de consentimiento.', { x: PAGE.margin, y, size: 9, font: regular });
      }
      for (const field of consentFields) {
        ensureSpace(60);
        for (const line of wrapText(String(field.label || 'Declaración'), 75)) {
          page.drawText(line, { x: PAGE.margin, y, size: 10, font: bold }); y -= 14;
        }
        if (field.description) {
          for (const line of wrapText(String(field.description), 85)) {
            ensureSpace(15); page.drawText(line, { x: PAGE.margin, y, size: 9, font: regular }); y -= 13;
          }
        }
        for (const line of wrapText(stringifyAnswer(responseAnswer(answers, field), field.type), 85)) {
          ensureSpace(15); page.drawText(line, { x: PAGE.margin, y, size: 9, font: regular }); y -= 13;
        }
        y -= 12;
      }
    }

    if (pdfSchema.showAttachments !== false) {
      const attachments = responseAttachments(answers, fields);
      if (attachments.length) {
        newPage();
        page.drawText('ANEXOS', { x: PAGE.margin, y, size: 14, font: bold, color: primary }); y -= 30;
        let totalBytes = 0;
        for (const attachment of attachments) {
          ensureSpace(45);
          const bytes = Uint8Array.from(atob(attachment.data), (char) => char.charCodeAt(0));
          totalBytes += bytes.length;
          if (bytes.length > 10_000_000 || totalBytes > 20_000_000) throw new Error('Los anexos exceden el tamaño máximo del PDF.');
          await pdf.attach(bytes, attachment.filename, { mimeType: attachment.mimeType, description: attachment.label });
          page.drawText(attachment.label.slice(0, 70), { x: PAGE.margin, y, size: 10, font: bold }); y -= 14;
          page.drawText(`${attachment.filename} · ${Math.ceil(bytes.length / 1024)} KB`, { x: PAGE.margin, y, size: 9, font: regular }); y -= 21;
        }
      }
    }

    if (pdfSchema.showEvidenceSheet !== false || pdfSchema.showQr !== false || pdfSchema.showHash !== false || pdfSchema.showAuditTrail !== false) {
      newPage();
      page.drawText('EVIDENCIA E INTEGRIDAD', { x: PAGE.margin, y, size: 14, font: bold, color: primary });
      y -= 30;
      const evidence = pdfSchema.showEvidenceSheet !== false ? [
        ['ID de respuesta', response_id],
        ...(pdfSchema.showFolio !== false ? [['Folio', folio]] : []),
        ['Fecha y hora', responseRow.submitted_at || new Date().toISOString()],
        ['User agent', responseRow.user_agent || 'No disponible'],
      ] : [];
      if (pdfSchema.showEvidenceSheet !== false && pdfSchema.showIp !== false) evidence.push(['IP', responseRow.ip_address || 'No disponible']);
      for (const [label, value] of evidence) {
        ensureSpace(35);
        page.drawText(label, { x: PAGE.margin, y, size: 8, font: bold, color: rgb(0.44, 0.44, 0.48) }); y -= 13;
        for (const line of wrapText(String(value), 82)) { ensureSpace(14); page.drawText(line, { x: PAGE.margin, y, size: 9, font: regular, color: rgb(0.15, 0.15, 0.17) }); y -= 12; }
        y -= 8;
      }
      if (pdfSchema.showHash !== false) {
        ensureSpace(45);
        page.drawText('SHA-256 de respuestas', { x: PAGE.margin, y, size: 8, font: bold }); y -= 14;
        page.drawText(answerHash, { x: PAGE.margin, y, size: 8, font: regular }); y -= 25;
      }
      if (pdfSchema.showAuditTrail !== false) {
        const { data: auditEvents, error: auditError } = await supabase.from('form_audit_logs').select('action,created_at').eq('response_id', response_id).order('created_at', { ascending: true });
        if (auditError) throw auditError;
        ensureSpace(35);
        page.drawText('BITÁCORA', { x: PAGE.margin, y, size: 10, font: bold, color: primary }); y -= 18;
        const events = [
          ...(responseRow.submitted_at ? [{ action: 'Respuesta registrada', created_at: responseRow.submitted_at }] : []),
          ...(auditEvents || []),
        ];
        if (!events.length) events.push({ action: 'Respuesta disponible', created_at: new Date().toISOString() });
        for (const event of events) {
          ensureSpace(18);
          page.drawText(`${String(event.created_at || '').slice(0, 19)} · ${String(event.action || '').slice(0, 70)}`, { x: PAGE.margin, y, size: 8, font: regular });
          y -= 16;
        }
        y -= 8;
      }
      if (pdfSchema.showQr !== false) {
        const qrDataUrl = await QRCode.toDataURL(validationUrl, { margin: 1, width: 220 });
        const qr = await pdf.embedPng(Uint8Array.from(atob(qrDataUrl.split(',')[1]), (char) => char.charCodeAt(0)));
        ensureSpace(140);
        page.drawImage(qr, { x: PAGE.margin, y: y - 110, width: 110, height: 110 });
        y -= 118;
        page.drawText('Escanea para validar el documento', { x: PAGE.margin, y, size: 8, font: regular, color: rgb(0.44, 0.44, 0.48) });
      }
    }

    const pages = pdf.getPages();
    pages.forEach((pdfPage, index) => {
      pdfPage.drawLine({ start: { x: PAGE.margin, y: 44 }, end: { x: PAGE.width - PAGE.margin, y: 44 }, thickness: 0.5, color: rgb(0.92, 0.92, 0.94) });
      const footer = pdfSchema.footer ?? 'Documento generado electrónicamente por Docubox';
      wrapText(footer, Math.max(25, Math.floor((PAGE.width - PAGE.margin * 2 - 75) / 3.3)))
        .slice(0, 5).forEach((line, lineIndex) => pdfPage.drawText(line, {
          x: PAGE.margin, y: 34 - lineIndex * 7, size: 6, font: regular, color: rgb(0.63, 0.63, 0.67),
        }));
      if (pdfSchema.showPageNumbers !== false) pdfPage.drawText(`Página ${index + 1} de ${pages.length}`, { x: PAGE.width - PAGE.margin - 65, y: 24, size: 7, font: regular, color: rgb(0.63, 0.63, 0.67) });
    });

    const bytes = await pdf.save();
    const hash = await sha256Hex(bytes);
    const path = `${responseRow.workspace_id}/${template.id}/${response_id}/preliminary.pdf`;
    await supabase.storage.createBucket('form-artifacts', { public: false }).catch(() => undefined);
    const { error: uploadError } = await supabase.storage.from('form-artifacts').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;

    let generatedPdfId: string | null = null;
    const { data: generated, error: generatedError } = await supabase.from('generated_pdfs').insert({
      form_response_id: response_id,
      workspace_id: responseRow.workspace_id,
      storage_path: path,
      unsigned_sha256_hash: hash,
      qr_validation_url: validationUrl,
      status: requiresSignature ? 'ready_to_sign' : 'generated',
    }).select('id').single();
    if (generatedError || !generated) throw generatedError || new Error('No se pudo registrar el PDF generado.');
    generatedPdfId = generated?.id || null;

    await supabase.from('form_responses').update({
      pdf_output_path: path,
      pdf_output_hash: hash,
      generated_pdf_id: generatedPdfId,
      status: requiresSignature ? 'signing' : 'pdf_generated',
    }).eq('id', response_id);

    const eventHash = await sha256Hex(new TextEncoder().encode(`${response_id}:pdf_generated:${hash}`));
    await supabase.from('form_audit_logs').insert({
      workspace_id: responseRow.workspace_id,
      form_id: template.id,
      response_id,
      actor_email: responseRow.respondent_email || null,
      action: 'pdf_generated',
      event_hash: eventHash,
      metadata: { folio, pdf_sha256: hash, storage_path: path },
      ip_address: responseRow.ip_address,
      user_agent: responseRow.user_agent,
    }).catch(() => undefined);

    return new Response(JSON.stringify({ success: true, generated_pdf_id: generatedPdfId, storage_path: path, sha256_hash: hash, validation_url: validationUrl }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
