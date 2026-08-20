import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const FROM_EMAIL = process.env.FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>';

function buildLoginOtpEmailHtml(params: {
  recipientName?: string;
  email: string;
  otpCode: string;
}) {
  const greeting = params.recipientName ? `Hola ${params.recipientName},` : 'Hola,';

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Codigo de acceso Docubox</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Google Sans','Inter','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:#1E6BFF;padding:28px 32px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Docubox</p>
              <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Codigo de inicio de sesion</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <p style="margin:0 0 8px;font-size:15px;color:#374151;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
                Usa este codigo para entrar a tu cuenta Docubox asociada a <strong style="color:#111827;">${params.email}</strong>.
              </p>
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;">Codigo de verificacion</p>
                <p style="margin:0;font-size:42px;font-weight:800;letter-spacing:12px;color:#1E6BFF;font-family:'Google Sans','Inter','Segoe UI',Arial,sans-serif;">${params.otpCode}</p>
                <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">Valido por 10 minutos</p>
              </div>
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                Por seguridad, nunca compartas este codigo. Si no intentaste iniciar sesion, puedes ignorar este correo.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">Docubox - Plataforma de firma electronica</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendLoginOtpDirectEmail(params: {
  email: string;
  recipientName?: string;
  otpCode: string;
}) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY no esta configurada en el entorno de Next/Vercel.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      reply_to: 'noreply@docubox.com.mx',
      to: [params.email],
      subject: 'Tu codigo de acceso a Docubox',
      html: buildLoginOtpEmailHtml(params),
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.name || 'Error al enviar el correo OTP';
    throw new Error(message);
  }
}

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
      return NextResponse.json(
        { error: 'No se encontró una cuenta con ese correo.' },
        { status: 404 }
      );
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

    const { error: insertError } = await supabaseAdmin.from('login_otps').insert({
      user_id: profile.id,
      email: email.trim().toLowerCase(),
      otp_code: otpCode,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error('[send-login-otp] insert error:', insertError);
      return NextResponse.json(
        { error: 'No se pudo generar el código. Intenta de nuevo.' },
        { status: 500 }
      );
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
      console.error('[send-login-otp] edge email error:', emailError);
      try {
        await sendLoginOtpDirectEmail({
          email: email.trim(),
          recipientName: profile?.nombre || undefined,
          otpCode,
        });
        return NextResponse.json({ success: true });
      } catch (directEmailError) {
        const message =
          directEmailError instanceof Error
            ? directEmailError.message
            : 'No se pudo enviar el codigo.';
        console.error('[send-login-otp] direct email error:', message);
        return NextResponse.json(
          { error: `Error al enviar el correo OTP: ${message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[send-login-otp]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
