import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  normalizeSmsPhone,
  sendSignatureRequestSms,
  SmsConfigurationError,
} from '@/lib/smsNotifications';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import { getParticipantPortalUrl } from '@/lib/publicAppUrl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({
    action: z.enum(['send_single', 'send_to_participants']),
    documentId: z.string().uuid().optional(),
    documentoId: z.string().uuid().optional(),
    participantId: z.string().min(1).max(160).optional(),
    phone: z.string().min(8).max(32).optional(),
  })
  .passthrough();

function participantPhone(participant: Record<string, unknown>) {
  const value = participant.phone || participant.telefono;
  return typeof value === 'string' ? normalizeSmsPhone(value) : null;
}

function participantKey(participant: Record<string, unknown>) {
  return String(participant.participant_ref_id || participant.id || participant.user_id || '');
}

function smsEnabled(participant: Record<string, unknown>) {
  const method = String(
    participant.notificationMethod ||
      participant.notification_method ||
      participant.tipoNotificacion ||
      ''
  ).toLowerCase();
  return method === 'sms' || method.includes('mensaje de texto');
}

export async function POST(req: NextRequest) {
  try {
    const body = requestSchema.parse(await req.json());
    const documentId = body.documentId || body.documentoId;
    if (!documentId) {
      return NextResponse.json(
        { error: true, mensaje_error: 'documentId es requerido.' },
        { status: 400 }
      );
    }
    const access = await requireDocumentAccess(req, documentId, { requireEdit: true });
    const workspaceId = String(access.document.workspace_id || 'personal');
    const ip =
      req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const allowed = await consumeServerRateLimit({
      scope: 'notifications.sms',
      identifiers: [workspaceId, access.user.id, ip],
      limit: 10,
      windowSeconds: 60,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: true, mensaje_error: 'Demasiados envíos. Intenta nuevamente más tarde.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const canonicalParticipants = Array.isArray(access.document.participantes)
      ? (access.document.participantes as Record<string, unknown>[])
      : [];
    let selected: Record<string, unknown>[] = [];

    if (body.action === 'send_single') {
      const requestedPhone = body.phone ? normalizeSmsPhone(body.phone) : null;
      selected = canonicalParticipants.filter((participant) => {
        if (body.participantId && participantKey(participant) === body.participantId) return true;
        return Boolean(requestedPhone && participantPhone(participant) === requestedPhone);
      });
      if (selected.length !== 1) {
        return NextResponse.json(
          { error: true, mensaje_error: 'El destinatario no pertenece al documento.' },
          { status: 403 }
        );
      }
    } else {
      selected = canonicalParticipants.filter(
        (participant) => smsEnabled(participant) && Boolean(participantPhone(participant))
      );
    }

    if (!selected.length) {
      return NextResponse.json(
        { error: true, mensaje_error: 'No hay destinatarios SMS válidos en el documento.' },
        { status: 400 }
      );
    }

    const correlationId = randomUUID();
    const results = await Promise.all(
      selected.map(async (participant) => {
        const phone = participantPhone(participant)!;
        const portalToken = String(participant.portal_token || documentId);
        const result = await sendSignatureRequestSms({
          phone,
          recipientName: String(participant.name || participant.nombre || ''),
          documentName: String(access.document.nombre || 'Documento'),
          documentUrl: getParticipantPortalUrl(portalToken),
        });
        const phoneHash = createHash('sha256').update(phone).digest('hex');
        const outcome = result.error ? 'failed' : 'sent';
        await access.service.from('document_activity_log').insert({
          documento_id: documentId,
          actor_id: access.user.id,
          actor_nombre: access.user.user_metadata?.full_name || null,
          actor_email: access.user.email || null,
          action: result.error ? 'sms_envio_fallido' : 'sms_enviado',
          category: 'notificacion',
          details: {
            channel: 'sms',
            participant_reference_id: participantKey(participant) || null,
            recipient_sha256: phoneHash,
            provider: 'envia-sms',
            provider_code: result.codigo_error || null,
            correlation_id: correlationId,
          },
        });
        await appendDocumentOperationalEvent(access.service, {
          documentId,
          workspaceId: access.document.workspace_id || null,
          participantReferenceId: String(participant.participant_ref_id || '') || null,
          actorUserId: access.user.id,
          eventType: result.error ? 'notification.sms_failed' : 'notification.sms_sent',
          eventKey: `sms:${correlationId}:${phoneHash}`,
          correlationId,
          payload: { channel: 'sms', outcome },
        });
        return outcome;
      })
    );

    const sent = results.filter((result) => result === 'sent').length;
    return NextResponse.json({ success: sent > 0, sent, failed: results.length - sent });
  } catch (cause: unknown) {
    if (cause instanceof z.ZodError) {
      return NextResponse.json(
        { error: true, mensaje_error: 'Solicitud SMS inválida.' },
        { status: 400 }
      );
    }
    if (cause instanceof SmsConfigurationError) {
      return NextResponse.json(
        { error: true, mensaje_error: 'El servicio SMS no está configurado.' },
        { status: 503 }
      );
    }
    if (cause instanceof ServerRateLimitUnavailableError) {
      return NextResponse.json(
        { error: true, mensaje_error: 'El control de envíos no está disponible.' },
        { status: 503 }
      );
    }
    const accessFailure = documentAccessResponse(cause);
    if (accessFailure.status !== 500) {
      return NextResponse.json(
        { error: true, mensaje_error: accessFailure.body.error },
        { status: accessFailure.status }
      );
    }
    console.error('[SMS API] Delivery failed', {
      name: cause instanceof Error ? cause.name : 'unknown',
    });
    return NextResponse.json(
      { error: true, mensaje_error: 'No fue posible enviar el SMS.' },
      { status: 500 }
    );
  }
}
