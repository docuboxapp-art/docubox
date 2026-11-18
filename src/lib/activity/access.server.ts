import 'server-only';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDocumentIdentity, DocumentAccessError } from '@/lib/security/document-access';
import { decryptInvitationSecret } from '@/lib/case-files/invitations';
import { ownsRecipient, type ActivitySource } from './model';

export const activityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
};
export async function activityIdentity(request: NextRequest) {
  const { user } = await requireDocumentIdentity(request);
  if (user.is_anonymous || !user.email_confirmed_at)
    throw new DocumentAccessError(
      'AUTH_UNVERIFIED',
      'Confirma tu correo para consultar tus participaciones.',
      403
    );
  return { id: user.id, email: user.email.trim().toLowerCase() };
}
export function activityFailure(error: unknown) {
  return error instanceof DocumentAccessError
    ? { error: error.message, status: error.status }
    : { error: 'No se pudo consultar esta información. Intenta nuevamente.', status: 503 };
}
const denied = (
  message = 'Esta participación no está disponible para tu cuenta.',
  status = 403
): never => {
  throw new DocumentAccessError('ACTIVITY_ACCESS_DENIED', message, status);
};

/** Only explicit, authenticated navigation resolves an invitation capability. Lists contain no tokens or codes. */
export async function resolveActivityAccess(
  db: Pick<SupabaseClient, 'from'>,
  actor: { id: string; email: string },
  source: ActivitySource,
  id: string,
  secret: string,
  now = Date.now()
): Promise<string> {
  if (source === 'form-public') {
    const invite = await db
      .from('form_public_invitees')
      .select('form_id')
      .eq('form_id', id)
      .eq('recipient_email', actor.email)
      .maybeSingle();
    if (invite.error) throw invite.error;
    if (!invite.data) return denied();
    const form = await db.from('form_templates').select('status').eq('id', id).maybeSingle();
    if (form.error) throw form.error;
    if (form.data?.status !== 'published')
      return denied('El formulario no está disponible en este momento.', 409);
    return `/formulario-publico/${id}`;
  }
  if (source === 'form-token') {
    const invitation = await db
      .from('form_tokens')
      .select('id,template_id,recipient_email,recipient_user_id,token,expires_at,used_at')
      .eq('id', id)
      .maybeSingle();
    if (invitation.error) throw invitation.error;
    if (!invitation.data || !ownsRecipient(actor, invitation.data)) return denied();
    const binding = await db
      .from('case_portal_form_tokens')
      .select('token_id')
      .eq('token_id', id)
      .maybeSingle();
    if (binding.error) throw binding.error;
    if (binding.data)
      return denied('Este formulario se atiende desde el portal de su expediente.', 409);
    const response = await db
      .from('form_responses')
      .select('status,submitted_at,document_id')
      .eq('token_id', id)
      .maybeSingle();
    if (response.error) throw response.error;
    if (
      response.data?.status !== 'draft' &&
      response.data?.submitted_at &&
      response.data.document_id
    ) {
      const form = await db
        .from('form_templates')
        .select('requires_signature')
        .eq('id', invitation.data.template_id)
        .maybeSingle();
      if (form.error) throw form.error;
      return `${response.data.status !== 'signed' && form.data?.requires_signature ? '/firmar-documento/' : '/visor-documento/'}${response.data.document_id}`;
    }
    if (invitation.data.expires_at && Date.parse(invitation.data.expires_at) <= now)
      return denied('La invitación al formulario venció.', 410);
    const schedules = await db.from('form_send_schedules').select('status').eq('token_id', id);
    if (schedules.error) throw schedules.error;
    if (schedules.data?.some((row) => row.status !== 'sent'))
      return denied('El envío todavía no está disponible.', 409);
    const form = await db
      .from('form_templates')
      .select('status')
      .eq('id', invitation.data.template_id)
      .maybeSingle();
    if (form.error) throw form.error;
    if (form.data?.status !== 'published')
      return denied('El formulario no está disponible en este momento.', 409);
    if (!/^[a-f0-9]{64}$/i.test(invitation.data.token))
      return denied('El enlace del formulario no está disponible.', 409);
    return `/form/${invitation.data.token}`;
  }
  const invitation = await db
    .from('case_participant_invitations')
    .select('id,participant_id,recipient,token_ciphertext,revoked_at,expires_at,not_before')
    .eq('id', id)
    .maybeSingle();
  if (invitation.error) throw invitation.error;
  if (!invitation.data) return denied();
  const grant = await db
    .from('case_invitation_access_grants')
    .select('invitation_id')
    .eq('invitation_id', id)
    .eq('user_id', actor.id)
    .gt('expires_at', new Date(now).toISOString())
    .maybeSingle();
  if (grant.error) throw grant.error;
  if (invitation.data.recipient.trim().toLowerCase() !== actor.email && !grant.data)
    return denied();
  if (invitation.data.revoked_at || Date.parse(invitation.data.expires_at) <= now)
    return denied('La invitación al expediente venció o fue revocada.', 410);
  if (Date.parse(invitation.data.not_before) > now)
    return denied('El envío del expediente todavía está programado.', 409);
  if (secret.length < 32) throw new Error('Invitation secret unavailable');
  const token = decryptInvitationSecret(invitation.data.token_ciphertext, secret);
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Invalid stored invitation');
  // Existing entry flow still enforces the access code, QR and identity verification.
  return `/expediente/${token}`;
}
