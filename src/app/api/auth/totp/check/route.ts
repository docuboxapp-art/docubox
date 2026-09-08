import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

// Check if user has TOTP enabled — used by login flow
export async function POST(req: NextRequest) {
  try {
    const startedAt = performance.now();
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authorization.slice(7).trim();
    const auth = createAnonClient();
    const { data, error } = await auth.auth.getUser(token);
    if (error || !data.user) {
      console.warn('[auth/totp/check] Token validation failed', {
        code: error?.code,
        message: error?.message,
      });
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const service = createServiceClient();
    const authDuration = performance.now() - startedAt;
    const requirementsStartedAt = performance.now();
    const { data: rawRequirements, error: requirementsError } = await service.rpc(
      'get_login_security_requirements',
      { p_user_id: data.user.id }
    );
    if (requirementsError || !rawRequirements || typeof rawRequirements !== 'object') {
      console.error('[auth/totp/check] Security requirements lookup failed', requirementsError);
      return NextResponse.json({ error: 'No se pudo validar el segundo factor' }, { status: 500 });
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
    console.error('[auth/totp/check] Security requirements check failed', error);
    return NextResponse.json({ error: 'No se pudo validar el segundo factor' }, { status: 500 });
  }
}
