import 'server-only';
import { dispatchCaseMail } from './delivery';
import { hashInvitationToken } from './invitations';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { CaseRuntimeError } from './runtime.server';
import { summarizeInvitations, type InvitationSummary } from './invitations';

export function caseInvitationConfig() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    apiKey = process.env.RESEND_API_KEY || '';
  if (secret.length < 32 || !apiKey)
    throw new CaseRuntimeError(
      'CASE_EMAIL_UNAVAILABLE',
      'El envío de invitaciones por correo no está configurado.',
      503
    );
  return { secret, apiKey, from: process.env.FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>' };
}
export function caseInvitationOrigin(request: NextRequest) {
  if (
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1'].includes(request.nextUrl.hostname)
  )
    return request.nextUrl.origin;
  return getPublicAppUrl();
}
export async function caseInvitationSummary(
  service: SupabaseClient,
  caseId: string,
  actorId: string
) {
  const result = await service.rpc('case_invitation_summary', { p_case: caseId, p_actor: actorId });
  if (result.error) throw result.error;
  return summarizeInvitations((result.data || []) as InvitationSummary[]);
}
export async function sendCaseInvitations(
  service: SupabaseClient,
  caseId: string,
  actorId: string
) {
  const config = caseInvitationConfig();
  await dispatchCaseMail(service, caseId, actorId, config);
  return caseInvitationSummary(service, caseId, actorId);
}
export async function configureCaseInvitationDispatch(service: SupabaseClient) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const endpoint = new URL(
    '/functions/v1/case-invitation-dispatch',
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ).toString();
  const result = await service.rpc('case_configure_dispatch', {
    p_url: endpoint,
    p_secret: hashInvitationToken(`case-dispatch:${secret}`),
    p_encryption_secret: secret,
  });
  if (result.error) throw result.error;
}
