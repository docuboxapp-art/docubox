import 'server-only';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDocumentIdentity, DocumentAccessError } from '@/lib/security/document-access';
import { decryptInvitationSecret } from '@/lib/case-files/invitations';
import { caseInvitationBlock } from './case-access.server';
import { formTokenAction } from './form-access.server';
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
      .select(
        'id,template_id,recipient_email,recipient_user_id,token,expires_at,used_at,access_mode,liveness_verified_at'
      )
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
    const [response, schedules, form] = await Promise.all([
      db
        .from('form_responses')
        .select('id,status,submitted_at,document_id')
        .eq('token_id', id)
        .order('submitted_at', { ascending: false, nullsFirst: false })
        .order('id')
        .limit(1)
        .maybeSingle(),
      db.from('form_send_schedules').select('status').eq('token_id', id),
      db
        .from('form_templates')
        .select('status,requires_signature')
        .eq('id', invitation.data.template_id)
        .maybeSingle(),
    ]);
    if (response.error) throw response.error;
    if (schedules.error) throw schedules.error;
    if (schedules.data?.some((row) => row.status !== 'sent'))
      return denied('El envío todavía no está disponible.', 409);
    if (form.error) throw form.error;
    if (!form.data)
      return denied('El formulario no está disponible en este momento.', 409);

    const action = formTokenAction(actor, invitation.data, form.data, response.data ?? undefined, now);
    if (action.kind === 'disabled') return denied(action.disabledReason, action.status);
    if (action.kind === 'document') return action.documentUrl;
    if (!/^[a-f0-9]{64}$/i.test(invitation.data.token))
      return denied('El enlace del formulario no está disponible.', 409);
    return `/form/${invitation.data.token}`;
  }
  const invitation = await db
    .from('case_participant_invitations')
    .select(
      'id,case_file_id,workspace_id,participant_id,recipient,token_ciphertext,revoked_at,expires_at,not_before'
    )
    .eq('id', id)
    .maybeSingle();
  if (invitation.error) throw invitation.error;
  const link = invitation.data;
  if (!link || link.recipient.trim().toLowerCase() !== actor.email) return denied();
  const [caseFile, participant] = await Promise.all([
    db.from('case_files').select('id,workspace_id,status').eq('id', link.case_file_id).maybeSingle(),
    db
      .from('case_file_participants')
      .select('id,case_file_id,workspace_id,user_id,status')
      .eq('id', link.participant_id)
      .maybeSingle(),
  ]);
  if (caseFile.error) throw caseFile.error;
  if (participant.error) throw participant.error;
  const block = caseInvitationBlock(
    link,
    actor,
    caseFile.data ?? undefined,
    participant.data ?? undefined,
    now
  );
  if (block) return denied(block.reason, block.httpStatus);
  if (secret.length < 32) throw new Error('Invitation secret unavailable');
  const token = decryptInvitationSecret(link.token_ciphertext, secret);
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Invalid stored invitation');
  // Existing entry flow still enforces the access code, QR and identity verification.
  return `/expediente/${token}`;
}
