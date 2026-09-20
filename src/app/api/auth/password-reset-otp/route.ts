import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseAdmin: SupabaseClient<any> | null = null;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase service credentials are not configured.');
  }
  return (supabaseAdmin ??= createClient(url, serviceRoleKey));
}

async function findAuthUserByEmail(admin: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('id,email')
    .ilike('email', normalizedEmail)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return null;

  const { data, error } = await admin.auth.admin.getUserById(profile.id);
  if (error || data.user?.email?.trim().toLowerCase() !== normalizedEmail) return null;
  return data.user;
}

const OTP_EXPIRY_MINUTES = 10;
const TABLE = 'signature_otps';
const APP_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox-docubox.vercel.app').replace(
  /\/$/,
  ''
);
const LOGO_URL = `${APP_URL}/assets/images/docubox-logo-2026.png`;

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character] || character;
  });
}

function buildPasswordResetEmailHtml(params: {
  recipientName?: string;
  email: string;
  otpCode: string;
}) {
  const year = new Date().getFullYear();
  const greeting = params.recipientName
    ? `Hola <strong style="color:#18181B;">${escapeHtml(params.recipientName)}</strong>,`
    : 'Hola,';
  const safeEmail = escapeHtml(params.email);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Restablece tu contraseña — Docubox</title>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing:border-box; }
    body, table, td, p, h1, a, span { font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,Helvetica,sans-serif; }
    body { margin:0;padding:0;background-color:#F6F8FB;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
    .email-container { table-layout:fixed; }
    @media only screen and (max-width:600px) {
      .email-shell { padding:0!important; }
      .email-container { width:100%!important;max-width:100%!important;border-radius:0!important; }
      .email-header, .email-heading, .email-body, .email-footer { padding-left:20px!important;padding-right:20px!important; }
      .otp-code { font-size:32px!important;letter-spacing:7px!important;white-space:nowrap!important; }
      .footer-links { text-align:left!important;padding-top:14px!important; }
      .footer-link { margin:0 16px 0 0!important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F6F8FB;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Usa este código para restablecer de forma segura tu contraseña de Docubox.</div>
  <table role="presentation" class="email-shell" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F8FB;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E6EAF0;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td class="email-header" style="background-color:#FFFFFF;padding:24px 40px;border-bottom:1px solid #EBEBF0;">
              <img src="${LOGO_URL}" alt="Docubox" width="142" style="display:block;width:142px;max-width:142px;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td class="email-heading" style="background-color:#EFF6FF;padding:24px 40px 20px;border-bottom:1px solid #DBEAFE;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="52" valign="middle" style="width:52px;vertical-align:middle;padding-right:16px;">
                    <table role="presentation" width="48" height="48" cellpadding="0" cellspacing="0" border="0" style="width:48px;height:48px;background-color:#1E6BFF;border-radius:8px;">
                      <tr><td align="center" valign="middle" style="color:#FFFFFF;font-size:22px;font-weight:700;line-height:48px;text-align:center;vertical-align:middle;">&#10003;</td></tr>
                    </table>
                  </td>
                  <td valign="middle" style="vertical-align:middle;">
                    <p style="margin:0 0 4px;font-size:11px;line-height:1.3;font-weight:700;color:#2563EB;text-transform:uppercase;">Seguridad de la cuenta</p>
                    <h1 style="margin:0 0 2px;font-size:20px;line-height:1.3;font-weight:700;color:#1E3A8A;">Restablece tu contraseña</h1>
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#3B82F6;">Código temporal de recuperación</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-body" style="padding:32px 40px 36px;background-color:#FFFFFF;">
              <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#374151;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#6B7280;">
                Recibimos una solicitud para restablecer la contraseña de la cuenta asociada a <strong style="color:#18181B;word-break:break-all;overflow-wrap:anywhere;">${safeEmail}</strong>. Ingresa este código para continuar.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;margin:0 0 20px;">
                <tr>
                  <td align="center" style="padding:24px 20px;">
                    <p style="margin:0 0 8px;font-size:11px;line-height:1.4;font-weight:700;color:#2563EB;text-transform:uppercase;">Código de verificación</p>
                    <p class="otp-code" style="margin:0;font-size:40px;line-height:1.2;font-weight:700;letter-spacing:12px;color:#1E6BFF;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;">${params.otpCode}</p>
                    <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#64748B;">Vence en ${OTP_EXPIRY_MINUTES} minutos y solo puede utilizarse una vez.</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
                <tr>
                  <td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#475569;">
                    Si no solicitaste este cambio, ignora el mensaje. Docubox nunca te pedirá compartir este código por teléfono o chat.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-footer" style="background-color:#FFFFFF;padding:24px 40px;border-top:1px solid #EBEBF0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle"><img src="${LOGO_URL}" alt="Docubox" width="104" style="display:block;width:104px;max-width:104px;height:auto;border:0;"></td>
                  <td class="footer-links" valign="middle" align="right" style="text-align:right;">
                    <a class="footer-link" href="${APP_URL}/login" style="display:inline-block;margin-left:20px;font-size:12px;color:#64748B;text-decoration:none;">Mi cuenta</a>
                    <a class="footer-link" href="${APP_URL}/politica-privacidad" style="display:inline-block;margin-left:20px;font-size:12px;color:#64748B;text-decoration:none;">Privacidad</a>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:16px;border-top:1px solid #F1F5F9;">
                    <p style="margin:16px 0 4px;font-size:11px;line-height:1.6;color:#6B7280;">© ${year} Docubox. Todos los derechos reservados.</p>
                    <p style="margin:0;font-size:11px;line-height:1.6;color:#6B7280;">Recibiste este mensaje porque se solicitó recuperar el acceso a tu cuenta.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#9CA3AF;text-align:center;">Este correo fue enviado de forma segura por Docubox.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Deterministic UUIDs used as document_id for password-reset OTPs
const PASSWORD_RESET_DOC_ID = '00000000-0000-0000-0000-000000000001';
const PASSWORD_RESET_TOKEN_DOC_ID = '00000000-0000-0000-0000-000000000002';

// POST /api/auth/password-reset-otp — send OTP to email
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'El correo es requerido' }, { status: 400 });
    }

    // Resolve the exact account instead of relying on the first page of Auth users.
    let user;
    try {
      user = await findAuthUserByEmail(supabaseAdmin, email);
    } catch {
      return NextResponse.json({ error: 'Error al verificar el correo' }, { status: 500 });
    }

    if (!user) {
      // Return success anyway to avoid email enumeration
      return NextResponse.json({ success: true });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP using email as identifier (document_id = PASSWORD_RESET_DOC_ID)
    const { error: dbError } = await supabaseAdmin.from(TABLE).upsert(
      {
        user_id: user.id,
        document_id: PASSWORD_RESET_DOC_ID,
        otp_code: otp,
        expires_at: expiresAt.toISOString(),
        used: false,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,document_id' }
    );

    if (dbError) {
      console.error('[password-reset-otp] DB upsert error:', dbError.message);
      return NextResponse.json({ error: 'Error al generar el código' }, { status: 500 });
    }

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      return NextResponse.json({ error: 'Configuración de correo no disponible' }, { status: 500 });
    }

    const emailPayload = {
      from: process.env.FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>',
      to: [email],
      subject: 'Restablece tu contraseña en Docubox',
      reply_to: 'soporte@docubox.com.mx',
      html: buildPasswordResetEmailHtml({
        recipientName:
          typeof user.user_metadata?.full_name === 'string'
            ? user.user_metadata.full_name.trim()
            : undefined,
        email,
        otpCode: otp,
      }),
    };

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const emailResponseBody = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error('[password-reset-otp] Resend error status:', emailResponse.status);
      console.error('[password-reset-otp] Resend error body:', JSON.stringify(emailResponseBody));
      const resendMessage =
        emailResponseBody?.message || emailResponseBody?.name || 'Error al enviar el correo';
      return NextResponse.json(
        { error: `Error al enviar el correo: ${resendMessage}` },
        { status: 500 }
      );
    }

    console.info('[password-reset-otp] Email sent successfully. Resend id:', emailResponseBody?.id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[password-reset-otp] POST error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PUT /api/auth/password-reset-otp — verify OTP
export async function PUT(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { email, otpCode } = await req.json();
    if (!email || !otpCode) {
      return NextResponse.json({ error: 'Correo y código son requeridos' }, { status: 400 });
    }

    const user = await findAuthUserByEmail(supabaseAdmin, email);
    if (!user) {
      return NextResponse.json({ error: 'Código incorrecto o expirado' }, { status: 400 });
    }

    // Fetch OTP record
    const { data: otpRecord, error: fetchError } = await supabaseAdmin
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .eq('document_id', PASSWORD_RESET_DOC_ID)
      .eq('used', false)
      .single();

    if (fetchError || !otpRecord) {
      return NextResponse.json(
        { error: 'Código OTP no encontrado o ya utilizado' },
        { status: 400 }
      );
    }

    if (new Date(otpRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'El código OTP ha expirado' }, { status: 400 });
    }

    if (otpRecord.otp_code !== otpCode) {
      return NextResponse.json({ error: 'Código OTP incorrecto' }, { status: 400 });
    }

    // Mark as used
    await supabaseAdmin.from(TABLE).update({ used: true }).eq('id', otpRecord.id);

    // Generate a short-lived reset token (store it so PATCH can use it)
    const resetToken = crypto.randomUUID();
    const tokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    const { error: resetTokenError } = await supabaseAdmin.from(TABLE).upsert(
      {
        user_id: user.id,
        document_id: PASSWORD_RESET_TOKEN_DOC_ID,
        otp_code: resetToken,
        expires_at: tokenExpiry.toISOString(),
        used: false,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,document_id' }
    );

    if (resetTokenError) {
      console.error('[password-reset-otp] reset token upsert error:', resetTokenError.message);
      return NextResponse.json(
        { error: 'No fue posible iniciar el cambio de contraseña' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, resetToken });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[password-reset-otp] PUT error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/auth/password-reset-otp — update password using reset token
export async function PATCH(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { email, resetToken, newPassword } = await req.json();
    if (!email || !resetToken || !newPassword) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const user = await findAuthUserByEmail(supabaseAdmin, email);
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 400 });
    }

    // Validate reset token
    const { data: tokenRecord, error: tokenError } = await supabaseAdmin
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .eq('document_id', PASSWORD_RESET_TOKEN_DOC_ID)
      .eq('otp_code', resetToken)
      .eq('used', false)
      .single();

    if (tokenError || !tokenRecord) {
      return NextResponse.json(
        { error: 'Token de restablecimiento inválido o expirado' },
        { status: 400 }
      );
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'El token de restablecimiento ha expirado' },
        { status: 400 }
      );
    }

    // A valid reset OTP also proves control of the registered email address.
    const verifiedAt = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
      email_confirm: true,
    });

    if (updateError) {
      console.error('[password-reset-otp] updateUserById error:', updateError.message);
      return NextResponse.json({ error: 'Error al actualizar la contraseña' }, { status: 500 });
    }

    const [profileResult, verificationResult] = await Promise.all([
      supabaseAdmin
        .from('user_profiles')
        .update({ email_verified: true, email_verified_at: verifiedAt })
        .eq('id', user.id),
      supabaseAdmin
        .from('user_verification_status')
        .upsert(
          { user_id: user.id, email_verified: true, email_verified_at: verifiedAt },
          { onConflict: 'user_id' }
        ),
    ]);

    if (profileResult.error || verificationResult.error) {
      console.error('[password-reset-otp] verification sync error:', {
        profile: profileResult.error?.message,
        verification: verificationResult.error?.message,
      });
      return NextResponse.json(
        { error: 'La contraseña se actualizó, pero no se pudo finalizar la verificación' },
        { status: 500 }
      );
    }

    // Invalidate token
    await supabaseAdmin.from(TABLE).update({ used: true }).eq('id', tokenRecord.id);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[password-reset-otp] PATCH error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
