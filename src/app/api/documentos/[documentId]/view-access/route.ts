import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { canAccessParticipantDocument } from '@/lib/documents/participant-visibility';
import {
  getDocumentViewProtection,
  requestFingerprint,
  viewAccessTenantId,
} from '@/lib/security/document-view-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function validCode(value: unknown) {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 128 &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const protection = await getDocumentViewProtection(access.service, access.document);
    const audit = await access.service
      .from('document_lifecycle_audit_events')
      .select('id,action,result,reason,actor_id,actor_email,created_at')
      .eq('document_id', access.document.id)
      .like('action', 'VIEW_ACCESS_%')
      .order('created_at', { ascending: false })
      .limit(100);
    if (audit.error) throw audit.error;

    const protectedParticipants = new Set<string>();
    for (const participant of Array.isArray(access.document.participantes)
      ? access.document.participantes
      : []) {
      if (!participant || typeof participant !== 'object') continue;
      const record = participant as Record<string, unknown>;
      if (!canAccessParticipantDocument(record)) continue;
      const participantId = String(record.user_id || record.id || '').trim();
      const participantEmail = String(record.email || '')
        .trim()
        .toLowerCase();
      if (participantId === access.document.owner_id) continue;
      if (participantEmail || participantId)
        protectedParticipants.add(participantEmail || participantId);
    }

    const events = audit.data || [];
    const configuredEvent = events.find(
      (event) =>
        event.action === 'VIEW_ACCESS_PROTECTION_ENABLED' ||
        event.action === 'VIEW_ACCESS_PROTECTION_REENABLED'
    );
    return noStore({
      enabled: protection.enabled,
      canManage: true,
      configuredAt: protection.configuredAt,
      updatedAt: protection.updatedAt,
      configuredBy: configuredEvent?.actor_email || null,
      protectedParticipantCount: protection.enabled ? protectedParticipants.size : 0,
      events,
    });
  } catch (error) {
    const response = documentAccessResponse(error);
    return noStore(response.body, response.status);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const body = await request.json().catch(() => null);
    if (!validCode(body?.code) || body.code !== body?.confirmation) {
      return noStore(
        {
          error: 'El código debe tener entre 8 y 128 caracteres y coincidir.',
          code: 'ACCESS_CODE_INVALID',
        },
        400
      );
    }
    const fp = requestFingerprint(request);
    const result = await access.service.rpc('configure_document_view_access', {
      p_document_id: access.document.id,
      p_tenant_id: viewAccessTenantId(access.document),
      p_document_owner_id: access.document.owner_id,
      p_actor_id: access.user.id,
      p_actor_email: access.user.email || null,
      p_code: body.code,
      p_request_id: fp.requestId,
      p_ip_address: fp.ip === 'unknown' ? null : fp.ip,
      p_user_agent: fp.userAgent,
    });
    if (result.error) throw result.error;
    return noStore({ success: true, enabled: true });
  } catch (error) {
    const response = documentAccessResponse(error);
    return noStore(response.body, response.status);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentAccess(request, documentId, { ownerOrAdminOnly: true });
    const fp = requestFingerprint(request);
    const result = await access.service.rpc('disable_document_view_access', {
      p_document_id: access.document.id,
      p_tenant_id: viewAccessTenantId(access.document),
      p_actor_id: access.user.id,
      p_actor_email: access.user.email || null,
      p_request_id: fp.requestId,
      p_ip_address: fp.ip === 'unknown' ? null : fp.ip,
      p_user_agent: fp.userAgent,
    });
    if (result.error) throw result.error;
    return noStore({ success: true, enabled: false });
  } catch (error) {
    const response = documentAccessResponse(error);
    return noStore(response.body, response.status);
  }
}
