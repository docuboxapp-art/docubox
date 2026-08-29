import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Resend } from 'resend';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request_otp') }),
  z.object({
    action: z.literal('verify_otp'),
    challenge_id: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({ action: z.literal('submit') }),
]);

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

function otpHash(token: string, code: string) {
  const pepper =
    process.env.SIGNATURE_OTP_PEPPER ||
    process.env.DOCUBOX_INTERNAL_SIGNING_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pepper) throw new Error('otp_service_unavailable');
  return sha(`${token}:${code}:${pepper}`);
}

function clientIp(request: Request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] || character);
}

async function requestFromToken(service: ReturnType<typeof createServiceClient>, token: string) {
  const result = await service
    .from('collaboration_document_requests')
    .select('*')
    .eq('access_token_hash', sha(token))
    .maybeSingle();
  if (result.error) throw result.error;
  const documentRequest = result.data;
  if (
    !documentRequest ||
    !['sent', 'in_progress', 'in_review', 'completed'].includes(documentRequest.status) ||
    (documentRequest.access_expires_at &&
      new Date(documentRequest.access_expires_at).getTime() <= Date.now())
  ) {
    return null;
  }
  return documentRequest;
}

async function validSession(
  service: ReturnType<typeof createServiceClient>,
  requestId: string,
  sessionToken: string
) {
  if (!sessionToken) return null;
  const result = await service
    .from('collaboration_request_external_sessions')
    .select('*')
    .eq('request_id', requestId)
    .eq('session_token_hash', sha(sessionToken))
    .is('revoked_at', null)
    .not('otp_consumed_at', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const service = createServiceClient();
    const documentRequest = await requestFromToken(service, token);
    if (!documentRequest)
      return Response.json({ error: 'La solicitud vencio o fue cancelada.' }, { status: 410 });

    const response: Record<string, unknown> = {
      authenticated: false,
      request: {
        folio: documentRequest.folio,
        title: documentRequest.title,
        description: documentRequest.description,
        due_at: documentRequest.due_at,
        status: documentRequest.status,
      },
    };
    const sessionToken = request.headers.get('x-colabora-session') || '';
    const session = await validSession(service, documentRequest.id, sessionToken);
    if (session) {
      const [itemsResult, filesResult] = await Promise.all([
        service
          .from('collaboration_request_items')
          .select('id,item_type,title,description,required,status,position,rejection_reason,validation_status')
          .eq('request_id', documentRequest.id)
          .order('position'),
        service
          .from('collaboration_request_files')
          .select('id,request_item_id,original_name,mime_type,byte_size,sha256,malware_scan_status,version,received_at')
          .eq('workspace_id', documentRequest.workspace_id)
          .order('version', { ascending: false }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (filesResult.error) throw filesResult.error;
      const itemIds = new Set((itemsResult.data || []).map((item) => item.id));
      const files = (filesResult.data || []).filter((file) => itemIds.has(file.request_item_id));
      response.authenticated = true;
      response.recipient_name = documentRequest.recipient_name;
      response.items = (itemsResult.data || []).map((item) => ({
        ...item,
        files: files.filter((file) => file.request_item_id === item.id),
      }));
      await service
        .from('collaboration_request_external_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', session.id);
    }

    return Response.json(response, {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch {
    return Response.json({ error: 'No se pudo validar la solicitud.' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const input = inputSchema.parse(await request.json());
    const service = createServiceClient();
    const documentRequest = await requestFromToken(service, token);
    if (!documentRequest)
      return Response.json({ error: 'La solicitud vencio o fue cancelada.' }, { status: 410 });

    if (input.action === 'request_otp') {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey)
        return Response.json(
          { error: 'El servicio de correo no esta configurado.' },
          { status: 503 }
        );
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const challenge = await service
        .from('collaboration_request_external_sessions')
        .insert({
          workspace_id: documentRequest.workspace_id,
          request_id: documentRequest.id,
          session_token_hash: sha(randomBytes(32).toString('base64url')),
          otp_hash: otpHash(token, code),
          otp_expires_at: expiresAt,
          expires_at: expiresAt,
          ip_address: clientIp(request),
          user_agent: request.headers.get('user-agent'),
        })
        .select('id')
        .single();
      if (challenge.error) throw challenge.error;

      const resend = new Resend(resendKey);
      const sent = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Docubox <noreply@docubox.mx>',
        to: documentRequest.recipient_email,
        subject: `Codigo para ${documentRequest.folio}`,
        html: `<div style="font-family:'Google Sans','Google Sans Text','Segoe UI',Arial,sans-serif;max-width:560px;margin:auto;color:#18181b"><h2>Solicitud documental Docubox</h2><p>Hola, ${escapeHtml(documentRequest.recipient_name)}. Usa este codigo para consultar y completar <strong>${escapeHtml(documentRequest.title)}</strong>.</p><div style="margin:24px 0;padding:20px;text-align:center;background:#f5f7ff;border:1px solid #dbe3ff;border-radius:8px;font-size:34px;font-weight:700;letter-spacing:9px;color:#1E6BFF">${code}</div><p style="font-size:12px;color:#71717a">El codigo vence en 10 minutos. No lo compartas.</p></div>`,
      });
      if (sent.error) {
        await service
          .from('collaboration_request_external_sessions')
          .delete()
          .eq('id', challenge.data.id);
        throw sent.error;
      }
      return Response.json({ challenge_id: challenge.data.id, expires_at: expiresAt });
    }

    if (input.action === 'submit') {
      const session = await validSession(
        service,
        documentRequest.id,
        request.headers.get('x-colabora-session') || ''
      );
      if (!session)
        return Response.json({ error: 'La sesion vencio.' }, { status: 401 });
      const items = await service
        .from('collaboration_request_items')
        .select('id,required,status')
        .eq('request_id', documentRequest.id);
      if (items.error) throw items.error;
      const incomplete = (items.data || []).filter(
        (item) => item.required && !['uploaded', 'in_review', 'approved', 'waived'].includes(item.status)
      );
      if (incomplete.length)
        return Response.json(
          { error: 'Completa todos los requisitos obligatorios antes de enviar.' },
          { status: 409 }
        );
      const now = new Date().toISOString();
      const requestUpdate = await service
        .from('collaboration_document_requests')
        .update({ status: 'in_review' })
        .eq('id', documentRequest.id)
        .in('status', ['sent', 'in_progress']);
      if (requestUpdate.error) throw requestUpdate.error;
      const itemUpdate = await service
        .from('collaboration_request_items')
        .update({ status: 'in_review' })
        .eq('request_id', documentRequest.id)
        .eq('status', 'uploaded');
      if (itemUpdate.error) throw itemUpdate.error;
      await service.from('collaboration_activity_events').insert({
        workspace_id: documentRequest.workspace_id,
        event_type: 'request.submitted',
        resource_type: 'document_request',
        resource_id: documentRequest.id,
        summary: 'La persona invitada envio la solicitud a revision.',
        visibility: 'internal',
        metadata: { external_session_id: session.id, submitted_at: now },
      });
      return Response.json({ success: true, status: 'in_review' });
    }

    const challenge = await service
      .from('collaboration_request_external_sessions')
      .select('*')
      .eq('id', input.challenge_id)
      .eq('request_id', documentRequest.id)
      .is('otp_consumed_at', null)
      .is('revoked_at', null)
      .maybeSingle();
    if (challenge.error) throw challenge.error;
    if (
      !challenge.data ||
      !challenge.data.otp_hash ||
      !challenge.data.otp_expires_at ||
      new Date(challenge.data.otp_expires_at).getTime() <= Date.now()
    )
      return Response.json({ error: 'El codigo expiro. Solicita uno nuevo.' }, { status: 400 });
    if (challenge.data.failed_attempts >= 5)
      return Response.json({ error: 'Se alcanzo el limite de intentos.' }, { status: 429 });

    const expected = Buffer.from(challenge.data.otp_hash, 'hex');
    const received = Buffer.from(otpHash(token, input.code), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await service
        .from('collaboration_request_external_sessions')
        .update({ failed_attempts: challenge.data.failed_attempts + 1 })
        .eq('id', challenge.data.id);
      return Response.json({ error: 'El codigo no es valido.' }, { status: 400 });
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const updated = await service
      .from('collaboration_request_external_sessions')
      .update({
        session_token_hash: sha(sessionToken),
        otp_consumed_at: new Date().toISOString(),
        expires_at: expiresAt,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', challenge.data.id);
    if (updated.error) throw updated.error;
    await service
      .from('collaboration_document_requests')
      .update({ status: 'in_progress' })
      .eq('id', documentRequest.id)
      .eq('status', 'sent');
    return Response.json({ session_token: sessionToken, expires_at: expiresAt });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? 'Solicitud invalida.'
        : error instanceof Error && error.message === 'otp_service_unavailable'
          ? 'El servicio OTP no esta configurado.'
          : 'No se pudo completar el acceso.';
    return Response.json({ error: message }, { status: 500 });
  }
}
