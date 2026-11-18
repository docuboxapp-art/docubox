import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { renderOrganizationCommunication } from '@/lib/organization/communications.server';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { collaborationTokenHash } from './external-request.server';

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  );
export async function sendCollaborationRoomInvitation(
  service: SupabaseClient,
  room: Record<string, unknown>,
  guest: { name: string; email: string },
  token: string
) {
  try {
    if (!process.env.RESEND_API_KEY) throw new Error('email_service_unavailable');
    const actionUrl = `${getPublicAppUrl().replace(/\/$/, '')}/sala/${encodeURIComponent(token)}`;
    const rendered = await renderOrganizationCommunication(service, {
      workspaceId: String(room.workspace_id),
      templateKey: 'collaboration.room.invitation',
      variables: {
        recipient_name: guest.name,
        organization_name: 'Tu organización',
        action_url: actionUrl,
        message: String(room.purpose || ''),
        expires_at: String(room.expires_at || ''),
      },
      fallbackSubject: `Invitación a Colabora: ${String(room.name).slice(0, 160)}`,
      fallbackContentHtml: `<h2>Sala de colaboración</h2><p>Hola ${escapeHtml(guest.name)},</p><p>Te invitaron a <strong>${escapeHtml(room.name)}</strong>.</p><p>${escapeHtml(room.purpose)}</p><p>Verifica tu correo con un código para consultar los documentos que te compartieron.</p><p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#1e6bff;color:white;padding:12px 20px;border-radius:7px;text-decoration:none;">Abrir sala</a></p>`,
      context: 'Docubox Colabora',
    });
    const sent = await new Resend(process.env.RESEND_API_KEY).emails.send(
      {
        from:
          rendered.from || process.env.RESEND_FROM_EMAIL || 'Docubox <notificaciones@docubox.mx>',
        to: guest.email,
        subject: rendered.subject,
        html: rendered.html,
        ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}),
      },
      {
        idempotencyKey: `colabora-room-${String(room.id)}-${collaborationTokenHash(token).slice(0, 20)}`,
      }
    );
    if (sent.error) throw new Error('email_delivery_failed');
    return { status: 'sent' as const };
  } catch {
    return { status: 'failed' as const };
  }
}
export async function sendCollaborationRequestInvitation(
  service: SupabaseClient,
  row: Record<string, unknown>,
  token: string
) {
  const workspaceId = String(row.workspace_id),
    id = String(row.id);
  let status: 'sent' | 'failed' = 'failed';
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('email_service_unavailable');
    const actionUrl = `${getPublicAppUrl().replace(/\/$/, '')}/solicitud/${encodeURIComponent(token)}`;
    const rendered = await renderOrganizationCommunication(service, {
      workspaceId,
      templateKey: 'collaboration.request.invitation',
      variables: {
        organization_name: 'Tu organización',
        recipient_name: String(row.recipient_name),
        message: String(row.description || ''),
        action_url: actionUrl,
        expires_at: String(row.access_expires_at || ''),
      },
      fallbackSubject: `Solicitud de Colabora: ${String(row.title).slice(0, 160)}`,
      fallbackContentHtml: `<h2 style="font-size:21px;">Solicitud documental de Colabora</h2><p>Hola ${escapeHtml(row.recipient_name)},</p><p>Te solicitaron completar <strong>${escapeHtml(row.title)}</strong>.</p><p>${escapeHtml(row.description)}</p><p>Podrás cargar documentos, responder los formularios vinculados y consultar los requisitos pendientes. Para acceder, enviaremos un código a este mismo correo.</p><p style="margin:24px 0;"><a href="${escapeHtml(actionUrl)}" style="background:#1e6bff;color:white;padding:12px 20px;border-radius:7px;text-decoration:none;">Abrir solicitud</a></p>`,
      context: 'Docubox Colabora',
    });
    const result = await new Resend(key).emails.send(
      {
        from:
          rendered.from || process.env.RESEND_FROM_EMAIL || 'Docubox <notificaciones@docubox.mx>',
        to: String(row.recipient_email),
        subject: rendered.subject,
        html: rendered.html,
        ...(rendered.replyTo ? { replyTo: rendered.replyTo } : {}),
      },
      { idempotencyKey: `colabora-request-${id}-${collaborationTokenHash(token).slice(0, 20)}` }
    );
    if (result.error) throw new Error('email_delivery_failed');
    status = 'sent';
  } catch {
    status = 'failed';
  }
  const saved = await service
    .from('collaboration_document_requests')
    .update({
      invitation_status: status,
      ...(status === 'sent' ? { invitation_sent_at: new Date().toISOString() } : {}),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .eq('access_token_hash', collaborationTokenHash(token));
  if (saved.error) console.error('[colabora] invitation_status_unavailable');
  return { status, statusRecorded: !saved.error };
}
