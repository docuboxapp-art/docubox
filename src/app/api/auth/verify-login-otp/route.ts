import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) {
      return NextResponse.json({ error: 'Email y código son requeridos.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Find valid OTP
    const { data: otpRecord, error: fetchError } = await supabaseAdmin
      .from('login_otps')
      .select('id, user_id, otp_code, expires_at, used_at')
      .eq('email', email.trim().toLowerCase())
      .eq('otp_code', code.trim())
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error('[verify-login-otp] fetch error:', fetchError);
      return NextResponse.json({ error: 'Error al verificar el código.' }, { status: 500 });
    }

    if (!otpRecord) {
      return NextResponse.json({ error: 'Código incorrecto o ya utilizado.' }, { status: 400 });
    }

    // Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'El código ha expirado. Solicita uno nuevo.' }, { status: 400 });
    }

    // Mark OTP as used
    await supabaseAdmin
      .from('login_otps')
      .update({ used_at: new Date().toISOString() })
      .eq('id', otpRecord.id);

    // Generate a magic link token for the user so the client can exchange it for a session
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email.trim().toLowerCase(),
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[verify-login-otp] generateLink error:', linkError);
      return NextResponse.json({ error: 'No se pudo crear la sesión. Intenta de nuevo.' }, { status: 500 });
    }

    // Build response and set the session-start httpOnly cookie for the 10-hour absolute limit
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const successResponse = NextResponse.json({
      success: true,
      userId: otpRecord.user_id,
      tokenHash: linkData.properties.hashed_token,
    });
    successResponse.cookies.set('docubox_session_start', nowSeconds, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 60 + 300, // 10 hours + 5 min buffer
    });
    return successResponse;
  } catch (err) {
    console.error('[verify-login-otp]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
