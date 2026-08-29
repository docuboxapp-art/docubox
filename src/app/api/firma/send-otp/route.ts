import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function getOtpPepper() {
  return process.env.SIGNATURE_OTP_PEPPER || process.env.DOCUBOX_INTERNAL_SIGNING_KEY || '';
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function hashEmail(value: string) {
  return createHash('sha256').update(normalizeEmail(value), 'utf8').digest('hex');
}

function digestOtp(input: {
  challengeId: string;
  documentId: string;
  userId: string;
  otp: string;
}) {
  return createHmac('sha256', getOtpPepper())
    .update(`${input.challengeId}:${input.documentId}:${input.userId}:${input.otp}`, 'utf8')
    .digest('hex');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function requireUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(authorization.slice(7).trim());
  return error ? null : user;
}

async function getAuthorizedDocument(documentId: string, userId: string, userEmail: string) {
  const { data: document } = await supabaseAdmin
    .from('documentos')
    .select('id,nombre,owner_id,participantes,file_hash_sha256')
    .eq('id', documentId)
    .maybeSingle();
  if (!document) return null;

  const email = normalizeEmail(userEmail);
  const participants = Array.isArray(document.participantes) ? document.participantes : [];
  const listed = participants.some((participant: Record<string, unknown>) =>
    participant.id === userId
    || normalizeEmail(String(participant.email || '')) === email
  );
  if (document.owner_id === userId || listed) return document;

  const { data: responseById } = await supabaseAdmin
    .from('participation_responses')
    .select('id')
    .eq('documento_id', documentId)
    .eq('participante_id', userId)
    .limit(1)
    .maybeSingle();
  if (responseById) return document;
  const { data: responseByEmail } = await supabaseAdmin
    .from('participation_responses')
    .select('id')
    .eq('documento_id', documentId)
    .ilike('participante_email', email)
    .limit(1)
    .maybeSingle();
  return responseByEmail ? document : null;
}

async function appendOtpEvent(input: {
  documentId: string;
  userId: string;
  userEmail: string;
  eventType: string;
  eventResult: 'SUCCESS' | 'FAILED' | 'DENIED';
  payload: Record<string, unknown>;
  documentSha256?: string | null;
  idempotencyKey?: string | null;
}) {
  const { error } = await supabaseAdmin.rpc('append_legal_evidence_event', {
    p_document_id: input.documentId,
    p_event_type: input.eventType,
    p_event_category: 'SECURITY',
    p_event_result: input.eventResult,
    p_actor_id: input.userId,
    p_actor_type: 'PARTICIPANT',
    p_payload: input.payload,
    p_document_sha256: input.documentSha256 || null,
    p_actor_email: input.userEmail,
    p_idempotency_key: input.idempotencyKey || null,
    p_source_system: 'SIGNATURE_OTP_API',
  });
  if (error) console.error('[signature-otp] Evidence append failed:', error.code);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!user?.email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!getOtpPepper()) {
      return NextResponse.json({ error: 'Servicio OTP no configurado' }, { status: 503 });
    }

    const body = await request.json();
    const documentId = String(body.documentId || '');
    const requestedEmail = normalizeEmail(String(body.recipientEmail || ''));
    if (!documentId || !requestedEmail) {
      return NextResponse.json({ error: 'documentId y recipientEmail son requeridos' }, { status: 400 });
    }

    const authenticatedEmail = normalizeEmail(user.email);
    if (requestedEmail !== authenticatedEmail) {
      return NextResponse.json({ error: 'El codigo solo puede enviarse al correo autenticado' }, { status: 403 });
    }

    const document = await getAuthorizedDocument(documentId, user.id, authenticatedEmail);
    if (!document) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    const resendAfter = new Date(Date.now() - OTP_RESEND_SECONDS * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('signature_otp_challenges')
      .select('id,created_at')
      .eq('document_id', documentId)
      .eq('user_id', user.id)
      .gte('created_at', resendAfter)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      return NextResponse.json(
        { error: `Espera ${OTP_RESEND_SECONDS} segundos antes de solicitar otro codigo` },
        { status: 429 },
      );
    }

    const challengeId = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const codeDigest = digestOtp({ challengeId, documentId, userId: user.id, otp });
    const { error: insertError } = await supabaseAdmin.from('signature_otp_challenges').insert({
      id: challengeId,
      document_id: documentId,
      user_id: user.id,
      recipient_email_sha256: hashEmail(authenticatedEmail),
      code_digest: codeDigest,
      expires_at: expiresAt.toISOString(),
      delivery_status: 'PENDING',
    });
    if (insertError) {
      console.error('[signature-otp] Challenge insert failed:', insertError.code);
      return NextResponse.json({ error: 'No se pudo preparar el codigo' }, { status: 500 });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      await supabaseAdmin.from('signature_otp_challenges')
        .update({ delivery_status: 'FAILED' }).eq('id', challengeId);
      return NextResponse.json({ error: 'Configuracion de correo no disponible' }, { status: 503 });
    }

    const documentName = escapeHtml(String(document.nombre || body.documentName || 'Documento'));
    const recipientName = escapeHtml(String(body.recipientName || user.user_metadata?.full_name || user.email));
    const appUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://docubox-docubox.vercel.app').replace(/\/$/, '');
    const logoUrl = `${appUrl}/assets/images/docubox-logo-2026.png`;
    const configuredFrom = process.env.FROM_EMAIL?.trim();
    const fromEmail = configuredFrom
      ? configuredFrom.includes('<') ? configuredFrom : `Docubox <${configuredFrom}>`
      : 'Docubox <noreply@docubox.com.mx>';
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        reply_to: 'noreply@docubox.com.mx',
        to: [authenticatedEmail],
        subject: `Código de verificación para firma - ${documentName}`,
        html: `<!doctype html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Código de verificación para firma - ${documentName}</title></head>
<body style="margin:0;padding:0;background:#F6F8FB;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;color:#18181B;-webkit-text-size-adjust:100%;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F8FB;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #EBEBF0;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,.08);">
        <tr><td style="padding:24px 40px;border-bottom:1px solid #EBEBF0;background:#FFFFFF;"><img src="${logoUrl}" alt="Docubox" width="142" style="display:block;width:142px;height:auto;border:0;"></td></tr>
        <tr><td style="padding:32px 40px 36px;">
          <p style="margin:0 0 8px;font-size:24px;line-height:1.3;font-weight:700;color:#18181B;">Código de verificación para firma</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#52525B;">Hola <strong style="color:#18181B;">${recipientName}</strong>. Usa este código para confirmar tu firma en <strong style="color:#18181B;">${documentName}</strong>.</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;margin:0 0 24px;"><tr><td align="center" style="padding:24px;">
            <p style="margin:0 0 8px;font-size:12px;line-height:1.4;font-weight:700;color:#1E6BFF;text-transform:uppercase;letter-spacing:1px;">Código de un solo uso</p>
            <p style="margin:0;font-size:40px;line-height:1.2;font-weight:700;letter-spacing:12px;color:#1E6BFF;font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;">${otp}</p>
            <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#64748B;">Expira en ${OTP_EXPIRY_MINUTES} minutos y solo puede utilizarse una vez.</p>
          </td></tr></table>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border-radius:8px;margin:0 0 24px;"><tr><td style="padding:16px;font-size:13px;line-height:1.6;color:#475569;">Si no solicitaste este código, ignora este mensaje. Docubox nunca te pedirá compartirlo.</td></tr></table>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94A3B8;">Por seguridad, nunca compartas este código por teléfono o chat.</p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #EBEBF0;background:#FFFFFF;text-align:center;"><p style="margin:0;font-size:11px;color:#94A3B8;">Este correo fue enviado de forma segura por Docubox.</p></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const emailData = await emailResponse.json().catch(() => ({})) as { id?: string };
    if (!emailResponse.ok || !emailData.id) {
      await supabaseAdmin.from('signature_otp_challenges')
        .update({ delivery_status: 'FAILED' }).eq('id', challengeId);
      await appendOtpEvent({
        documentId, userId: user.id, userEmail: authenticatedEmail,
        eventType: 'SIGNATURE_OTP_DELIVERY_FAILED', eventResult: 'FAILED',
        documentSha256: document.file_hash_sha256,
        payload: { challenge_id: challengeId, channel: 'EMAIL' },
        idempotencyKey: `otp-delivery-failed:${challengeId}`,
      });
      return NextResponse.json({ error: 'No se pudo enviar el codigo. Intenta de nuevo.' }, { status: 502 });
    }

    await supabaseAdmin.from('signature_otp_challenges').update({
      delivery_status: 'SENT', provider_message_id: emailData.id,
    }).eq('id', challengeId);
    await appendOtpEvent({
      documentId, userId: user.id, userEmail: authenticatedEmail,
      eventType: 'SIGNATURE_OTP_SENT', eventResult: 'SUCCESS',
      documentSha256: document.file_hash_sha256,
      payload: { challenge_id: challengeId, channel: 'EMAIL', expires_at: expiresAt.toISOString() },
      idempotencyKey: `otp-sent:${challengeId}`,
    });

    return NextResponse.json({
      success: true,
      challengeId,
      expiresAt: expiresAt.toISOString(),
      expiryMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (error) {
    console.error('[signature-otp] Send failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo enviar el codigo. Intenta de nuevo.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!user?.email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!getOtpPepper()) return NextResponse.json({ error: 'Servicio OTP no configurado' }, { status: 503 });

    const body = await request.json();
    const documentId = String(body.documentId || '');
    const otpCode = String(body.otpCode || '').trim();
    if (!documentId || !/^\d{6}$/.test(otpCode)) {
      return NextResponse.json({ error: 'Codigo OTP invalido' }, { status: 400 });
    }
    const document = await getAuthorizedDocument(documentId, user.id, user.email);
    if (!document) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

    const { data: challenge } = await supabaseAdmin
      .from('signature_otp_challenges')
      .select('id')
      .eq('document_id', documentId)
      .eq('user_id', user.id)
      .eq('delivery_status', 'SENT')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!challenge) return NextResponse.json({ error: 'Codigo no encontrado o ya utilizado' }, { status: 400 });

    const codeDigest = digestOtp({ challengeId: challenge.id, documentId, userId: user.id, otp: otpCode });
    const { data, error } = await supabaseAdmin.rpc('consume_signature_otp', {
      p_document_id: documentId,
      p_user_id: user.id,
      p_code_digest: codeDigest,
    });
    if (error || !Array.isArray(data) || !data[0]) {
      console.error('[signature-otp] Consume failed:', error?.code);
      return NextResponse.json({ error: 'No se pudo verificar el codigo' }, { status: 500 });
    }

    const result = data[0] as { status: string; challenge_id: string; attempts_remaining: number };
    if (result.status !== 'VERIFIED') {
      await appendOtpEvent({
        documentId, userId: user.id, userEmail: user.email,
        eventType: 'SIGNATURE_OTP_REJECTED', eventResult: 'DENIED',
        documentSha256: document.file_hash_sha256,
        payload: { challenge_id: result.challenge_id, status: result.status, attempts_remaining: result.attempts_remaining },
      });
      const messages: Record<string, string> = {
        EXPIRED: 'El codigo OTP ha expirado',
        LOCKED: 'Se alcanzo el limite de intentos',
        CONSUMED: 'El codigo OTP ya fue utilizado',
        NOT_FOUND: 'Codigo no encontrado o ya utilizado',
        INVALID: 'Codigo OTP incorrecto',
      };
      return NextResponse.json(
        { error: messages[result.status] || 'Codigo OTP invalido', attemptsRemaining: result.attempts_remaining },
        { status: result.status === 'LOCKED' ? 429 : 400 },
      );
    }

    await appendOtpEvent({
      documentId, userId: user.id, userEmail: user.email,
      eventType: 'SIGNATURE_OTP_VERIFIED', eventResult: 'SUCCESS',
      documentSha256: document.file_hash_sha256,
      payload: { challenge_id: result.challenge_id, method: 'EMAIL_OTP' },
      idempotencyKey: `otp-verified:${result.challenge_id}`,
    });
    return NextResponse.json({ success: true, verified: true, challengeId: result.challenge_id });
  } catch (error) {
    console.error('[signature-otp] Verify failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No se pudo verificar el codigo' }, { status: 500 });
  }
}
