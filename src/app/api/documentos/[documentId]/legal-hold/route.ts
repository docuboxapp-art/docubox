import { NextRequest, NextResponse } from 'next/server';
import { createNotificationsForUsersServer } from '@/lib/notificationsInApp.server';
import {
  activateLegalHold,
  listLegalHolds,
  parseLegalHoldInput,
  releaseLegalHold,
  updateLegalHold,
} from '@/lib/documents/legal-hold';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

function documentAudience(document: Record<string, unknown>, actorId: string) {
  const participants = Array.isArray(document.participantes) ? document.participantes : [];
  return [
    ...new Set(
      [
        document.owner_id,
        ...participants.map((participant: Record<string, unknown>) => participant.user_id),
      ].filter((id): id is string => typeof id === 'string' && id !== actorId)
    ),
  ];
}

function notify(
  document: Record<string, unknown>,
  actorId: string,
  eventType: 'document.legal_hold.applied' | 'document.legal_hold.released',
  title: string
) {
  const recipients = documentAudience(document, actorId);
  if (!recipients.length) return;
  void createNotificationsForUsersServer(recipients, {
    type: eventType === 'document.legal_hold.applied' ? 'alert' : 'document',
    eventType,
    title,
    description: `Se actualizó la conservación legal de "${String(document.nombre || 'Sin nombre')}".`,
    workspaceId: typeof document.workspace_id === 'string' ? document.workspace_id : null,
    actorUserId: actorId,
    entityType: 'document',
    entityId: String(document.id),
    actionUrl: `/visor-documento/${String(document.id)}?tab=legal-hold`,
    actionLabel: 'Ver Legal Hold',
    metadata: { documentoId: document.id },
    deduplicationKey: `${eventType}:${String(document.id)}:${Date.now()}`,
  }).catch((error) => console.error('[legal-hold] Notification failed', error));
}

function apiError(error: unknown, fallback: string) {
  const access = documentAccessResponse(error);
  if (access.status !== 500) {
    return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
  }
  const message = error instanceof Error ? error.message : '';
  const conflict = message.includes('DESTRUCTION_STARTED') || message.includes('PURGING');
  console.error('[legal-hold]', { code: message || fallback });
  return NextResponse.json(
    {
      error: conflict ? 'La destrucción del documento ya inició.' : fallback,
      code: conflict ? 'DOCUMENT_DESTRUCTION_STARTED' : 'LEGAL_HOLD_OPERATION_FAILED',
    },
    { status: conflict ? 409 : 500, headers: privateHeaders }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const access = await requireDocumentAccess(request, documentId);
    const holds = await listLegalHolds(access.service, documentId);
    const canManage = access.role === 'OWNER' || access.role === 'WORKSPACE_ADMIN';
    const actorIds = [
      ...new Set(
        holds
          .flatMap((hold) => [hold.activated_by, hold.released_by])
          .filter((id): id is string => Boolean(id))
      ),
    ];
    const profiles = actorIds.length
      ? await access.service.from('user_profiles').select('id,full_name,email').in('id', actorIds)
      : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const profileById = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
    const activity = await access.service
      .from('document_lifecycle_audit_events')
      .select('id,action,actor_id,actor_email,reason,metadata,created_at')
      .eq('document_id', documentId)
      .in('action', ['LEGAL_HOLD_ACTIVATED', 'LEGAL_HOLD_UPDATED', 'LEGAL_HOLD_RELEASED'])
      .order('created_at', { ascending: false });
    if (activity.error) throw activity.error;
    return NextResponse.json(
      {
        hasHistory: holds.length > 0,
        activeCount: holds.filter((hold) => hold.status === 'ACTIVE').length,
        canViewDetails: canManage,
        canCreate: canManage,
        canUpdate: canManage,
        canRelease: canManage,
        holds: canManage
          ? holds.map((hold) => ({
              ...hold,
              activated_by_name:
                profileById.get(hold.activated_by)?.full_name ||
                profileById.get(hold.activated_by)?.email ||
                'Usuario autorizado',
              released_by_name: hold.released_by
                ? profileById.get(hold.released_by)?.full_name ||
                  profileById.get(hold.released_by)?.email ||
                  'Usuario autorizado'
                : null,
            }))
          : holds.map((hold) => ({
              id: hold.id,
              status: hold.status,
              activated_at: hold.activated_at,
              released_at: hold.released_at,
            })),
        events: (activity.data || []).map((event) =>
          canManage
            ? event
            : {
                id: event.id,
                action: event.action,
                created_at: event.created_at,
              }
        ),
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    return apiError(error, 'No fue posible consultar Legal Hold.');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const body = await request.json().catch(() => null);
    const holdInput = parseLegalHoldInput(body);
    if (!holdInput) {
      return NextResponse.json(
        { error: 'Completa un motivo válido y revisa las fechas.', code: 'LEGAL_HOLD_INVALID' },
        { status: 400, headers: privateHeaders }
      );
    }
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const hold = await activateLegalHold({
      service: access.service,
      documentId,
      actor: access.user,
      hold: holdInput,
      request,
    });
    notify(
      access.document as Record<string, unknown>,
      access.user.id,
      'document.legal_hold.applied',
      'Legal Hold activado'
    );
    return NextResponse.json({ ok: true, hold }, { status: 201, headers: privateHeaders });
  } catch (error) {
    return apiError(error, 'No fue posible activar Legal Hold.');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const body = await request.json().catch(() => null);
    const holdInput = parseLegalHoldInput(body);
    if (!holdInput || typeof body?.holdId !== 'string') {
      return NextResponse.json(
        { error: 'La información de Legal Hold no es válida.', code: 'LEGAL_HOLD_INVALID' },
        { status: 400, headers: privateHeaders }
      );
    }
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const existing = (await listLegalHolds(access.service, documentId)).find(
      (hold) => hold.id === body.holdId
    );
    if (!existing) {
      return NextResponse.json(
        { error: 'Legal Hold no encontrado.', code: 'LEGAL_HOLD_NOT_FOUND' },
        { status: 404, headers: privateHeaders }
      );
    }
    const hold = await updateLegalHold({
      service: access.service,
      holdId: body.holdId,
      actor: access.user,
      hold: holdInput,
      request,
    });
    return NextResponse.json({ ok: true, hold }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error, 'No fue posible actualizar Legal Hold.');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const body = await request.json().catch(() => null);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (typeof body?.holdId !== 'string' || !reason || body?.confirmation !== 'LIBERAR') {
      return NextResponse.json(
        {
          error: 'Confirma la liberación e indica el motivo.',
          code: 'LEGAL_HOLD_RELEASE_CONFIRMATION_REQUIRED',
        },
        { status: 400, headers: privateHeaders }
      );
    }
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const existing = (await listLegalHolds(access.service, documentId)).find(
      (hold) => hold.id === body.holdId
    );
    if (!existing) {
      return NextResponse.json(
        { error: 'Legal Hold no encontrado.', code: 'LEGAL_HOLD_NOT_FOUND' },
        { status: 404, headers: privateHeaders }
      );
    }
    const hold = await releaseLegalHold({
      service: access.service,
      holdId: body.holdId,
      actor: access.user,
      reason,
      notes: typeof body.notes === 'string' ? body.notes : null,
      request,
    });
    notify(
      access.document as Record<string, unknown>,
      access.user.id,
      'document.legal_hold.released',
      'Legal Hold liberado'
    );
    return NextResponse.json({ ok: true, hold }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error, 'No fue posible liberar Legal Hold.');
  }
}
