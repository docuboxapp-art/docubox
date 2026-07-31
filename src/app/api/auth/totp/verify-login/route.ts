import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from '@otplib/preset-v11';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function decryptSecret(encrypted: string): string {
  try {
    const decoded = Buffer.from(encrypted, 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    return colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
  } catch {
    return encrypted;
  }
}

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
    const body = await req.json();
    const { userId, code } = body;

    if (!userId || !code) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'El código debe ser de 6 dígitos numéricos' }, { status: 400 });
    }

    // Get TOTP settings
    const { data: totpSettings, error: fetchError } = await supabaseAdmin
      .from('user_totp_settings')
      .select('*')
      .eq('user_id', userId)
      .eq('is_enabled', true)
      .single();

    if (fetchError || !totpSettings) {
      return NextResponse.json({ error: 'TOTP no está activo para este usuario' }, { status: 404 });
    }

    // Check lockout
    if (totpSettings.locked_until && new Date(totpSettings.locked_until) > new Date()) {
      const unlockAt = new Date(totpSettings.locked_until);
      await logSecurityEvent(userId, 'LOGIN_TOTP_LOCKED', 'Intento de login bloqueado por demasiados intentos fallidos', req);
      return NextResponse.json({
        error: `Cuenta bloqueada temporalmente. Intenta después de las ${unlockAt.toLocaleTimeString('es-MX')}.`,
        locked: true,
      }, { status: 429 });
    }

    // Decrypt and verify
    const secret = decryptSecret(totpSettings.secret_encrypted);
    authenticator.options = { digits: 6, step: 30, algorithm: 'sha1', window: 1 };
    const isValid = authenticator.verify({ token: code, secret });

    if (!isValid) {
      const newAttempts = (totpSettings.failed_attempts || 0) + 1;
      const updateData: Record<string, unknown> = { failed_attempts: newAttempts };

      if (newAttempts >= 5) {
        updateData.locked_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        updateData.failed_attempts = 0;
      }

      await supabaseAdmin
        .from('user_totp_settings')
        .update(updateData)
        .eq('user_id', userId);

      await logSecurityEvent(userId, 'LOGIN_TOTP_FAILED', 'Código TOTP incorrecto en inicio de sesión', req, { attempts: newAttempts });

      return NextResponse.json({
        error: 'Código incorrecto. Verifica tu app autenticadora e intenta nuevamente.',
        attemptsLeft: Math.max(0, 5 - newAttempts),
      }, { status: 400 });
    }

    // Success
    await supabaseAdmin
      .from('user_totp_settings')
      .update({
        last_used_at: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('user_id', userId);

    await logSecurityEvent(userId, 'LOGIN_TOTP_SUCCESS', 'Inicio de sesión con TOTP exitoso', req);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[TOTP Verify Login]', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
