import { NextRequest, NextResponse } from 'next/server';
import { createNotificationsForUsersServer } from '@/lib/notificationsInApp.server';
import { DOCUMENT_PRIORITIES, normalizeDocumentPriority } from '@/lib/documents/priority';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

function isPriority(value: unknown): value is (typeof DOCUMENT_PRIORITIES)[number] {
  return typeof value === 'string' && DOCUMENT_PRIORITIES.includes(value as never);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const body = await request.json().catch(() => null);
    if (!isPriority(body?.priority)) {
      return NextResponse.json(
        { error: 'La prioridad no es válida.', code: 'DOCUMENT_PRIORITY_INVALID' },
        { status: 400, headers: privateHeaders }
      );
    }

    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const document = access.document as Record<string, unknown>;
    const previousPriority = normalizeDocumentPriority(
      document.priority,
      document.es_urgente === true
    );
    const nextPriority = body.priority;
    if (previousPriority === nextPriority) {
      return NextResponse.json({ ok: true, priority: nextPriority }, { headers: privateHeaders });
    }

    const { error } = await access.service
      .from('documentos')
      .update({ priority: nextPriority, es_urgente: nextPriority === 'urgent' })
      .eq('id', documentId);
    if (error) throw error;

    const requestId = request.headers.get('x-request-id') || null;
    const now = new Date().toISOString();
    const audit = await access.service.from('document_lifecycle_audit_events').insert({
      workspace_id: document.workspace_id || null,
      document_id: documentId,
      actor_id: access.user.id,
      actor_email: access.user.email || null,
      action: 'DOCUMENT_PRIORITY_CHANGED',
      previous_state: { priority: previousPriority },
      new_state: { priority: nextPriority },
      reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null,
      result: 'success',
      request_id: requestId,
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: request.headers.get('user-agent') || null,
    });
    if (audit.error) throw audit.error;

    await access.service.from('document_activity_log').insert({
      documento_id: documentId,
      actor_id: access.user.id,
      actor_nombre: access.user.user_metadata?.full_name || null,
      actor_email: access.user.email || null,
      action: 'DOCUMENT_PRIORITY_CHANGED',
      category: 'documento',
      details: { previous_priority: previousPriority, priority: nextPriority, changed_at: now },
    });

    if (nextPriority === 'urgent') {
      const participants = Array.isArray(document.participantes) ? document.participantes : [];
      const recipients = [
        ...new Set(
          participants
            .filter((participant: Record<string, unknown>) => participant.visible !== false)
            .map((participant: Record<string, unknown>) => participant.user_id)
            .filter(
              (userId): userId is string => typeof userId === 'string' && userId !== access.user.id
            )
        ),
      ];
      if (recipients.length) {
        await createNotificationsForUsersServer(recipients, {
          type: 'document',
          eventType: 'document.priority.changed',
          category: 'DOCUMENT',
          severity: 'warning',
          title: 'Documento urgente: se requiere tu participación',
          description: `El documento "${String(document.nombre || 'Sin nombre')}" fue marcado como urgente.`,
          workspaceId: typeof document.workspace_id === 'string' ? document.workspace_id : null,
          actorUserId: access.user.id,
          entityType: 'document',
          entityId: documentId,
          actionUrl: `/visor-documento/${documentId}`,
          actionLabel: 'Ver documento',
          metadata: {
            documentoId: documentId,
            priority: 'urgent',
            expiresAt: document.fecha_vencimiento || null,
          },
          deduplicationKey: `document.priority.urgent:${documentId}:${now}`,
        });
      }
    }

    return NextResponse.json({ ok: true, priority: nextPriority }, { headers: privateHeaders });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    }
    console.error('[document-priority] Update failed', {
      code: error instanceof Error ? error.message : 'DOCUMENT_PRIORITY_UPDATE_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible actualizar la prioridad.', code: 'DOCUMENT_PRIORITY_UPDATE_FAILED' },
      { status: 500, headers: privateHeaders }
    );
  }
}
