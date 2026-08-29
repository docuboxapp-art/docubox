import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OTP_EXPIRY_MINUTES = 10;
const TABLE = 'signature_otps';

// Deterministic UUIDs used as document_id for password-reset OTPs
const PASSWORD_RESET_DOC_ID = '00000000-0000-0000-0000-000000000001';
const PASSWORD_RESET_TOKEN_DOC_ID = '00000000-0000-0000-0000-000000000002';

// POST /api/auth/password-reset-otp — send OTP to email
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) {
      return NextResponse.json({ error: 'El correo es requerido' }, { status: 400 });
    }

    // Verify the user exists in auth
    const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      return NextResponse.json({ error: 'Error al verificar el correo' }, { status: 500 });
    }

    const userExists = usersData.users.some(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (!userExists) {
      // Return success anyway to avoid email enumeration
      return NextResponse.json({ success: true });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP using email as identifier (document_id = PASSWORD_RESET_DOC_ID)
    const { error: dbError } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        {
          user_id: usersData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())!.id,
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

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox.com.mx';

    const emailPayload = {
      from: process.env.FROM_EMAIL || 'Docubox <noreply@docubox.com.mx>',
      to: [email],
      subject: `Código para restablecer tu contraseña — DocuBox`,
      reply_to: 'soporte@docubox.com.mx',
      html: `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Restablecer contraseña</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#1a56db;padding:28px 32px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">DocuBox</p>
              <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Plataforma de firma electrónica</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <p style="margin:0 0 8px;font-size:15px;color:#374151;">Hola,</p>
              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta DocuBox asociada a <strong style="color:#111827;">${email}</strong>.<br/>
                Ingresa el siguiente código para continuar con el proceso.
              </p>
              <div style="background:#f0f4ff;border:2px solid #c7d7fe;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:1px;">Código de verificación</p>
                <p style="margin:0;font-size:42px;font-weight:800;letter-spacing:12px;color:#1a56db;font-family:'Courier New',monospace;">${otp}</p>
                <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Válido por <strong>${OTP_EXPIRY_MINUTES} minutos</strong></p>
              </div>
              <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin:0 0 24px;">
                <p style="margin:0;font-size:12px;color:#92400e;line-height:1.5;">
                  ⚠️ Si no solicitaste este código, ignora este mensaje. Nunca compartas este código con nadie.
                </p>
              </div>
              <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">
                Este correo fue generado automáticamente por DocuBox.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">© 2026 DocuBox · Plataforma de firma electrónica · México</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
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
      const resendMessage = emailResponseBody?.message || emailResponseBody?.name || 'Error al enviar el correo';
      return NextResponse.json(
        { error: `Error al enviar el correo: ${resendMessage}` },
        { status: 500 }
      );
    }

    console.log('[password-reset-otp] Email sent successfully. Resend id:', emailResponseBody?.id);
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
    const { email, otpCode } = await req.json();
    if (!email || !otpCode) {
      return NextResponse.json({ error: 'Correo y código son requeridos' }, { status: 400 });
    }

    // Find user
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const user = usersData?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
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
      return NextResponse.json({ error: 'Código OTP no encontrado o ya utilizado' }, { status: 400 });
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

    await supabaseAdmin.from(TABLE).insert({
      user_id: user.id,
      document_id: PASSWORD_RESET_TOKEN_DOC_ID,
      otp_code: resetToken,
      expires_at: tokenExpiry.toISOString(),
      used: false,
      created_at: new Date().toISOString(),
    });

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
    const { email, resetToken, newPassword } = await req.json();
    if (!email || !resetToken || !newPassword) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    // Find user
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
    const user = usersData?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
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
      return NextResponse.json({ error: 'Token de restablecimiento inválido o expirado' }, { status: 400 });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: 'El token de restablecimiento ha expirado' }, { status: 400 });
    }

    // Update password via admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateError) {
      console.error('[password-reset-otp] updateUserById error:', updateError.message);
      return NextResponse.json({ error: 'Error al actualizar la contraseña' }, { status: 500 });
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
