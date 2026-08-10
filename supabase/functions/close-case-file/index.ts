import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import QRCode from 'https://esm.sh/qrcode@1.5.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function sha256(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

function wrap(text: string, size = 82) {
  const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (candidate.length > size && line) { lines.push(line); line = word; } else line = candidate; }
  if (line) lines.push(line); return lines;
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const site = Deno.env.get('NEXT_PUBLIC_SITE_URL') || 'https://docubox-docubox.vercel.app';
    const token = request.headers.get('Authorization') || '';
    const authClient = createClient(url, anon, { global: { headers: { Authorization: token } } });
    const { data: userData } = await authClient.auth.getUser();
    if (!userData.user) return json({ error: 'Sesión no válida.' }, 401);
    const admin = createClient(url, service);
    const { case_file_id, mfa_verified, legal_confirmation } = await request.json();
    if (!case_file_id || !mfa_verified || !legal_confirmation) return json({ error: 'Se requiere confirmación legal y MFA para cerrar.' }, 400);

    const { data: caseFile } = await admin.from('case_files').select('*').eq('id', case_file_id).single();
    if (!caseFile) return json({ error: 'Expediente no encontrado.' }, 404);
    const { data: membership } = await admin.from('workspace_members').select('role').eq('workspace_id', caseFile.workspace_id).eq('user_id', userData.user.id).maybeSingle();
    if (!membership || !['owner','admin'].includes(membership.role)) return json({ error: 'No tienes autorización para realizar el cierre hermético.' }, 403);
    if (caseFile.status === 'sealed') return json({ error: 'El expediente ya se encuentra cerrado.' }, 409);

    const [documents, forms, identities, milestones, signatures, observations, audits, participants] = await Promise.all([
      admin.from('case_file_documents').select('*').eq('case_file_id', case_file_id),
      admin.from('case_file_form_submissions').select('*').eq('case_file_id', case_file_id),
      admin.from('case_file_identity_checks').select('*').eq('case_file_id', case_file_id),
      admin.from('case_file_milestones').select('*').eq('case_file_id', case_file_id),
      admin.from('case_file_signatures').select('*').eq('case_file_id', case_file_id),
      admin.from('case_file_observations').select('*').eq('case_file_id', case_file_id).eq('status', 'open'),
      admin.from('case_file_audit_events').select('*').eq('case_file_id', case_file_id).order('occurred_at'),
      admin.from('case_file_participants').select('id,name,role,rfc').eq('case_file_id', case_file_id),
    ]);

    const blockers: string[] = [];
    if ((documents.data || []).some((item) => item.is_required && item.status !== 'approved' && item.status !== 'signed')) blockers.push('Hay documentos obligatorios sin aprobar.');
    if ((forms.data || []).some((item) => !['submitted','approved','locked'].includes(item.status))) blockers.push('Hay formularios sin completar.');
    if ((identities.data || []).some((item) => item.status !== 'approved')) blockers.push('Hay validaciones de identidad pendientes.');
    if ((milestones.data || []).some((item) => !['completed','cancelled'].includes(item.status))) blockers.push('Hay hitos pendientes.');
    if ((signatures.data || []).some((item) => item.status !== 'signed')) blockers.push('Hay firmas pendientes.');
    if ((observations.data || []).length) blockers.push('Existen observaciones abiertas.');
    if (blockers.length) return json({ error: 'El expediente todavía no puede cerrarse.', blockers }, 409);

    const closedAt = new Date().toISOString();
    const manifest = {
      manifest_version: '1.0', system: 'Docubox', system_version: '2026.08', hash_algorithm: 'SHA-256',
      case_file: { id: caseFile.id, folio: caseFile.folio, title: caseFile.title, type: caseFile.case_type, workspace_id: caseFile.workspace_id, opened_at: caseFile.opened_at, closed_at: closedAt, closed_by: userData.user.id },
      participants: participants.data || [],
      documents: (documents.data || []).map((item) => ({ id: item.id, name: item.document_name, version: item.current_version, sha256_hash: item.sha256_hash, status: item.status })),
      form_submissions: (forms.data || []).map((item) => ({ id: item.id, sha256_hash: item.sha256_hash, status: item.status })),
      signatures: (signatures.data || []).map((item) => ({ id: item.id, type: item.signature_type, status: item.status, document_hash: item.signed_document_hash, evidence: item.evidence })),
      identity_checks: (identities.data || []).map((item) => ({ id: item.id, method: item.method, status: item.status, evidence_hash: item.evidence_hash })),
      milestones: (milestones.data || []).map((item) => ({ id: item.id, title: item.title, status: item.status, completed_at: item.completed_at })),
      audit_chain: (audits.data || []).map((item) => ({ id: item.id, event_hash: item.event_hash, previous_hash: item.previous_hash, occurred_at: item.occurred_at })),
    };
    const rootHash = await sha256(JSON.stringify(manifest));
    const verificationUrl = `${site}/validar-expediente/${caseFile.id}`;
    const manifestPath = `${caseFile.workspace_id}/${caseFile.id}/closure/manifest-${rootHash.slice(0, 12)}.json`;
    await admin.storage.from('case-files').upload(manifestPath, new Blob([JSON.stringify({ ...manifest, root_hash: rootHash }, null, 2)], { type: 'application/json' }), { upsert: false, contentType: 'application/json' });

    const pdf = await PDFDocument.create(); const page = pdf.addPage([612, 792]);
    const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText('DOCUBOX', { x: 54, y: 734, size: 11, font: bold, color: rgb(0.31, 0.27, 0.9) });
    page.drawText('CONSTANCIA DE CIERRE DE EXPEDIENTE DIGITAL', { x: 54, y: 694, size: 15, font: bold, color: rgb(0.09,0.09,0.11) });
    page.drawLine({ start: { x: 54, y: 678 }, end: { x: 558, y: 678 }, thickness: 1, color: rgb(0.92,0.92,0.94) });
    const fields = [['Folio', caseFile.folio],['Expediente', caseFile.title],['Tipo', caseFile.case_type],['Apertura', new Date(caseFile.opened_at).toLocaleString('es-MX')],['Cierre', new Date(closedAt).toLocaleString('es-MX')],['Documentos', String((documents.data || []).length)],['Formularios', String((forms.data || []).length)],['Firmas', String((signatures.data || []).length)],['Hitos', String((milestones.data || []).length)]];
    let y = 646; for (const [label, value] of fields) { page.drawText(label.toUpperCase(), { x: 54, y, size: 7, font: bold, color: rgb(0.45,0.45,0.5) }); page.drawText(value, { x: 165, y: y - 1, size: 9, font: regular, color: rgb(0.09,0.09,0.11) }); y -= 28; }
    y -= 8; page.drawText('HASH RAÍZ DEL EXPEDIENTE · SHA-256', { x: 54, y, size: 8, font: bold, color: rgb(0.31,0.27,0.9) }); y -= 18;
    wrap(rootHash, 64).forEach((line) => { page.drawText(line, { x: 54, y, size: 8, font: regular, color: rgb(0.25,0.25,0.28) }); y -= 12; });
    y -= 18; const legal = `Se hace constar que el expediente digital identificado con el folio ${caseFile.folio} fue cerrado herméticamente el ${new Date(closedAt).toLocaleString('es-MX')}. A partir de este momento, los documentos, formularios, firmas, evidencias y eventos asociados quedaron bloqueados para modificación ordinaria.`;
    wrap(legal, 88).forEach((line) => { page.drawText(line, { x: 54, y, size: 8.5, font: regular, color: rgb(0.25,0.25,0.28) }); y -= 13; });
    const qrData = await QRCode.toDataURL(verificationUrl, { width: 180, margin: 1 }); const qr = await pdf.embedPng(Uint8Array.from(atob(qrData.split(',')[1]), (char) => char.charCodeAt(0)));
    page.drawImage(qr, { x: 430, y: 65, width: 115, height: 115 }); page.drawText('Verificación de integridad', { x: 430, y: 52, size: 7, font: regular, color: rgb(0.45,0.45,0.5) });
    const pdfBytes = await pdf.save(); const pdfHash = await sha256(pdfBytes); const pdfPath = `${caseFile.workspace_id}/${caseFile.id}/closure/constancia-${pdfHash.slice(0, 12)}.pdf`;
    await admin.storage.from('case-files').upload(pdfPath, pdfBytes, { upsert: false, contentType: 'application/pdf' });

    const { data: manifestRow } = await admin.from('case_file_closure_manifests').insert({ workspace_id: caseFile.workspace_id, case_file_id, manifest_json: manifest, storage_path: manifestPath, root_hash: rootHash, system_version: '2026.08', verification_url: verificationUrl, created_by: userData.user.id }).select('id').single();
    const certificateNumber = `CONST-${caseFile.folio}`;
    const { data: certificate } = await admin.from('case_file_closure_certificates').insert({ workspace_id: caseFile.workspace_id, case_file_id, manifest_id: manifestRow?.id, certificate_number: certificateNumber, pdf_path: pdfPath, root_hash: rootHash, closed_by: userData.user.id, closed_at: closedAt, qr_url: verificationUrl, verification_url: verificationUrl }).select('id').single();
    await admin.from('case_files').update({ status: 'sealed', closure_status: 'sealed', progress: 100, root_hash: rootHash, manifest_id: manifestRow?.id, closure_certificate_id: certificate?.id, sealed_snapshot: manifest, closed_at: closedAt, closed_by: userData.user.id }).eq('id', case_file_id);
    const previousHash = (audits.data || []).at(-1)?.event_hash || null; const eventHash = await sha256(`${previousHash || ''}|case_sealed|${case_file_id}|${closedAt}|${rootHash}`);
    await admin.from('case_file_audit_events').insert({ workspace_id: caseFile.workspace_id, case_file_id, actor_user_id: userData.user.id, actor_label: userData.user.email || 'Usuario interno', action: 'Expediente cerrado herméticamente', affected_object_type: 'case_file', affected_object_id: case_file_id, result: 'success', previous_hash: previousHash, event_hash: eventHash, metadata: { root_hash: rootHash, certificate_number: certificateNumber } });
    return json({ ok: true, root_hash: rootHash, certificate_number: certificateNumber, verification_url: verificationUrl });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'No se pudo cerrar el expediente.' }, 500); }
});

