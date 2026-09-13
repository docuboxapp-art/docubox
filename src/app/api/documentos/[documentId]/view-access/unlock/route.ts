import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  createOpaqueDocumentViewToken,
  documentViewCookieName,
  DOCUMENT_VIEW_ACCESS_TTL_SECONDS,
  requestFingerprint,
  unlockExpiry,
  viewAccessTenantId,
} from '@/lib/security/document-view-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const access = await requireDocumentAccess(request, documentId);
    const body = await request.json().catch(() => null);
    const code = typeof body?.code === 'string' ? body.code : '';
    if (code.length < 8 || code.length > 128 || /[\u0000-\u001f\u007f]/.test(code)) {
      return NextResponse.json(
        { error: 'Ingresa un código de acceso válido.', code: 'ACCESS_CODE_INVALID' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const opaque = createOpaqueDocumentViewToken();
    const fp = requestFingerprint(request);
    const expiresAt = unlockExpiry(access.accessToken);
    const result = await access.service.rpc('unlock_document_view_access', {
      p_document_id: access.document.id,
      p_tenant_id: viewAccessTenantId(access.document),
      p_user_id: access.user.id,
      p_user_email: access.user.email || null,
      p_auth_session_id: access.authSessionId,
      p_ip_hash: fp.ipHash,
      p_user_agent_hash: fp.userAgentHash,
      p_code: code,
      p_token_hash: opaque.tokenHash,
      p_expires_at: expiresAt,
      p_request_id: fp.requestId,
      p_ip_address: fp.ip === 'unknown' ? null : fp.ip,
      p_user_agent: fp.userAgent,
    });
    if (result.error) throw result.error;
    const data = result.data as { ok?: boolean; code?: string; retry_after_seconds?: number } | null;
    if (!data?.ok) {
      const locked = data?.code === 'ACCESS_CODE_LOCKED';
      const forbidden = data?.code === 'ACCESS_FORBIDDEN';
      const disabled = data?.code === 'ACCESS_PROTECTION_DISABLED';
      return NextResponse.json(
        {
          error: forbidden
            ? 'No tienes acceso a este documento.'
            : locked
            ? 'Demasiados intentos. Espera antes de volver a intentarlo.'
            : disabled
              ? 'La protección ya no está activa.'
              : 'El código de acceso no es correcto.',
          code: data?.code || 'ACCESS_CODE_INVALID',
          retryAfterSeconds: data?.retry_after_seconds || 0,
        },
        { status: forbidden ? 403 : locked ? 429 : disabled ? 409 : 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(documentViewCookieName(access.document.id), opaque.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: DOCUMENT_VIEW_ACCESS_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
