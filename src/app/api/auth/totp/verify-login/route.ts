import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from '@otplib/preset-v11';
import { resolvePlatformAccess } from '@/lib/platform-admin/access';
import {
  createPlatformMfaProof,
  PLATFORM_MFA_COOKIE,
  platformMfaCookieOptions,
} from '@/lib/security/platform-mfa-proof';
import {
  PLATFORM_PASSKEY_COOKIE,
  verifyPlatformPasskeyProof,
} from '@/lib/security/platform-passkey-proof';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function decryptSecret(encrypted: string): string {
  try {
    const decoded = Buffer.from(encrypted, 'base64').toString('utf-8');
    const key = process.env.DOCUBOX_INTERNAL_SIGNING_KEY || 'docubox-totp-key';
    const prefix = `${key}:`;
    if (decoded.startsWith(prefix)) return decoded.slice(prefix.length);

    // Compatibility with secrets stored before the prefixed format was enforced.
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
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    const token = authorization.slice(7).trim();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json();
    const { code } = body;
    const userId = authData.user.id;
    const access = await resolvePlatformAccess(authData.user, supabaseAdmin);
    const passkeyVerified = access?.passkeyRequired
      ? verifyPlatformPasskeyProof(req.cookies.get(PLATFORM_PASSKEY_COOKIE)?.value, userId)
      : false;

    if (access?.passkeyRequired && !passkeyVerified) {
      return NextResponse.json(
        {
          error: 'Confirma tu passkey antes de ingresar el código del autenticador.',
          errorCode: 'PLATFORM_PASSKEY_REQUIRED',
        },
        { status: 403 }
      );
    }

    if (!code) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'El código debe ser de 6 dígitos numéricos' },
        { status: 400 }
      );
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
      await logSecurityEvent(
        userId,
        'LOGIN_TOTP_LOCKED',
        'Intento de login bloqueado por demasiados intentos fallidos',
        req
      );
      return NextResponse.json(
        {
          error: `Cuenta bloqueada temporalmente. Intenta después de las ${unlockAt.toLocaleTimeString('es-MX')}.`,
          locked: true,
        },
        { status: 429 }
      );
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

      await supabaseAdmin.from('user_totp_settings').update(updateData).eq('user_id', userId);

      await logSecurityEvent(
        userId,
        'LOGIN_TOTP_FAILED',
        'Código TOTP incorrecto en inicio de sesión',
        req,
        { attempts: newAttempts }
      );

      return NextResponse.json(
        {
          error: 'Código incorrecto. Verifica tu app autenticadora e intenta nuevamente.',
          attemptsLeft: Math.max(0, 5 - newAttempts),
        },
        { status: 400 }
      );
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

    const response = NextResponse.json({ success: true });
    if (access) {
      response.cookies.set(
        PLATFORM_MFA_COOKIE,
        createPlatformMfaProof(authData.user, { passkeyVerified }),
        platformMfaCookieOptions()
      );
      response.cookies.delete(PLATFORM_PASSKEY_COOKIE);
    }
    return response;
  } catch (err) {
    console.error('[TOTP Verify Login]', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
