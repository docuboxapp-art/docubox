import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import crypto from 'crypto';

import { createServiceClient } from '@/lib/supabase/server';

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox-delta.vercel.app';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = 'Docubox <noreply@docubox.com.mx>';

const LOGO_LIGHT = `${APP_URL}/assets/images/docubox-logo-2026.png`;

function buildVerificationEmailHtml(recipientName: string, verificationUrl: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Verifica tu correo electrónico — Docubox</title>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body, table, td, p, h1, a, span { font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,Helvetica,sans-serif; }
    body { margin:0;padding:0;background-color:#F6F8FB;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%; }
    @media only screen and (max-width:600px){
      .email-container{width:100%!important;border-radius:0!important;}
      .email-body{padding:24px 20px!important;}
      .email-header{padding:20px!important;}
      .email-heading{padding:22px 20px!important;}
      .email-footer{padding:24px 20px!important;}
      .footer-link{display:block!important;margin:8px 0 0!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F6F8FB;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Confirma tu correo para completar tu cuenta en Docubox.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F8FB;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="background-color:#ffffff;border:1px solid #E6EAF0;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td class="email-header" style="background-color:#ffffff;padding:24px 40px;border-bottom:1px solid #EBEBF0;">
              <img src="${LOGO_LIGHT}" alt="Docubox" width="142" height="auto" style="display:block;border:0;max-width:142px;" />
            </td>
          </tr>

          <!-- HEADING -->
          <tr>
            <td class="email-heading" style="background-color:#eff6ff;padding:24px 40px 20px;border-bottom:1px solid #dbeafe;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="vertical-align:middle;padding-right:16px;width:52px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="48" height="48" style="width:48px;height:48px;background-color:#1E6BFF;border-radius:8px;">
                      <tr>
                        <td align="center" valign="middle" style="color:#ffffff;font-family:Arial,sans-serif;font-size:22px;font-weight:700;text-align:center;vertical-align:middle;">&#9993;</td>
                      </tr>
                    </table>
                  </td>
                  <td style="vertical-align:middle;">
                    <p style="font-size:11px;font-weight:700;color:#2563eb;margin:0 0 4px;line-height:1.3;text-transform:uppercase;">
                      Seguridad de la cuenta
                    </p>
                    <h1 style="font-size:20px;font-weight:700;color:#1e3a8a;margin:0 0 2px;line-height:1.3;">
                      Verifica tu correo electrónico
                    </h1>
                    <p style="font-size:13px;color:#3b82f6;margin:0;line-height:1.5;">
                      Completa la validación de tu cuenta
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="email-body" style="padding:32px 40px 36px;background-color:#ffffff;">
              <p style="font-size:15px;color:#374151;margin:0 0 8px;line-height:1.7;">
                Hola <strong>${recipientName}</strong>,
              </p>
              <p style="font-size:15px;color:#6b7280;margin:0 0 24px;line-height:1.7;">
                Confirma que esta dirección de correo te pertenece para completar tu registro y acceder a Docubox.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:8px;background-color:#1E6BFF;">
                    <a href="${verificationUrl}" target="_blank"
                       style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                      Validar correo
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="font-size:12px;color:#6b7280;margin:0 0 6px;line-height:1.6;">
                Si el botón no funciona, abre este enlace:
              </p>
              <p style="font-size:12px;color:#1E6BFF;margin:0 0 24px;line-height:1.6;word-break:break-all;">
                <a href="${verificationUrl}" style="color:#1E6BFF;text-decoration:underline;">${verificationUrl}</a>
              </p>

              <!-- Info banner -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;">
                <tr>
                  <td style="background-color:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:14px 16px;">
                    <p style="font-size:13px;color:#1e40af;margin:0;line-height:1.6;">
                      <strong>Este enlace vence en 72 horas.</strong><br>
                      Si no creaste una cuenta en Docubox, puedes ignorar este correo de forma segura.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="email-footer" style="background-color:#ffffff;padding:26px 40px;border-top:1px solid #EBEBF0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${LOGO_LIGHT}" alt="Docubox" width="104" height="auto" style="display:block;border:0;max-width:104px;" />
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <a class="footer-link" href="${APP_URL}/login" style="font-size:12px;color:#64748b;text-decoration:none;display:inline-block;margin-left:20px;">Mi cuenta</a>
                    <a class="footer-link" href="${APP_URL}/politica-privacidad" style="font-size:12px;color:#64748b;text-decoration:none;display:inline-block;margin-left:20px;">Privacidad</a>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="border-top:1px solid #f1f5f9;padding-top:16px;">
                    <p style="font-size:11px;color:#6b7280;margin:16px 0 4px;line-height:1.6;">
                      © ${year} Docubox. Todos los derechos reservados.
                    </p>
                    <p style="font-size:11px;color:#6b7280;margin:0;line-height:1.6;">
                      Recibiste este mensaje porque se inició un registro con esta dirección.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <p style="font-size:11px;color:#9ca3af;margin:16px 0 0;text-align:center;">
          Este correo fue enviado de forma segura por Docubox.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function escapeHtml(value: string): string {
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

function isValidRegistrationSignature(userId: string, email: string, supplied: string | null) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = crypto
    .createHmac('sha256', serviceRoleKey)
    .update(`${userId}\n${email}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'));
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email, fullName } = await req.json();
    const normalizedEmail = normalizeEmail(email);

    if (!userId || !normalizedEmail) {
      return NextResponse.json({ error: 'userId y email son requeridos' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    if (!supabaseUrl || !anonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
      return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
    }

    const authClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => undefined,
      },
    });
    const {
      data: { user: sessionUser },
    } = await authClient.auth.getUser();
    const sessionAuthorized = Boolean(
      sessionUser &&
      sessionUser.id === userId &&
      normalizeEmail(sessionUser.email) === normalizedEmail
    );
    const registrationAuthorized = isValidRegistrationSignature(
      userId,
      normalizedEmail,
      req.headers.get('x-docubox-registration-signature')
    );

    if (!sessionAuthorized && !registrationAuthorized) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const supabaseAdmin = createServiceClient();
    const { data: target, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !target.user || normalizeEmail(target.user.email) !== normalizedEmail) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }
    if (target.user.email_confirmed_at) {
      return NextResponse.json({ error: 'El correo ya está verificado' }, { status: 409 });
    }

    // Only the latest link remains usable. Store a digest, never the bearer token.
    await supabaseAdmin
      .from('email_verification_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('used_at', null);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const { data: tokenRecord, error: insertError } = await supabaseAdmin
      .from('email_verification_tokens')
      .insert({ user_id: userId, token: tokenHash, email: normalizedEmail, expires_at: expiresAt })
      .select('id')
      .single();

    if (insertError) {
      console.error('[send-verification-email] Error inserting token:', insertError);
      return NextResponse.json(
        { error: 'Error al generar token de verificación' },
        { status: 500 }
      );
    }

    const verificationUrl = `${req.nextUrl.origin}/verificar-correo?token=${token}`;
    const recipientName =
      (registrationAuthorized && typeof fullName === 'string' && fullName.trim()) ||
      (typeof target.user.user_metadata?.full_name === 'string' &&
        target.user.user_metadata.full_name.trim()) ||
      normalizedEmail.split('@')[0];
    const html = buildVerificationEmailHtml(escapeHtml(recipientName), verificationUrl);

    // Send via Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: 'noreply@docubox.com.mx',
        to: [normalizedEmail],
        subject: 'Verifica tu correo electrónico — Docubox',
        html,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('[send-verification-email] Resend error:', resendData);
      await supabaseAdmin.from('email_verification_tokens').delete().eq('id', tokenRecord.id);
      return NextResponse.json(
        { error: 'Error al enviar correo de verificación' },
        { status: 500 }
      );
    }

    console.info('[send-verification-email] Verification link issued', {
      userId,
      providerMessageId: resendData.id,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[send-verification-email] Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
