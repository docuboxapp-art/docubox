import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  try {
    const { case_file_id } = await request.json();
    if (!case_file_id) return respond({ valid: false, error: 'Identificador requerido.' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const { data } = await admin.from('case_file_closure_certificates').select('certificate_number,root_hash,hash_algorithm,closed_at,verification_url,case_files(folio,title,case_type,status)').eq('case_file_id', case_file_id).maybeSingle();
    if (!data) return respond({ valid: false, error: 'No existe una constancia de cierre para este expediente.' }, 404);
    return respond({ valid: true, certificate_number: data.certificate_number, root_hash: data.root_hash, hash_algorithm: data.hash_algorithm, closed_at: data.closed_at, case_file: data.case_files });
  } catch { return respond({ valid: false, error: 'No se pudo verificar el expediente.' }, 500); }
});

