import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responseHeaders = {
  ...cors,
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const unavailable = 'No se pudo verificar el expediente.';
const missing = 'La constancia no está disponible.';
const unauthenticated = 'Inicia sesión para verificar la constancia.';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders });
const failure = (error: string, status: number) => json({ valid: false, error }, status);

export function createCaseVerificationHandler(
  createCallerClient: (token: string) => Pick<SupabaseClient, 'auth' | 'from'>
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (request.method !== 'POST') return failure('Método no admitido.', 405);

    const token = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return failure(unauthenticated, 401);

    try {
      const supabase = createCallerClient(token);
      const { data: auth, error: authError } = await supabase.auth.getUser(token);
      if (authError) {
        return [401, 403, 404].includes(authError.status ?? 0)
          ? failure(unauthenticated, 401)
          : failure(unavailable, 503);
      }
      if (!auth.user) return failure(unauthenticated, 401);
      const body: unknown = await request.json().catch(() => null);
      const caseId =
        body && typeof body === 'object' && 'case_file_id' in body ? body.case_file_id : null;
      if (typeof caseId !== 'string' || !uuid.test(caseId)) {
        return failure('Identificador inválido.', 400);
      }

      // Both sides retain case_active_membership and case_workspace_isolation RLS.
      const { data, error } = await supabase
        .from('case_file_closure_certificates')
        .select(
          'certificate_number,root_hash,hash_algorithm,closed_at,workspace_id,case_files!inner(workspace_id,folio,title,case_type,status)'
        )
        .eq('case_file_id', caseId)
        .maybeSingle();
      if (error) return failure(unavailable, 503);
      const caseFile = Array.isArray(data?.case_files) ? data.case_files[0] : data?.case_files;
      if (!data || !caseFile || data.workspace_id !== caseFile.workspace_id) {
        return failure(missing, 404);
      }

      return json(
        {
          valid: true,
          certificate_number: data.certificate_number,
          root_hash: data.root_hash,
          hash_algorithm: data.hash_algorithm,
          closed_at: data.closed_at,
          case_file: {
            folio: caseFile.folio,
            title: caseFile.title,
            case_type: caseFile.case_type,
            status: caseFile.status,
          },
        },
        200
      );
    } catch {
      return failure(unavailable, 503);
    }
  };
}
