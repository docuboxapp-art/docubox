import { NextRequest, NextResponse } from 'next/server';
import { createNotificationsForUsersServer } from '@/lib/notificationsInApp.server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
const LEGAL_HOLD_REASONS = new Set([
  'litigio',
  'requerimiento_autoridad',
  'auditoria_investigacion',
  'prevencion_eliminacion',
  'otro',
]);

function validReason(value: unknown) {
  return typeof value === 'string' && LEGAL_HOLD_REASONS.has(value);
}

function documentAudience(document: Record<string, unknown>, actorId: string) {
  const participants = Array.isArray(document.participantes) ? document.participantes : [];
  return [
    ...new Set(
      [
        document.owner_id,
        ...participants.map((participant: Record<string, unknown>) => participant.user_id),
      ].filter((userId): userId is string => typeof userId === 'string' && userId !== actorId)
    ),
  ];
}

function notifyAudience(
  document: Record<string, unknown>,
  actorId: string,
  eventType: 'document.legal_hold.applied' | 'document.legal_hold.released',
  title: string,
  description: string,
  reason: string
) {
  const recipients = documentAudience(document, actorId);
  if (!recipients.length) return;
  void createNotificationsForUsersServer(recipients, {
    type: eventType === 'document.legal_hold.applied' ? 'alert' : 'document',
    eventType,
    title,
    description,
    workspaceId: typeof document.workspace_id === 'string' ? document.workspace_id : null,
    actorUserId: actorId,
    entityType: 'document',
    entityId: typeof document.id === 'string' ? document.id : null,
    actionUrl: `/visor-documento/${String(document.id)}`,
    actionLabel: 'Ver documento',
    metadata: { documentoId: document.id, reason },
    deduplicationKey: `${eventType}:${String(document.id)}:${new Date().toISOString()}`,
  }).catch((error) => {
    console.error('[legal-hold] Notification could not be created', {
      documentId: document.id,
      code: error instanceof Error ? error.message : 'NOTIFICATION_FAILED',
    });
  });
}

async function audit(
  service: Awaited<ReturnType<typeof requireDocumentAccess>>['service'],
  request: NextRequest,
  document: Record<string, unknown>,
  actor: { id: string; email?: string | null },
  action: string,
  reason: string
) {
  const { error } = await service.from('document_lifecycle_audit_events').insert({
    workspace_id: document.workspace_id || null,
    document_id: document.id,
    actor_id: actor.id,
    actor_email: actor.email || null,
    action,
    previous_state: {
      legal_hold: Boolean(document.legal_hold),
      legal_hold_status: document.legal_hold_status || 'NONE',
    },
    new_state: { legal_hold: action === 'LEGAL_HOLD_ACTIVATED', reason },
    reason,
    result: 'success',
    request_id: request.headers.get('x-request-id') || null,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
  });
  if (error) throw error;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const body = await request.json().catch(() => null);
    if (!validReason(body?.reason)) {
      return NextResponse.json(
        {
          error: 'Selecciona un motivo válido para Legal Hold.',
          code: 'LEGAL_HOLD_REASON_REQUIRED',
        },
        { status: 400, headers: privateHeaders }
      );
    }
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const document = access.document as Record<string, unknown>;
    if (document.legal_hold === true || document.legal_hold_status === 'ACTIVE') {
      return NextResponse.json({ ok: true, status: 'ACTIVE' }, { headers: privateHeaders });
    }
    const now = new Date().toISOString();
    const { error } = await access.service
      .from('documentos')
      .update({
        legal_hold: true,
        legal_hold_status: 'ACTIVE',
        legal_hold_reason: body.reason,
        legal_hold_created_at: now,
        legal_hold_created_by: access.user.id,
        legal_hold_released_at: null,
        legal_hold_released_by: null,
        legal_hold_release_reason: null,
      })
      .eq('id', documentId);
    if (error) throw error;
    await audit(
      access.service,
      request,
      document,
      access.user,
      'LEGAL_HOLD_ACTIVATED',
      body.reason
    );
    notifyAudience(
      document,
      access.user.id,
      'document.legal_hold.applied',
      'Legal Hold activado',
      `El documento "${String(document.nombre || 'Sin nombre')}" quedó protegido contra eliminación.`,
      body.reason
    );
    return NextResponse.json({ ok: true, status: 'ACTIVE' }, { headers: privateHeaders });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    }
    console.error('[legal-hold] Activation failed', {
      code: error instanceof Error ? error.message : 'LEGAL_HOLD_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible activar Legal Hold.', code: 'LEGAL_HOLD_ACTIVATION_FAILED' },
      { status: 500, headers: privateHeaders }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const body = await request.json().catch(() => null);
    if (!validReason(body?.reason) || body?.confirmation !== 'LIBERAR') {
      return NextResponse.json(
        {
          error: 'Confirma la liberación y selecciona un motivo válido.',
          code: 'LEGAL_HOLD_RELEASE_CONFIRMATION_REQUIRED',
        },
        { status: 400, headers: privateHeaders }
      );
    }
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const document = access.document as Record<string, unknown>;
    if (document.legal_hold !== true && document.legal_hold_status !== 'ACTIVE') {
      return NextResponse.json({ ok: true, status: 'NONE' }, { headers: privateHeaders });
    }
    const now = new Date().toISOString();
    const { error } = await access.service
      .from('documentos')
      .update({
        legal_hold: false,
        legal_hold_status: 'RELEASED',
        legal_hold_released_at: now,
        legal_hold_released_by: access.user.id,
        legal_hold_release_reason: body.reason,
      })
      .eq('id', documentId);
    if (error) throw error;
    await audit(access.service, request, document, access.user, 'LEGAL_HOLD_RELEASED', body.reason);
    notifyAudience(
      document,
      access.user.id,
      'document.legal_hold.released',
      'Legal Hold liberado',
      `La protección Legal Hold del documento "${String(document.nombre || 'Sin nombre')}" fue liberada.`,
      body.reason
    );
    return NextResponse.json({ ok: true, status: 'RELEASED' }, { headers: privateHeaders });
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status, headers: privateHeaders });
    }
    console.error('[legal-hold] Release failed', {
      code: error instanceof Error ? error.message : 'LEGAL_HOLD_RELEASE_FAILED',
    });
    return NextResponse.json(
      { error: 'No fue posible liberar Legal Hold.', code: 'LEGAL_HOLD_RELEASE_FAILED' },
      { status: 500, headers: privateHeaders }
    );
  }
}
