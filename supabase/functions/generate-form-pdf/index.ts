import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAGE = { width: 612, height: 792, margin: 54 };

function hexToRgb(hex: string) {
  const normalized = (hex || '#4F46E5').replace('#', '');
  return rgb(
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  );
}

function stringifyAnswer(value: unknown): string {
  if (value === true) return 'Sí, acepto';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return 'Evidencia capturada';
  return String(value ?? 'Sin respuesta');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
    const sections = template.form_schema?.sections || template.settings?.sections || [{ id: 'general', title: 'Información', showInPdf: true }];
    const pdfSchema = Object.keys(template.pdf_schema || {}).length ? template.pdf_schema : template.settings?.pdfSchema || {};
    const primary = hexToRgb(pdfSchema.primaryColor || '#4F46E5');
    const folio = responseRow.folio || `FORM-${new Date().getFullYear()}-${response_id.slice(0, 8).toUpperCase()}`;
    const validationUrl = `${siteUrl}/validar-formulario/${response_id}`;

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([PAGE.width, PAGE.height]);
    let y = PAGE.height - PAGE.margin;

    const newPage = () => {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - PAGE.margin;
    };
    const ensureSpace = (height: number) => { if (y - height < PAGE.margin + 30) newPage(); };

    page.drawText(pdfSchema.header || 'DOCUBOX · FORMULARIO FIRMABLE', { x: PAGE.margin, y, size: 8, font: bold, color: primary });
    y -= 26;
    wrapText(template.name, 55).forEach((line) => { page.drawText(line, { x: PAGE.margin, y, size: 18, font: bold, color: rgb(0.09, 0.09, 0.11) }); y -= 22; });
    y -= 8;
    page.drawText(`Folio: ${folio}`, { x: PAGE.margin, y, size: 9, font: regular, color: rgb(0.32, 0.32, 0.36) });
    page.drawText(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { x: 410, y, size: 9, font: regular, color: rgb(0.32, 0.32, 0.36) });
    y -= 22;
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: rgb(0.92, 0.92, 0.94) });
    y -= 24;

    for (const [sectionIndex, section] of sections.entries()) {
      if (section.showInPdf === false) continue;
      const sectionFields = fields.filter((field: any) => (field.pdf?.sectionId || field.sectionId) === section.id && field.pdf?.show !== false);
      if (!sectionFields.length) continue;
      if (section.pageBreakBefore && sectionIndex > 0) newPage();
      ensureSpace(55);
      page.drawRectangle({ x: PAGE.margin, y: y - 3, width: 3, height: 16, color: primary });
      page.drawText(`${sectionIndex + 1}. ${section.title}`, { x: PAGE.margin + 12, y, size: 12, font: bold, color: rgb(0.09, 0.09, 0.11) });
      y -= 27;
      for (const field of sectionFields) {
        const answer = stringifyAnswer(responseRow.response_data?.[field.id] ?? responseRow.response_data?.[field.slug]);
        const lines = wrapText(answer, 82);
        ensureSpace(32 + lines.length * 13);
        page.drawText(field.pdf?.label || field.label, { x: PAGE.margin, y, size: 8, font: bold, color: rgb(0.44, 0.44, 0.48) });
        y -= 13;
        for (const line of lines) { page.drawText(line, { x: PAGE.margin, y, size: 10, font: regular, color: rgb(0.15, 0.15, 0.17) }); y -= 13; }
        page.drawLine({ start: { x: PAGE.margin, y: y + 5 }, end: { x: PAGE.width - PAGE.margin, y: y + 5 }, thickness: 0.5, color: rgb(0.9, 0.9, 0.92) });
        y -= 10;
      }
      y -= 8;
    }

    if (pdfSchema.showEvidenceSheet !== false) {
      newPage();
      page.drawText('EVIDENCIA E INTEGRIDAD', { x: PAGE.margin, y, size: 14, font: bold, color: primary });
      y -= 30;
      const evidence = [
        ['ID de respuesta', response_id], ['Folio', folio],
        ['Fecha y hora', responseRow.submitted_at || new Date().toISOString()],
        ['IP', responseRow.ip_address || 'No disponible'], ['User agent', responseRow.user_agent || 'No disponible'],
      ];
      evidence.forEach(([label, value]) => { page.drawText(label, { x: PAGE.margin, y, size: 8, font: bold, color: rgb(0.44, 0.44, 0.48) }); y -= 13; wrapText(String(value), 82).forEach((line) => { page.drawText(line, { x: PAGE.margin, y, size: 9, font: regular, color: rgb(0.15, 0.15, 0.17) }); y -= 12; }); y -= 8; });
      if (pdfSchema.showQr !== false) {
        const qrDataUrl = await QRCode.toDataURL(validationUrl, { margin: 1, width: 220 });
        const qr = await pdf.embedPng(Uint8Array.from(atob(qrDataUrl.split(',')[1]), (char) => char.charCodeAt(0)));
        page.drawImage(qr, { x: PAGE.margin, y: PAGE.margin + 40, width: 110, height: 110 });
        page.drawText('Escanea para validar el documento', { x: PAGE.margin, y: PAGE.margin + 25, size: 8, font: regular, color: rgb(0.44, 0.44, 0.48) });
      }
    }

    const pages = pdf.getPages();
    pages.forEach((pdfPage, index) => {
      pdfPage.drawLine({ start: { x: PAGE.margin, y: 38 }, end: { x: PAGE.width - PAGE.margin, y: 38 }, thickness: 0.5, color: rgb(0.92, 0.92, 0.94) });
      pdfPage.drawText(pdfSchema.footer || 'Documento generado electrónicamente por Docubox', { x: PAGE.margin, y: 24, size: 7, font: regular, color: rgb(0.63, 0.63, 0.67) });
      if (pdfSchema.showPageNumbers !== false) pdfPage.drawText(`Página ${index + 1} de ${pages.length}`, { x: 500, y: 24, size: 7, font: regular, color: rgb(0.63, 0.63, 0.67) });
    });

    const bytes = await pdf.save();
    const hash = await sha256Hex(bytes);
    const path = `${responseRow.workspace_id}/${template.id}/${response_id}/preliminary.pdf`;
    await supabase.storage.createBucket('form-artifacts', { public: false }).catch(() => undefined);
    const { error: uploadError } = await supabase.storage.from('form-artifacts').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;

    let generatedPdfId: string | null = null;
    const { data: generated } = await supabase.from('generated_pdfs').insert({
      form_response_id: response_id,
      workspace_id: responseRow.workspace_id,
      storage_path: path,
      unsigned_sha256_hash: hash,
      qr_validation_url: validationUrl,
      status: 'ready_to_sign',
    }).select('id').single();
    generatedPdfId = generated?.id || null;

    await supabase.from('form_responses').update({
      pdf_output_path: path,
      pdf_output_hash: hash,
      generated_pdf_id: generatedPdfId,
      status: template.settings?.requiresSignature ? 'signing' : 'pdf_generated',
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
