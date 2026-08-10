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
    if (!responseId) return new Response(JSON.stringify({ error: 'id es requerido' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const supabase = createClient(
      (globalThis as any).Deno?.env.get('SUPABASE_URL') || '',
      (globalThis as any).Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );
    const { data, error } = await supabase
      .from('form_responses')
      .select('id, folio, submitted_at, status, pdf_output_hash, generated_pdf_id, form_templates(name)')
      .eq('id', responseId)
      .single();
    if (error || !data) return new Response(JSON.stringify({ error: 'Documento no encontrado' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({
      valid: Boolean(data.pdf_output_hash),
      response_id: data.id,
      folio: data.folio || `FORM-${new Date(data.submitted_at).getFullYear()}-${data.id.slice(0, 8).toUpperCase()}`,
      form_name: (data.form_templates as any)?.name || 'Formulario firmable',
      submitted_at: data.submitted_at,
      status: data.status,
      sha256_hash: data.pdf_output_hash,
      generated_pdf_id: data.generated_pdf_id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
