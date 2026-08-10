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

    const body = await req.json();
    const { code } = body;

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'El código debe ser de 6 dígitos numéricos' },
        { status: 400 }
      );
    }

    // Get TOTP settings
    const { data: totpSettings, error: fetchError } = await supabaseAdmin
      .from('user_totp_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (fetchError || !totpSettings) {
      return NextResponse.json(
        { error: 'No se encontró configuración TOTP. Inicia el proceso de configuración.' },
        { status: 404 }
      );
    }

    // Check lockout
    if (totpSettings.locked_until && new Date(totpSettings.locked_until) > new Date()) {
      const unlockAt = new Date(totpSettings.locked_until);
      return NextResponse.json(
        {
          error: `Demasiados intentos fallidos. Intenta nuevamente después de las ${unlockAt.toLocaleTimeString('es-MX')}.`,
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
      // Diagnose clock drift without accepting a code outside the normal security window.
      authenticator.options = { digits: 6, step: 30, algorithm: 'sha1', window: 10 };
      const clockDelta = authenticator.checkDelta(code, secret);
      if (clockDelta !== null && Math.abs(clockDelta) > 1) {
        await logSecurityEvent(
          user.id,
          'TOTP_SETUP_FAILED',
          'Hora del dispositivo desincronizada durante configuración TOTP',
          req,
          { reason: 'clock_skew', deltaSteps: clockDelta }
        );
        return NextResponse.json(
          {
            error:
              'La hora de tu teléfono no coincide con la hora segura. Activa la fecha y hora automáticas y usa el código nuevo.',
            errorCode: 'CLOCK_SKEW',
            serverTime: new Date().toISOString(),
          },
          { status: 400 }
        );
      }

      const newAttempts = (totpSettings.failed_attempts || 0) + 1;
      const updateData: Record<string, unknown> = { failed_attempts: newAttempts };

      if (newAttempts >= 5) {
        updateData.locked_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        updateData.failed_attempts = 0;
      }

      await supabaseAdmin.from('user_totp_settings').update(updateData).eq('user_id', user.id);

      await logSecurityEvent(
        user.id,
        'TOTP_SETUP_FAILED',
        'Código TOTP incorrecto durante configuración',
        req,
        { attempts: newAttempts }
      );

      return NextResponse.json(
        {
          error:
            'El código no coincide con la configuración actual. Usa la entrada Docubox más reciente o vuelve a escanear el QR.',
          errorCode: 'CODE_MISMATCH',
          attemptsLeft: Math.max(0, 5 - newAttempts),
          serverTime: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Activate TOTP
    await supabaseAdmin
      .from('user_totp_settings')
      .update({
        is_enabled: true,
        confirmed_at: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('user_id', user.id);

    await logSecurityEvent(
      user.id,
      'TOTP_ENABLED',
      'App autenticadora activada correctamente',
      req
    );

    return NextResponse.json({
      success: true,
      message: 'App autenticadora activada correctamente.',
    });
  } catch (err) {
    console.error('[TOTP Verify Setup]', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
