import { NextRequest, NextResponse } from 'next/server';
import { hasConfirmedTotp, resolvePlatformAccess } from '@/lib/platform-admin/access';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

// Check if user has TOTP enabled — used by login flow
export async function POST(req: NextRequest) {
  try {
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
    const [totpEnabled, access] = await Promise.all([
      hasConfirmedTotp(data.user.id, service),
      resolvePlatformAccess(data.user, service),
    ]);
    const platformStaff = access !== null;
    const platformSuperAdmin = access?.role === 'DOCUBOX_SUPER_ADMIN';

    return NextResponse.json(
      {
        totpEnabled,
        platformStaff,
        platformSuperAdmin,
        passkeyRequired: access?.passkeyRequired === true,
        passkeyEnrolled: access?.passkeyEnrolled === true,
        enrollmentRequired: platformStaff && !totpEnabled,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[auth/totp/check] Security requirements check failed', error);
    return NextResponse.json({ error: 'No se pudo validar el segundo factor' }, { status: 500 });
  }
}
