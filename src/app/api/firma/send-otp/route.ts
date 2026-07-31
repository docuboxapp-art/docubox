import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OTP_EXPIRY_MINUTES = 10;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { documentId, documentName, recipientEmail, recipientName } = await req.json();

    if (!documentId || !recipientEmail) {
      return NextResponse.json({ error: 'documentId y recipientEmail son requeridos' }, { status: 400 });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP in Supabase (upsert by user+document)
    const { error: dbError } = await supabaseAdmin
      .from('signature_otps')
      .upsert({
        user_id: user.id,
        document_id: documentId,
        otp_code: otp,
        expires_at: expiresAt.toISOString(),
        used: false,
        created_at: new Date().toISOString(),
      }, { onConflict: 'user_id,document_id' });

    if (dbError) {
      console.warn('[send-otp] DB error (table may not exist):', dbError.message);
    }

    const docName = documentName || 'Documento';
    const name = recipientName || user.email || 'Firmante';

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('[send-otp] RESEND_API_KEY not configured');
      return NextResponse.json({ error: 'Configuración de correo no disponible' }, { status: 500 });
    }

    // Send OTP email via Resend API — same pattern as /api/test-notifications
    const emailPayload = {
      from: process.env.FROM_EMAIL || 'noreply@docubox.com.mx',
      to: [recipientEmail],
      subject: `Código de verificación para firma — ${docName}`,
      html: `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Código de verificación</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
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
              <p style="margin:0 0 8px;font-size:15px;color:#374151;">Hola, <strong>${name}</strong></p>
              <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
                Has iniciado el proceso de firma del documento <strong style="color:#111827;">${docName}</strong>.<br/>
                Ingresa el siguiente código para verificar tu identidad y completar la firma.
              </p>
              <div style="background:#f0f4ff;border:2px solid #c7d7fe;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:1px;">Código de verificación</p>
                <p style="margin:0;font-size:42px;font-weight:800;letter-spacing:12px;color:#1a56db;font-family:'Courier New',monospace;">${otp}</p>
                <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Válido por <strong>${OTP_EXPIRY_MINUTES} minutos</strong></p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 24px;">
                <tr>
                  <td style="padding:4px 0;">
                    <p style="margin:0;font-size:12px;color:#6b7280;">📄 <strong>Documento:</strong> ${docName}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;">
                    <p style="margin:0;font-size:12px;color:#6b7280;">⏰ <strong>Expira en:</strong> ${OTP_EXPIRY_MINUTES} minutos</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0;">
                    <p style="margin:0;font-size:12px;color:#6b7280;">🔒 <strong>Uso único:</strong> Este código solo puede usarse una vez</p>
                  </td>
                </tr>
              </table>
              <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin:0 0 24px;">
                <p style="margin:0;font-size:12px;color:#92400e;line-height:1.5;">
                  ⚠️ Si no solicitaste este código, ignora este mensaje. Nunca compartas este código con nadie.
                </p>
              </div>
              <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">
                Este correo fue generado automáticamente por DocuBox.<br/>
                Registro de proceso de firma conforme a NOM-151-SCFI-2016.
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

    const emailData = await emailResponse.json();

    if (!emailResponse.ok || !emailData.id) {
      console.error('[send-otp] Resend API error:', emailResponse.status, JSON.stringify(emailData));
      return NextResponse.json(
        { error: `Error al enviar el correo OTP: ${emailData.message || emailData.error || emailResponse.status}` },
        { status: 500 }
      );
    }

    console.log('[send-otp] Email sent successfully, id:', emailData.id);

    return NextResponse.json({
      success: true,
      expiresAt: expiresAt.toISOString(),
      expiryMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    console.error('[send-otp] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  // Verify OTP
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { documentId, otpCode } = await req.json();
    if (!documentId || !otpCode) {
      return NextResponse.json({ error: 'documentId y otpCode son requeridos' }, { status: 400 });
    }

    // Check OTP in DB
    const { data: otpRecord, error: fetchError } = await supabaseAdmin
      .from('signature_otps')
      .select('*')
      .eq('user_id', user.id)
      .eq('document_id', documentId)
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
    await supabaseAdmin
      .from('signature_otps')
      .update({ used: true })
      .eq('id', otpRecord.id);

    return NextResponse.json({ success: true, verified: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
