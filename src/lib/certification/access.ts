import type { SupabaseClient } from '@supabase/supabase-js';
import { CertificationError } from './types';

export type CertificationAccessRole = 'OWNER' | 'WORKSPACE_ADMIN';

/**
 * Technical certification artifacts are limited to the document owner and
 * active workspace administrators. Participants can still access their own
 * participation evidence through its dedicated flow.
 */
export async function requireCertificationManagerAccess(
  supabase: SupabaseClient,
  documentId: string,
  userId: string,
): Promise<{ document: { id: string; owner_id: string; workspace_id: string | null }; role: CertificationAccessRole }> {
  const { data: document, error } = await supabase
    .from('documentos')
    .select('id,owner_id,workspace_id')
    .eq('id', documentId)
    .maybeSingle();

  if (error || !document) {
    throw new CertificationError('DOCUMENT_NOT_FOUND', 'Documento no encontrado.', 404);
  }
  if (document.owner_id === userId) {
    return { document, role: 'OWNER' };
  }
  if (!document.workspace_id) {
    throw new CertificationError('CERTIFICATION_ACCESS_DENIED', 'No tienes permisos para consultar la certificacion.', 403);
  }

  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', document.workspace_id)
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('role', ['owner', 'admin'])
    .maybeSingle();

  if (membershipError || !membership) {
    throw new CertificationError('CERTIFICATION_ACCESS_DENIED', 'No tienes permisos para consultar la certificacion.', 403);
  }
  return { document, role: 'WORKSPACE_ADMIN' };
}
