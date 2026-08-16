import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Resend } from 'resend';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { hasCurrentCollaborationEntitlement } from '@/lib/collaboration/entitlements-server';

export const runtime = 'nodejs';

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request_otp') }),
  z.object({ action: z.literal('verify_otp'), challenge_id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal('accept_terms'), session_token: z.string().min(32) }),
]);

function sha(value: string) { return createHash('sha256').update(value).digest('hex'); }
function otpHash(token: string, code: string) {
  const pepper = process.env.SIGNATURE_OTP_PEPPER || process.env.DOCUBOX_INTERNAL_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!pepper) throw new Error('otp_service_unavailable');
  return sha(`${token}:${code}:${pepper}`);
}
function clientIp(request: Request) { return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null; }

async function guestFromToken(service: ReturnType<typeof createServiceClient>, token: string) {
  const result = await service.from('collaboration_room_guests')
    .select('*,room:collaboration_rooms(*)')
    .eq('token_hash', sha(token)).maybeSingle();
  if (result.error) throw result.error;
  const guest = result.data;
  const room = guest?.room as Record<string, unknown> | null;
  const now = Date.now();
  if (!guest || !room || guest.revoked_at || !['pending','active'].includes(guest.status)
    || new Date(guest.token_expires_at).getTime() <= now || room.status !== 'active'
    || (room.expires_at && new Date(String(room.expires_at)).getTime() <= now)) return null;
  if (!await hasCurrentCollaborationEntitlement(
    service,
    guest.workspace_id,
    'collaboration_external_rooms',
    true
  )) return null;
  return { guest, room };
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const service = createServiceClient();
    const access = await guestFromToken(service, token);
    if (!access) return Response.json({ error: 'El acceso vencio o fue revocado.' }, { status: 410 });
    const room = access.room;
    const response: Record<string, unknown> = { room: { name: room.name, purpose: room.purpose, expires_at: room.expires_at, terms_required: room.terms_required, downloads_allowed: room.downloads_allowed, watermark_enabled: room.watermark_enabled }, guest: { name: access.guest.name, email: access.guest.email, terms_accepted: Boolean(access.guest.nda_accepted_at) }, authenticated: false };
    const sessionToken = request.headers.get('x-colabora-session') || '';
    if (sessionToken) {
      const session = await service.from('collaboration_external_sessions').select('*').eq('guest_id', access.guest.id).eq('session_token_hash', sha(sessionToken)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (!session.error && session.data && session.data.otp_consumed_at) {
        const resources = await service.from('collaboration_room_resources').select('id,resource_type,resource_id,display_name,permissions,created_at').eq('room_id', room.id).order('created_at');
        if (resources.error) throw resources.error;
        await Promise.all([
          service.from('collaboration_external_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.data.id),
          service.from('collaboration_external_events').insert({ workspace_id: access.guest.workspace_id, room_id: room.id, guest_id: access.guest.id, session_id: session.data.id, event_type: 'room.viewed', ip_address: clientIp(request), user_agent: request.headers.get('user-agent') }),
        ]);
        response.authenticated = true;
        response.resources = resources.data || [];
      }
    }
    return Response.json(response, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    return Response.json({ error: 'No se pudo validar el acceso.' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const input = inputSchema.parse(await request.json());
    const service = createServiceClient();
    const access = await guestFromToken(service, token);
    if (!access) return Response.json({ error: 'El acceso vencio o fue revocado.' }, { status: 410 });
    if (input.action === 'accept_terms') {
      const session = await service.from('collaboration_external_sessions')
        .select('id')
        .eq('guest_id', access.guest.id)
        .eq('session_token_hash', sha(input.session_token))
        .is('revoked_at', null)
        .not('otp_consumed_at', 'is', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (session.error) throw session.error;
      if (!session.data) return Response.json({ error: 'La sesion vencio.' }, { status: 401 });
      const acceptedAt = new Date().toISOString();
      const accepted = await service.from('collaboration_room_guests')
        .update({ nda_accepted_at: acceptedAt })
        .eq('id', access.guest.id);
      if (accepted.error) throw accepted.error;
      await service.from('collaboration_external_events').insert({
        workspace_id: access.guest.workspace_id,
        room_id: access.room.id,
        guest_id: access.guest.id,
        session_id: session.data.id,
        event_type: 'room.terms_accepted',
        ip_address: clientIp(request),
        user_agent: request.headers.get('user-agent'),
      });
      return Response.json({ accepted_at: acceptedAt });
    }
    if (input.action === 'request_otp') {
      const key = process.env.RESEND_API_KEY;
      if (!key) return Response.json({ error: 'El servicio de correo no esta configurado.' }, { status: 503 });
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const pendingHash = sha(randomBytes(32).toString('base64url'));
      const challenge = await service.from('collaboration_external_sessions').insert({ workspace_id: access.guest.workspace_id, room_id: access.room.id, guest_id: access.guest.id, session_token_hash: pendingHash, otp_hash: otpHash(token, code), otp_expires_at: expiresAt, expires_at: expiresAt, ip_address: clientIp(request), user_agent: request.headers.get('user-agent') }).select('id').single();
      if (challenge.error) throw challenge.error;
      const resend = new Resend(key);
      const sent = await resend.emails.send({ from: process.env.RESEND_FROM_EMAIL || 'Docubox <noreply@docubox.mx>', to: access.guest.email, subject: `Codigo de acceso a ${access.room.name}`, html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b"><h2>Acceso seguro a Docubox Colabora</h2><p>Hola, ${access.guest.name}. Usa este codigo para entrar a <strong>${access.room.name}</strong>.</p><div style="margin:24px 0;padding:20px;text-align:center;background:#f5f7ff;border:1px solid #dbe3ff;border-radius:8px;font-size:34px;font-weight:700;letter-spacing:9px;color:#1E6BFF">${code}</div><p style="font-size:12px;color:#71717a">El codigo vence en 10 minutos. No lo compartas.</p></div>` });
      if (sent.error) { await service.from('collaboration_external_sessions').delete().eq('id', challenge.data.id); throw sent.error; }
      return Response.json({ challenge_id: challenge.data.id, expires_at: expiresAt });
    }
    const challenge = await service.from('collaboration_external_sessions').select('*').eq('id', input.challenge_id).eq('guest_id', access.guest.id).is('otp_consumed_at', null).is('revoked_at', null).maybeSingle();
    if (challenge.error) throw challenge.error;
    if (!challenge.data || !challenge.data.otp_hash || !challenge.data.otp_expires_at || new Date(challenge.data.otp_expires_at).getTime() <= Date.now()) return Response.json({ error: 'El codigo expiro. Solicita uno nuevo.' }, { status: 400 });
    if (challenge.data.failed_attempts >= Number(access.room.max_failed_attempts || 5)) return Response.json({ error: 'Se alcanzo el limite de intentos.' }, { status: 429 });
    const expected = Buffer.from(challenge.data.otp_hash, 'hex');
    const received = Buffer.from(otpHash(token, input.code), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await service.from('collaboration_external_sessions').update({ failed_attempts: challenge.data.failed_attempts + 1 }).eq('id', challenge.data.id);
      return Response.json({ error: 'El codigo no es valido.' }, { status: 400 });
    }
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + Number(access.room.session_minutes || 30) * 60 * 1000).toISOString();
    const updated = await service.from('collaboration_external_sessions').update({ session_token_hash: sha(sessionToken), otp_consumed_at: new Date().toISOString(), expires_at: expiresAt, last_seen_at: new Date().toISOString() }).eq('id', challenge.data.id);
    if (updated.error) throw updated.error;
    await service.from('collaboration_room_guests').update({ status: 'active', last_access_at: new Date().toISOString() }).eq('id', access.guest.id);
    return Response.json({ session_token: sessionToken, expires_at: expiresAt });
  } catch (error) {
    const message = error instanceof z.ZodError ? 'Solicitud invalida.' : error instanceof Error && error.message === 'otp_service_unavailable' ? 'El servicio OTP no esta configurado.' : 'No se pudo completar el acceso.';
    return Response.json({ error: message }, { status: 500 });
  }
}
