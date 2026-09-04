import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolvePlatformAccess } from '@/lib/platform-admin/access';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function logSecurityEvent(
  userId: string,
  eventType: string,
  description: string,
  req: NextRequest,
  metadata?: Record<string, unknown>
) {
  try {
    await supabaseAdmin.from('auth_security_events').insert({
      user_id: userId,
      event_type: eventType,
      description,
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
      user_agent: req.headers.get('user-agent') || 'unknown',
      metadata: metadata || null,
    });
  } catch {
    // non-blocking
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authHeader.slice(7);

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const platformAccess = await resolvePlatformAccess(user, supabaseAdmin);
    if (platformAccess) {
      await logSecurityEvent(
        user.id,
        'TOTP_DISABLE_DENIED',
        'Intento de desactivar el segundo factor obligatorio del personal de plataforma',
        req
      );
      return NextResponse.json(
        {
          error: 'El Token Móvil es obligatorio para el personal interno de Docubox.',
          errorCode: 'PLATFORM_STAFF_TOTP_REQUIRED',
        },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { password } = body;

    if (!password || typeof password !== 'string' || password.trim().length === 0) {
      return NextResponse.json({ error: 'La contraseña es requerida' }, { status: 400 });
    }

    // Verify password by attempting sign-in with user's email
    const email = user.email;
    if (!email) {
      return NextResponse.json(
        { error: 'No se pudo obtener el correo del usuario' },
        { status: 400 }
      );
    }

    // Use a separate client (anon key) to verify the password
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error: signInError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password: password.trim(),
    });

    if (signInError) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 400 });
    }

    // Check TOTP is active
    const { data: totpSettings, error: fetchError } = await supabaseAdmin
      .from('user_totp_settings')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_enabled', true)
      .single();

    if (fetchError || !totpSettings) {
      return NextResponse.json({ error: 'El Tóken Móvil no está activo' }, { status: 404 });
    }

    // Disable TOTP
    await supabaseAdmin
      .from('user_totp_settings')
      .update({
        is_enabled: false,
        confirmed_at: null,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('user_id', user.id);

    await logSecurityEvent(user.id, 'TOTP_DISABLED', 'Tóken Móvil desactivado', req);

    return NextResponse.json({ success: true, message: 'Tóken Móvil desactivado correctamente.' });
  } catch (err) {
    console.error('[TOTP Disable]', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
