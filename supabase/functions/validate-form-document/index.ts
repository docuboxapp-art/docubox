import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      .select('id, folio, submitted_at, status, pdf_output_hash, pdf_output_path, form_templates(name)')
      .eq('id', responseId)
      .single();
    if (error || !data) return new Response(JSON.stringify({ error: 'Documento no encontrado' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

    return new Response(JSON.stringify({
      valid: verificationStatus === 'verified',
      verification_status: verificationStatus,
      response_id: data.id,
      folio: data.folio || `FORM-${new Date(data.submitted_at).getFullYear()}-${data.id.slice(0, 8).toUpperCase()}`,
      form_name: (data.form_templates as any)?.name || 'Formulario firmable',
      submitted_at: data.submitted_at,
      status: data.status,
      sha256_hash: expectedHash || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
