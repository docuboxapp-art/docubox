import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'Email requerido.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Get user profile for name and user id
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('nombre, id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (!profile?.id) {
      return NextResponse.json({ error: 'No se encontró una cuenta con ese correo.' }, { status: 404 });
    }

    // Generate a 6-digit OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Store OTP in login_otps table (invalidate previous ones first)
    await supabaseAdmin
      .from('login_otps')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', profile.id)
      .is('used_at', null);

    const { error: insertError } = await supabaseAdmin
      .from('login_otps')
      .insert({
        user_id: profile.id,
        email: email.trim().toLowerCase(),
        otp_code: otpCode,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('[send-login-otp] insert error:', insertError);
      return NextResponse.json({ error: 'No se pudo generar el código. Intenta de nuevo.' }, { status: 500 });
    }

    // Send custom email via edge function
    const { error: emailError } = await supabaseAdmin.functions.invoke('send-email-notifications', {
      body: {
        type: 'login_otp',
        to: email.trim(),
        recipientName: profile?.nombre || undefined,
        otpCode,
      },
    });

    if (emailError) {
      console.error('[send-login-otp] email error:', emailError);
      return NextResponse.json({ error: 'No se pudo enviar el código. Intenta de nuevo.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[send-login-otp]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
