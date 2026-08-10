import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticator } from '@otplib/preset-v11';
import QRCode from 'qrcode';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function encryptSecret(secret: string): string {
  // Simple base64 encoding with app key prefix for obfuscation
  // In production, use proper AES encryption with TOTP_ENCRYPTION_KEY
  const key = process.env.DOCUBOX_INTERNAL_SIGNING_KEY || 'docubox-totp-key';
  const combined = `${key}:${secret}`;
  return Buffer.from(combined).toString('base64');
}

function decryptSecret(encrypted: string): string | null {
  try {
    const key = process.env.DOCUBOX_INTERNAL_SIGNING_KEY || 'docubox-totp-key';
    const decoded = Buffer.from(encrypted, 'base64').toString('utf-8');
    const prefix = `${key}:`;
    if (!decoded.startsWith(prefix)) return null;
    const secret = decoded.slice(prefix.length);
    return /^[A-Z2-7]+=*$/.test(secret) ? secret : null;
  } catch {
    return null;
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
    // Get authenticated user from Authorization header
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

    // Reuse a recent pending setup so retries cannot leave the QR and DB with different secrets.
    const { data: pendingSettings } = await supabaseAdmin
      .from('user_totp_settings')
      .select('secret_encrypted, is_enabled, updated_at, locked_until')
      .eq('user_id', user.id)
      .maybeSingle();

    if (
      pendingSettings?.locked_until &&
      new Date(pendingSettings.locked_until).getTime() > Date.now()
    ) {
      return NextResponse.json(
        { error: 'La configuración está bloqueada temporalmente por varios intentos fallidos.' },
        { status: 429 }
      );
    }

    authenticator.options = { digits: 6, step: 30, algorithm: 'sha1' };
    const pendingSecret = pendingSettings?.secret_encrypted
      ? decryptSecret(pendingSettings.secret_encrypted)
      : null;
    const pendingAge = pendingSettings?.updated_at
      ? Date.now() - new Date(pendingSettings.updated_at).getTime()
      : Number.POSITIVE_INFINITY;
    const canReusePendingSecret =
      !pendingSettings?.is_enabled && Boolean(pendingSecret) && pendingAge < 10 * 60 * 1000;
    const secret = canReusePendingSecret ? pendingSecret! : authenticator.generateSecret(20);

    // Build otpauth URL
    const accountName = user.email || user.id;
    const issuer = 'Docubox';
    const otpauthUrl = authenticator.keyuri(accountName, issuer, secret);

    // Generate QR code as data URL
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      width: 256,
      margin: 2,
    });

    // Only replace the pending secret when starting a genuinely new setup.
    const { error: upsertError } = canReusePendingSecret
      ? { error: null }
      : await supabaseAdmin.from('user_totp_settings').upsert(
          {
            user_id: user.id,
            secret_encrypted: encryptSecret(secret),
            is_enabled: false,
            failed_attempts: 0,
            locked_until: null,
          },
          { onConflict: 'user_id' }
        );

    if (upsertError) {
      return NextResponse.json({ error: 'Error al guardar configuración TOTP' }, { status: 500 });
    }

    // Log event
    await logSecurityEvent(
      user.id,
      'TOTP_SETUP_STARTED',
      'Inicio de configuración de app autenticadora',
      req,
      { reusedPendingSetup: canReusePendingSecret }
    );

    return NextResponse.json({
      qrCodeUrl,
      manualSecret: secret,
      issuer,
      accountName,
      reusedPendingSetup: canReusePendingSecret,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[TOTP Setup]', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
