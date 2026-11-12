import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { isDefinitivelyInvalidAuthToken } from '@/lib/supabase/auth-verification';
import { emitObservedEvent } from '@/lib/observability/events';

// Check if user has TOTP enabled — used by login flow
export async function POST(req: NextRequest) {
  try {
    const startedAt = performance.now();
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authorization.slice(7).trim();
    const deadline = AbortSignal.timeout(13_000);
    const auth = createAnonClient(undefined, deadline);
    const { data, error } = await auth.auth.getClaims(token);
    const claims = data?.claims;
    if (error || !claims) {
      const invalid = isDefinitivelyInvalidAuthToken(error);
      const status = invalid ? 401 : 503;
      emitObservedEvent({
        service: 'auth',
        outcome: invalid ? 'invalid' : 'unavailable',
        route: '/api/auth/totp/check',
        status,
        code: error?.code || error?.name,
      });
      return NextResponse.json(
        {
          error: invalid ? 'Token inválido o expirado' : 'Verificación temporalmente no disponible',
        },
        { status, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    if (
      claims.role !== 'authenticated' ||
      claims.is_anonymous === true ||
      typeof claims.sub !== 'string'
    ) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const service = createServiceClient(deadline);
    const authDuration = performance.now() - startedAt;
    const requirementsStartedAt = performance.now();
    const { data: rawRequirements, error: requirementsError } = await service.rpc(
      'get_login_security_requirements',
      { p_user_id: claims.sub }
    );
    if (requirementsError || !rawRequirements || typeof rawRequirements !== 'object') {
      emitObservedEvent({
        service: 'session_policy',
        outcome: 'unavailable',
        route: '/api/auth/totp/check',
        status: 503,
        code: requirementsError?.code,
      });
      return NextResponse.json(
        { error: 'No se pudieron verificar los requisitos de seguridad' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const requirements = rawRequirements as Record<string, unknown>;
    const requirementsDuration = performance.now() - requirementsStartedAt;

    return NextResponse.json(
      {
        totpEnabled: requirements.totp_enabled === true,
        platformStaff: requirements.platform_staff === true,
        platformSuperAdmin: requirements.platform_super_admin === true,
        passkeyRequired: requirements.passkey_required === true,
        passkeyEnrolled: requirements.passkey_enrolled === true,
        enrollmentRequired: requirements.enrollment_required === true,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Server-Timing': `token;dur=${authDuration.toFixed(1)}, requirements;dur=${requirementsDuration.toFixed(1)}`,
        },
      }
    );
  } catch (error) {
    emitObservedEvent({
      service: 'session_policy',
      outcome: 'unavailable',
      route: '/api/auth/totp/check',
      status: 503,
      code: error instanceof Error ? error.name : null,
    });
    return NextResponse.json(
      { error: 'No se pudieron verificar los requisitos de seguridad' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
