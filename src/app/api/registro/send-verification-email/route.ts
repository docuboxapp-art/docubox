import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://firmamax4272.builtwithrocket.new';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = 'Docubox <noreply@docubox.com.mx>';

const LOGO_LIGHT = `${APP_URL}/assets/images/docubox-logo-2026.png`;
const LOGO_WHITE =
  'https://docubox-myi2411.public.builtwithrocket.new/assets/images/ChatGPT_Image_13_may_2026_20_28_22-1778729319274.png';

function buildVerificationEmailHtml(recipientName: string, verificationUrl: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Verifica tu correo electrónico — Docubox</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { margin:0;padding:0;background-color:#f3f4f6;font-family:'Inter',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%; }
    @media only screen and (max-width:600px){
      .email-container{width:100%!important;border-radius:0!important;}
      .email-body{padding:24px 20px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
  <div style="display:none;max-height:0;overflow:hidden;">Verifica tu correo para activar tu cuenta en Docubox</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0"
               style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background-color:#ffffff;padding:24px 40px;border-bottom:1px solid #e5e7eb;">
              <img src="${LOGO_LIGHT}" alt="Docubox" width="130" height="auto" style="display:block;border:0;max-width:130px;" />
            </td>
          </tr>

          <!-- HERO BAND -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);padding:36px 40px 32px;">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <div style="width:52px;height:52px;background:rgba(255,255,255,0.15);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
                      <span style="font-size:26px;">✉️</span>
                    </div>
                    <h1 style="font-family:'Inter',Arial,sans-serif;font-size:24px;font-weight:700;color:#ffffff;margin:0 0 8px;line-height:1.3;">
                      Verifica tu correo electrónico
                    </h1>
                    <p style="font-family:'Inter',Arial,sans-serif;font-size:15px;color:rgba(255,255,255,0.85);margin:0;line-height:1.6;">
                      Un paso más para activar tu cuenta en Docubox
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td class="email-body" style="padding:36px 40px;">
              <p style="font-family:'Inter',Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 16px;line-height:1.7;">
                Hola <strong>${recipientName}</strong>,
              </p>
              <p style="font-family:'Inter',Arial,sans-serif;font-size:15px;color:#374151;margin:0 0 24px;line-height:1.7;">
                Gracias por registrarte en <strong>Docubox</strong>. Para completar tu registro y poder crear documentos, necesitas verificar tu dirección de correo electrónico.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);">
                    <a href="${verificationUrl}" target="_blank"
                       style="display:inline-block;padding:16px 40px;font-family:'Inter',Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.2px;border-radius:10px;">
                      ✓ &nbsp;Validar cuenta
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#6b7280;margin:0 0 8px;line-height:1.6;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#3b82f6;margin:0 0 28px;word-break:break-all;">
                <a href="${verificationUrl}" style="color:#3b82f6;text-decoration:underline;">${verificationUrl}</a>
              </p>

              <!-- Info banner -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#eff6ff;border-radius:8px;padding:16px 18px;border-left:4px solid #3b82f6;">
                    <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#1e40af;margin:0;line-height:1.6;">
                      <strong>ℹ️ Importante:</strong> Este enlace es válido por <strong>72 horas</strong>. Si no solicitaste esta cuenta, puedes ignorar este correo.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- What happens next -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;border-top:1px solid #f3f4f6;">
                <tr>
                  <td style="padding:20px 0 0;">
                    <p style="font-family:'Inter',Arial,sans-serif;font-size:13px;font-weight:600;color:#111827;margin:0 0 12px;">
                      ¿Qué puedes hacer después de verificar?
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;">
                          <span style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#374151;">📄 &nbsp;Crear y enviar documentos para firma</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;">
                          <span style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#374151;">✍️ &nbsp;Firmar documentos electrónicamente</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;">
                          <span style="font-family:'Inter',Arial,sans-serif;font-size:13px;color:#374151;">👥 &nbsp;Invitar participantes a tus documentos</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color:#111827;padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${LOGO_WHITE}" alt="Docubox" width="110" height="auto" style="display:block;border:0;max-width:110px;" />
                  </td>
                  <td style="vertical-align:middle;text-align:right;">
                    <a href="${APP_URL}/login" style="font-family:'Inter',Arial,sans-serif;font-size:12px;color:#9ca3af;text-decoration:none;display:inline-block;margin-left:20px;">Mi cuenta</a>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="border-top:1px solid #1f2937;padding-top:20px;margin-top:16px;">
                    <p style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#6b7280;margin:16px 0 4px;">
                      © ${year} Docubox. Todos los derechos reservados.
                    </p>
                    <p style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#4b5563;margin:0;line-height:1.6;">
                      Recibiste este correo porque te registraste en Docubox. Si no reconoces esta actividad, ignora este mensaje.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <p style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#9ca3af;margin:16px 0 0;text-align:center;">
          Este correo fue enviado de forma segura por Docubox.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email, fullName } = await req.json();

    if (!userId || !email) {
      return NextResponse.json({ error: 'userId y email son requeridos' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
      return NextResponse.json({ error: 'Configuración del servidor incompleta' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    // Store token in DB
    const { error: insertError } = await supabaseAdmin.from('email_verification_tokens').insert({
      user_id: userId,
      token,
      email,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error('[send-verification-email] Error inserting token:', insertError);
      return NextResponse.json(
        { error: 'Error al generar token de verificación' },
        { status: 500 }
      );
    }

    const verificationUrl = `${APP_URL}/verificar-correo?token=${token}`;
    const recipientName = fullName || email.split('@')[0];
    const html = buildVerificationEmailHtml(recipientName, verificationUrl);

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
        to: [email],
        subject: 'Verifica tu correo electrónico — Docubox',
        html,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('[send-verification-email] Resend error:', resendData);
      return NextResponse.json(
        { error: 'Error al enviar correo de verificación' },
        { status: 500 }
      );
    }

    console.log(`[send-verification-email] Sent to ${email}, resend id: ${resendData.id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[send-verification-email] Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
