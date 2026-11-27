import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { sendParticipationReminderEmail } from '@/lib/emailNotifications';
import { getParticipantPortalUrl } from '@/lib/publicAppUrl';
import {
  canRemindDocumentParticipant,
  reminderAction,
  reminderSentToday,
  type ReminderParticipant,
} from '@/lib/contacts/document-reminders';
import { normalizeContactEmail } from '@/lib/contacts/detail';

type Participant = ReminderParticipant & {
  nombre?: string;
  name?: string;
  portal_token?: string;
  tipoFirma?: string[];
};

const signatureLabels: Record<string, string> = {
  autografa: 'Firma autógrafa digital',
  efirma: 'e.firma SAT',
  biometria: 'Biometría',
  click: 'Click & Sign',
};

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const error = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll(values) {
            values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return error('Inicia sesión para enviar recordatorios.', 401);

    const body = await req.json().catch(() => null);
    const documentId = body?.documentId;
    const email = normalizeContactEmail(body?.participantEmail);
    if (typeof documentId !== 'string' || !uuid.test(documentId) || !email) {
      return error('Selecciona un documento y un participante válidos.', 400);
    }

    const service = createServiceClient();
    const { data: document, error: readError } = await service
      .from('documentos')
      .select(
        'id,nombre,owner_id,workspace_id,current_custodian_workspace_id,estado,participantes,fecha_vencimiento,tiene_vencimiento,deleted_at,updated_at'
      )
      .eq('id', documentId)
      .maybeSingle();
    if (readError) return error('No se pudo consultar el documento.', 503);
    if (!document) return error('Documento no encontrado.', 404);

    const now = Date.now();
    const workspaceId = document.current_custodian_workspace_id || document.workspace_id;
    if (document.owner_id !== user.id || workspaceId !== document.workspace_id) {
      if (!workspaceId) return error('Sin permisos para enviar recordatorios.', 403);
      const { data: membership, error: memberError } = await service
        .from('workspace_members')
        .select('access_expires_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .in('role', ['owner', 'admin'])
        .maybeSingle();
      if (memberError) return error('No se pudieron verificar los permisos.', 503);
      if (
        !membership ||
        (membership.access_expires_at && !(Date.parse(membership.access_expires_at) > now))
      ) {
        return error('Sin permisos para enviar recordatorios.', 403);
      }
    }

    const participants: Participant[] = Array.isArray(document.participantes)
      ? document.participantes
      : [];
    const sameRecipient = (participant: Participant | null) =>
      Boolean(participant && normalizeContactEmail(participant.email) === email);
    const participant = participants.find(
      (item) => sameRecipient(item) && canRemindDocumentParticipant(item, document, now)
    );
    if (!participant?.email)
      return error('Este contacto ya no tiene una acción pendiente disponible.', 409);
    if (
      participants.some(
        (item) => sameRecipient(item) && reminderSentToday(item.fecha_recordatorio, now)
      )
    ) {
      return error('Ya se envió un recordatorio a este contacto para este documento hoy.', 429);
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const senderName = profile?.full_name || user.email || 'Un usuario';
    const participantName = participant.nombre || participant.name;
    const action = reminderAction(participant);
    const methods = Array.isArray(participant.tipoFirma) ? participant.tipoFirma : [];
    const signatureMethod =
      action === 'Firma pendiente'
        ? methods.map((method) => signatureLabels[method] || method).join(', ') ||
          'Firma electrónica'
        : action || 'Participación';
    const sentAt = new Date(now).toISOString();
    const recipientHash = createHash('sha256').update(email).digest('hex');

    await sendParticipationReminderEmail({
      participantEmail: participant.email.trim(),
      participantName,
      documentName: document.nombre || 'Documento',
      senderName,
      documentUrl: getParticipantPortalUrl(participant.portal_token || documentId),
      participantRole: participant.acto || participant.role || participant.rol || 'Participante',
      signatureMethod,
      expiryDate:
        document.tiene_vencimiento !== false ? document.fecha_vencimiento || undefined : undefined,
      idempotencyKey: `participation-reminder/${documentId}/${recipientHash}/${sentAt.slice(0, 10)}`,
    });

    try {
      let snapshot = { participantes: participants, updated_at: document.updated_at };
      // Re-read on a concurrent change to preserve the other participants and their progress.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (
          snapshot.participantes.some(
            (item) => sameRecipient(item) && reminderSentToday(item.fecha_recordatorio, now)
          )
        )
          break;
        if (!snapshot.participantes.some(sameRecipient)) break;

        const update = service
          .from('documentos')
          .update({
            participantes: snapshot.participantes.map((item) =>
              sameRecipient(item) ? { ...item, fecha_recordatorio: sentAt } : item
            ),
          })
          .eq('id', documentId);
        const { data: saved, error: updateError } = await (
          snapshot.updated_at
            ? update.eq('updated_at', snapshot.updated_at)
            : update.is('updated_at', null)
        )
          .select('id')
          .maybeSingle();
        if (updateError) throw updateError;
        if (saved) {
          const details = {
            participant_email: participant.email,
            participant_name: participantName,
            channel: 'email',
          };
          const event = {
            documento_id: documentId,
            actor_id: user.id,
            action: 'recordatorio_enviado',
            category: 'notificacion',
            details,
          };
          await Promise.all([
            service.from('audit_trail').insert(event),
            service.from('document_activity_log').insert({
              ...event,
              actor_nombre: senderName,
              actor_email: user.email,
            }),
          ]);
          break;
        }

        const { data: latest, error: latestError } = await service
          .from('documentos')
          .select('participantes,updated_at')
          .eq('id', documentId)
          .maybeSingle();
        if (latestError) throw latestError;
        if (!latest || !Array.isArray(latest.participantes)) break;
        snapshot = latest;
      }
    } catch {
      console.error('[send-reminder] Unable to record the sent reminder.');
    }
    return NextResponse.json({ success: true, sentAt });
  } catch {
    return error('No se pudo enviar el recordatorio. Intenta de nuevo más tarde.', 502);
  }
}
