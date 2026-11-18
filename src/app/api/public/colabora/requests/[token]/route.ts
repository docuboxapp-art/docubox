import { organizationApiFailure } from '@/lib/organization/server';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Resend } from 'resend';
import { wrapDocuboxEmail } from '@/lib/emailFooter';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { hasCurrentCollaborationEntitlement } from '@/lib/collaboration/entitlements-server';

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

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] || character
  );
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
  if (
    !(await hasCurrentCollaborationEntitlement(
      service,
      documentRequest.workspace_id,
      'collaboration_core'
    ))
  )
    return null;
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
          .select(
            'id,item_type,title,description,required,status,position,rejection_reason,validation_status,form_template_id,form_response_id,document_id'
          )
          .eq('request_id', documentRequest.id)
          .order('position'),
        service
          .from('collaboration_request_files')
          .select(
            'id,request_item_id,original_name,mime_type,byte_size,sha256,malware_scan_status,version,received_at'
          )
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
      const challenge = await service.rpc('colabora_issue_request_otp', {
        request_hash: sha(token),
        code_hash: otpHash(token, code),
        new_session_hash: sha(randomBytes(32).toString('base64url')),
      });
      if (challenge.error) throw challenge.error;
      const resend = new Resend(resendKey);
      const sent = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Docubox <noreply@docubox.mx>',
        to: documentRequest.recipient_email,
        subject: `Codigo para ${documentRequest.folio}`,
        html: wrapDocuboxEmail(
          `<h2>Solicitud documental Docubox</h2><p>Hola, ${escapeHtml(documentRequest.recipient_name)}. Usa este código para consultar y completar <strong>${escapeHtml(documentRequest.title)}</strong>.</p><div style="margin:24px 0;padding:20px;text-align:center;background:#f5f7ff;border:1px solid #dbe3ff;border-radius:8px;font-size:34px;font-weight:700;letter-spacing:9px;color:#1E6BFF">${code}</div><p style="font-size:12px;color:#71717a">El código vence en 10 minutos. No lo compartas.</p>`,
          'Recibiste este correo porque solicitaste acceso a una solicitud documental mediante Docubox.'
        ),
      });
      if (sent.error) {
        await service
          .from('collaboration_request_external_sessions')
          .delete()
          .eq('id', challenge.data);
        throw sent.error;
      }
      return Response.json({ challenge_id: challenge.data, expires_at: expiresAt });
    }

    if (input.action === 'submit') {
      if (
        !(await hasCurrentCollaborationEntitlement(
          service,
          documentRequest.workspace_id,
          'collaboration_core',
          true
        ))
      )
        return Response.json(
          { error: 'La organización no tiene habilitadas nuevas entregas.' },
          { status: 403 }
        );
      const submitted = await service.rpc('colabora_submit_request', {
        request_hash: sha(token),
        session_hash: sha(request.headers.get('x-colabora-session') || ''),
      });
      if (submitted.error) throw submitted.error;
      if (submitted.data.reviewer_id)
        try {
          await createNotificationServer({
            userId: submitted.data.reviewer_id,
            type: 'request',
            eventType: 'collaboration.request.submitted',
            title: 'Solicitud lista para revisar',
            description: 'El destinatario completó los requisitos y envió su solicitud a revisión.',
            actionUrl: `/colabora/solicitudes/${submitted.data.id}`,
            actionLabel: 'Revisar solicitud',
            deduplicationKey: `collaboration.request.submitted:${submitted.data.id}:${submitted.data.version}`,
            metadata: { workspace_id: submitted.data.workspace_id, request_id: submitted.data.id },
          });
        } catch {
          console.error('[colabora] request_notification_unavailable');
        }
      return Response.json({ success: true, status: submitted.data.status });
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const verified = await service.rpc('colabora_verify_request_otp', {
      request_hash: sha(token),
      challenge_id: input.challenge_id,
      received_hash: otpHash(token, input.code),
      new_session_hash: sha(sessionToken),
    });
    if (verified.error) throw verified.error;
    if (verified.data.status !== 200) {
      const messages: Record<string, string> = {
        otp_expired: 'El código expiró. Solicita uno nuevo.',
        otp_invalid: 'El código no es válido.',
        otp_attempts_exceeded: 'Se alcanzó el límite de intentos.',
        request_expired: 'La solicitud venció o fue cancelada.',
      };
      return Response.json(
        { error: messages[verified.data.code] || 'No se pudo verificar el código.' },
        { status: verified.data.status }
      );
    }
    return Response.json({ session_token: sessionToken, expires_at: verified.data.expires_at });
  } catch (error) {
    if (error instanceof Error && error.message === 'otp_service_unavailable')
      return Response.json({ error: 'El servicio OTP no está configurado.' }, { status: 503 });
    return organizationApiFailure(error);
  }
}
