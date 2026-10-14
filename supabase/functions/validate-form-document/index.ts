import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function canonicalAnswerData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalAnswerData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonicalAnswerData(item)]));
  }
  return value;
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalAnswerData(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const responseId = new URL(req.url).searchParams.get('id');
    if (!responseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(responseId)) {
      return new Response(JSON.stringify({ error: 'ID de respuesta inválido.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(
      (globalThis as any).Deno?.env.get('SUPABASE_URL') || '',
      (globalThis as any).Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
    const { data, error } = await supabase
      .from('form_responses')
      .select('id, folio, submitted_at, status, pdf_output_hash, pdf_output_path, pdf_evidence_snapshot, response_data, ip_address, user_agent, form_templates(name,pdf_schema,settings)')
      .eq('id', responseId)
      .maybeSingle();
    if (error) return new Response(JSON.stringify({ error: 'No fue posible consultar la respuesta. Intenta nuevamente.' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!data) return new Response(JSON.stringify({ error: 'Documento no encontrado' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const expectedHash = String(data.pdf_output_hash || '').toLowerCase();
    const pdfPath = String(data.pdf_output_path || '');
    let verificationStatus: 'pending' | 'verified' | 'mismatch' | 'unavailable' = 'pending';
    if (/^[0-9a-f]{64}$/.test(expectedHash) && pdfPath) {
      const { data: pdfFile, error: downloadError } = await supabase.storage
        .from('form-artifacts')
        .download(pdfPath, {}, { cache: 'no-store' });
      if (downloadError || !pdfFile) {
        verificationStatus = 'unavailable';
      } else {
        const digest = await crypto.subtle.digest('SHA-256', await pdfFile.arrayBuffer());
        const actualHash = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        verificationStatus = actualHash === expectedHash ? 'verified' : 'mismatch';
      }
    }

    const template = data.form_templates as any;
    const pdfSchema = Object.keys(template?.pdf_schema || {}).length
      ? template.pdf_schema : template?.settings?.pdfSchema || {};
    const showEvidence = pdfSchema.showEvidenceSheet === true;
    const showHash = pdfSchema.showHash === true;
    const showAuditTrail = pdfSchema.showAuditTrail === true;
    const savedEvidence = data.pdf_evidence_snapshot?.pdf_sha256 === expectedHash
      ? data.pdf_evidence_snapshot : null;
    let answersHash: string | null = null;
    let auditTrail: { total: number; events: Array<{ action: string; created_at: string }> } | null = null;

    if (showHash) {
      if (typeof savedEvidence?.answers_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(savedEvidence.answers_sha256)) {
        answersHash = savedEvidence.answers_sha256.toLowerCase();
      } else {
        answersHash = await sha256Hex(data.response_data || {});
      }
    }

    if (showAuditTrail) {
      if (savedEvidence?.audit_trail && Array.isArray(savedEvidence.audit_trail.events)) {
        auditTrail = savedEvidence.audit_trail;
      } else {
        // Legacy PDFs have no saved snapshot. Their available event is the recorded submission.
        const events = data.submitted_at
          ? [{ action: 'Respuesta registrada', created_at: data.submitted_at }] : [];
        auditTrail = { total: events.length, events };
      }
    }

    return new Response(JSON.stringify({
      valid: verificationStatus === 'verified',
      verification_status: verificationStatus,
      response_id: data.id,
      folio: data.folio || `FORM-${new Date(data.submitted_at).getFullYear()}-${data.id.slice(0, 8).toUpperCase()}`,
      form_name: (data.form_templates as any)?.name || 'Formulario firmable',
      submitted_at: data.submitted_at,
      status: data.status,
      sha256_hash: expectedHash || null,
      evidence: {
        ...(showEvidence ? {
          response_id: data.id,
          ...(pdfSchema.showFolio !== false ? { folio: data.folio || `FORM-${new Date(data.submitted_at).getFullYear()}-${data.id.slice(0, 8).toUpperCase()}` } : {}),
          submitted_at_utc: data.submitted_at,
          user_agent: data.user_agent ? String(data.user_agent).slice(0, 180) : null,
          ...(pdfSchema.showIp === true ? { ip_address: data.ip_address || null } : {}),
        } : {}),
        ...(showHash ? { answers_sha256: answersHash } : {}),
        ...(showAuditTrail ? { audit_trail: auditTrail } : {}),
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
