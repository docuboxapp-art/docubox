import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { readStoredIdentityImage } from './capture-crypto';

type ServiceClient = ReturnType<typeof createServiceClient>;

export async function findStoredIdentity(
  supabase: ServiceClient,
  userId: string,
  key: Buffer
): Promise<{ front: string; curp: string | null; nombre: string | null } | null> {
  // The newest approved capture is usually enough. Only fetch older images if
  // the newest row cannot be read, avoiding a large biometric payload on each QR.
  for (const [from, to] of [
    [0, 0],
    [1, 9],
  ]) {
    const { data: captures, error: captureError } = await supabase
      .from('id_capture_logs')
      .select('anverso_b64,curp_extracted,nombre_extracted')
      .eq('user_id', userId)
      .eq('nubarium_aprobado', true)
      .not('anverso_b64', 'is', null)
      .order('captured_at', { ascending: false })
      .range(from, to);
    if (captureError) throw captureError;

    for (const capture of captures || []) {
      const front = readStoredIdentityImage(capture.anverso_b64, key);
      if (front) {
        return {
          front,
          curp: capture.curp_extracted || null,
          nombre: capture.nombre_extracted || null,
        };
      }
    }
    if (!captures?.length) break;
  }

  const { data: results, error: resultError } = await supabase
    .from('enrollment_results')
    .select('enrollment_token_id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(10);
  if (resultError) throw resultError;

  for (const result of results || []) {
    if (!result.enrollment_token_id) continue;
    const { data: token, error: tokenError } = await supabase
      .from('enrollment_tokens')
      .select('anverso_encrypted')
      .eq('id', result.enrollment_token_id)
      .maybeSingle();
    if (tokenError) throw tokenError;
    if (!token?.anverso_encrypted) continue;
    const front = readStoredIdentityImage(token.anverso_encrypted, key);
    if (front) return { front, curp: null, nombre: null };
  }
  return null;
}
