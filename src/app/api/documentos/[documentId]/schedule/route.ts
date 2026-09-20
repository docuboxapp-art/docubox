import { NextRequest, NextResponse } from 'next/server';
import { isSupportedTimeZone, zonedDateTimeToUtcIso } from '@/lib/datetime';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';

async function enforceScheduleRateLimit(request: NextRequest, userId: string, documentId: string) {
  const ip =
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  return consumeServerRateLimit({
    scope: 'document.schedule.manage',
    identifiers: [documentId, userId, ip],
    limit: 20,
    windowSeconds: 60,
  });
}

function scheduleFailureResponse(cause: unknown) {
  if (cause instanceof ServerRateLimitUnavailableError) {
    return NextResponse.json(
      { error: 'La protección de solicitudes no está disponible temporalmente.' },
      { status: 503 }
    );
  }
  const failure = documentAccessResponse(cause);
  return NextResponse.json(failure.body, { status: failure.status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { service } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    const result = await service
      .from('document_send_schedules')
      .select(
        'id,document_id,scheduled_at,timezone,status,created_at,updated_at,cancelled_at,executed_at'
      )
      .eq('document_id', documentId)
      .maybeSingle();
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, schedule: result.data });
  } catch (cause) {
    const failure = documentAccessResponse(cause);
    return NextResponse.json(failure.body, { status: failure.status });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { service, user, document } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    if (!(await enforceScheduleRateLimit(request, user.id, documentId))) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes de programación. Intenta nuevamente más tarde.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
    const body = await request.json();
    const timezone = typeof body.timezone === 'string' ? body.timezone : '';
    const scheduledAt = zonedDateTimeToUtcIso(
      String(body.date || ''),
      String(body.time || ''),
      timezone
    );
    if (
      !isSupportedTimeZone(timezone) ||
      !scheduledAt ||
      new Date(scheduledAt).getTime() <= Date.now() + 60_000
    ) {
      return NextResponse.json({ error: 'La nueva programación no es válida.' }, { status: 400 });
    }
    const updated = await service
      .from('document_send_schedules')
      .update({
        scheduled_at: scheduledAt,
        timezone,
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('document_id', documentId)
      .eq('workspace_id', document.workspace_id)
      .eq('status', 'scheduled')
      .select('id,scheduled_at,timezone,status')
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data)
      return NextResponse.json(
        { error: 'El envío ya fue reclamado o ejecutado.' },
        { status: 409 }
      );
    await appendDocumentOperationalEvent(service, {
      documentId,
      workspaceId: document.workspace_id,
      actorUserId: user.id,
      eventType: 'document.send_rescheduled',
      eventKey: `send-rescheduled:${updated.data.id}:${scheduledAt}`,
      payload: { schedule_id: updated.data.id, scheduled_at: scheduledAt, timezone },
    });
    await service.from('audit_trail').insert({
      documento_id: documentId,
      actor_id: user.id,
      action: 'envio_reprogramado',
      category: 'orquestacion',
      details: { schedule_id: updated.data.id, scheduled_at: scheduledAt, timezone },
    });
    return NextResponse.json({ success: true, schedule: updated.data });
  } catch (cause) {
    return scheduleFailureResponse(cause);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { service, user, document } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    if (!(await enforceScheduleRateLimit(request, user.id, documentId))) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes de programación. Intenta nuevamente más tarde.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
    const cancelled = await service
      .from('document_send_schedules')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('document_id', documentId)
      .eq('workspace_id', document.workspace_id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle();
    if (cancelled.error) throw cancelled.error;
    if (!cancelled.data)
      return NextResponse.json(
        { error: 'El envío ya fue reclamado o ejecutado.' },
        { status: 409 }
      );
    await service
      .from('documentos')
      .update({ estado: 'borrador' })
      .eq('id', documentId)
      .eq('workspace_id', document.workspace_id)
      .eq('estado', 'programado');
    await appendDocumentOperationalEvent(service, {
      documentId,
      workspaceId: document.workspace_id,
      actorUserId: user.id,
      eventType: 'document.send_cancelled',
      eventKey: `send-cancelled:${cancelled.data.id}`,
      payload: { schedule_id: cancelled.data.id },
    });
    await service.from('audit_trail').insert({
      documento_id: documentId,
      actor_id: user.id,
      action: 'envio_programado_cancelado',
      category: 'orquestacion',
      details: { schedule_id: cancelled.data.id },
    });
    return NextResponse.json({ success: true });
  } catch (cause) {
    return scheduleFailureResponse(cause);
  }
}
