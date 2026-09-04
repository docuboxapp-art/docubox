import { createHash, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPlatformAccess } from '@/lib/platform-admin/access';
import { authorizePlatformAction } from '@/lib/platform-admin/authorization';
import { createServiceClient } from '@/lib/supabase/server';
import { PLATFORM_MFA_COOKIE, verifyPlatformMfaProof } from '@/lib/security/platform-mfa-proof';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = {
  'kms.rotate': { permission: 'kms.rotate', resourceType: 'kms-key' },
  'role.manage': { permission: 'role.manage', resourceType: 'platform-role' },
  'billing.refund': { permission: 'billing.refund', resourceType: 'billing-transaction' },
  'support.content.read': {
    permission: 'support.access.request',
    resourceType: 'support-access',
  },
} as const;

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
    const fetchSite = request.headers.get('sec-fetch-site');
    return !fetchSite || fetchSite === 'same-origin';
  } catch {
    return false;
  }
}

function clientIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  );
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: 'Solicitud no autorizada.', code: 'ADMIN_CSRF_DENIED', correlationId },
      { status: 403 }
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 8192) {
    return NextResponse.json(
      { error: 'Solicitud demasiado grande.', code: 'ADMIN_REQUEST_TOO_LARGE', correlationId },
      { status: 413 }
    );
  }

  const { user, access } = await getCurrentPlatformAccess();
  if (!user || !access) {
    return NextResponse.json(
      { error: 'No autorizado.', code: 'ADMIN_ACCESS_DENIED', correlationId },
      { status: 403 }
    );
  }

  const cookieStore = await cookies();
  const stepUpVerified = verifyPlatformMfaProof(cookieStore.get(PLATFORM_MFA_COOKIE)?.value, user, {
    requirePasskey: access.passkeyRequired,
  });
  if (!stepUpVerified) {
    return NextResponse.json(
      { error: 'Reautenticación requerida.', code: 'ADMIN_STEP_UP_REQUIRED', correlationId },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as null | {
    actionKey?: string;
    resourceId?: string;
    workspaceId?: string;
    reason?: string;
  };
  const action = body?.actionKey ? ACTIONS[body.actionKey as keyof typeof ACTIONS] : undefined;
  if (!action || !body?.resourceId || !body.reason || body.reason.trim().length < 20) {
    return NextResponse.json(
      { error: 'Datos incompletos.', code: 'ADMIN_APPROVAL_INPUT_INVALID', correlationId },
      { status: 400 }
    );
  }
  const decision = authorizePlatformAction(
    access,
    action.permission,
    {
      type: action.resourceType,
      id: body.resourceId,
      workspaceId: body.workspaceId,
      classification: 'internal',
    },
    { stepUpVerified: true, approvalRequest: true }
  );
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: 'Permiso insuficiente.',
        code: `ADMIN_${decision.reason}`,
        correlationId,
      },
      { status: 403 }
    );
  }

  const requestId =
    request.headers.get('x-idempotency-key') || request.headers.get('x-request-id') || randomUUID();
  if (requestId.length > 128) {
    return NextResponse.json(
      { error: 'Identificador inválido.', code: 'ADMIN_IDEMPOTENCY_KEY_INVALID', correlationId },
      { status: 400 }
    );
  }
  const payloadDigest = createHash('sha256')
    .update(
      JSON.stringify({
        actionKey: body.actionKey,
        resourceId: body.resourceId,
        workspaceId: body.workspaceId ?? null,
      })
    )
    .digest('hex');
  const service = createServiceClient();
  const result = await service.rpc('request_platform_admin_approval', {
    p_actor_user_id: user.id,
    p_actor_role: access.role,
    p_permission: action.permission,
    p_action_key: body.actionKey,
    p_resource_type: action.resourceType,
    p_resource_id: body.resourceId,
    p_workspace_id: body.workspaceId ?? null,
    p_reason: body.reason.trim(),
    p_payload_digest_sha256: payloadDigest,
    p_request_id: requestId,
    p_correlation_id: correlationId,
    p_ip_address: clientIp(request),
    p_user_agent: request.headers.get('user-agent'),
  });
  if (result.error || !result.data) {
    console.error('[admin/approvals] request failed', {
      code: result.error?.code,
      correlationId,
    });
    const rateLimited = result.error?.message?.includes('PLATFORM_APPROVAL_RATE_LIMITED');
    return NextResponse.json(
      {
        error: rateLimited
          ? 'Demasiadas solicitudes. Intenta más tarde.'
          : 'No fue posible crear la aprobación.',
        code: rateLimited ? 'ADMIN_RATE_LIMITED' : 'ADMIN_APPROVAL_FAILED',
        correlationId,
      },
      { status: rateLimited ? 429 : 500 }
    );
  }

  return NextResponse.json(
    { approvalId: result.data, status: 'REQUESTED', correlationId },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  );
}
