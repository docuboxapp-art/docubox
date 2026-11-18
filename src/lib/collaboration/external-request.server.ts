import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OrganizationApiError } from '@/lib/organization/server';
import { hasCurrentCollaborationEntitlement } from '@/lib/collaboration/entitlements-server';

export const collaborationTokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function authorizeExternalCollaborationRequest(
  service: SupabaseClient,
  request: Request,
  token: string,
  write = false
) {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token))
    throw new OrganizationApiError(404, 'request_not_found', 'La solicitud no está disponible.');
  const result = await service
    .from('collaboration_document_requests')
    .select('*')
    .eq('access_token_hash', collaborationTokenHash(token))
    .maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (
    !row ||
    !['sent', 'in_progress', 'in_review', 'completed'].includes(row.status) ||
    (row.access_expires_at && Date.parse(row.access_expires_at) <= Date.now())
  )
    throw new OrganizationApiError(410, 'request_expired', 'La solicitud venció o fue cancelada.');
  if (write && !['sent', 'in_progress'].includes(row.status))
    throw new OrganizationApiError(
      409,
      'request_locked',
      'La solicitud ya está en revisión o completada.'
    );
  if (
    !(await hasCurrentCollaborationEntitlement(
      service,
      row.workspace_id,
      'collaboration_core',
      write
    ))
  )
    throw new OrganizationApiError(
      403,
      'collaboration_unavailable',
      'La organización no tiene habilitada esta operación. Contacta a quien te invitó.'
    );
  const sessionToken = request.headers.get('x-colabora-session') || '';
  if (!sessionToken)
    throw new OrganizationApiError(401, 'session_required', 'Verifica tu correo para continuar.');
  const session = await service
    .from('collaboration_request_external_sessions')
    .select('id,request_id,expires_at')
    .eq('request_id', row.id)
    .eq('session_token_hash', collaborationTokenHash(sessionToken))
    .is('revoked_at', null)
    .not('otp_consumed_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (session.error) throw session.error;
  if (!session.data)
    throw new OrganizationApiError(
      401,
      'session_expired',
      'La sesión venció. Vuelve a verificar tu correo.'
    );
  return { documentRequest: row, session: session.data };
}
