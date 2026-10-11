import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isValidPublicCode,
  matchesStoredPublicCode,
  normalizePublicCode,
  publicCodeLookup,
} from './public-access-code';
import { hashCapabilityToken } from '@/lib/security/capability-token';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function claimPublicForm(request: NextRequest, expectedFormId?: string) {
  const jwt = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!jwt) return reply('Inicia sesión para responder.', 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return reply('Servicio no disponible.', 503);
  const service = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await service.auth.getUser(jwt);
  if (authError || !user || user.is_anonymous || !user.email || !user.email_confirmed_at)
    return reply('Necesitas una cuenta con correo verificado.', 401);

  const body = await request.json().catch(() => ({}));
  const code = normalizePublicCode(body.code);
  const mobileSessionToken = String(body.mobileSessionToken || '').trim();
  if (!isValidPublicCode(code)) return reply('Ingresa un código de acceso válido.', 400);
  if (!/^[a-f0-9]{64}$/i.test(mobileSessionToken))
    return reply('Completa la prueba de vida desde el móvil.', 400);
  const lookup = publicCodeLookup(code);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipHash = createHash('sha256').update(ip).digest('hex');
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: limitError } = await service
    .from('form_public_code_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('succeeded', false)
    .gte('created_at', since);
  if (limitError) return reply('No se pudo comprobar el límite de intentos.', 503);
  if ((count || 0) >= 5) return reply('Demasiados intentos. Espera 15 minutos.', 429);

  const { data: access, error: accessError } = await service
    .from('form_public_access_codes')
    .select('form_id,code_lookup,code_hash,legacy_code_lookup,legacy_code_hash')
    .or(`code_lookup.eq.${lookup},legacy_code_lookup.eq.${lookup}`)
    .maybeSingle();
  if (accessError) return reply('No se pudo comprobar el código.', 503);
  const valid = Boolean(
    access &&
    matchesStoredPublicCode(code, access) &&
    (!expectedFormId || access.form_id === expectedFormId)
  );
  const { error: attemptError } = await service.from('form_public_code_attempts').insert({
    code_lookup: lookup,
    user_id: user.id,
    ip_hash: ipHash,
    succeeded: valid,
  });
  if (attemptError) return reply('No se pudo registrar el intento de acceso.', 503);
  if (!valid || !access) return reply('El código de acceso no es válido.', 403);

  const { data: form, error: formError } = await service
    .from('form_templates')
    .select('id,name,status,settings,allowed_signature_types')
    .eq('id', access.form_id)
    .maybeSingle();
  if (formError) return reply('No se pudo consultar el formulario.', 503);
  if (!form || form.status !== 'published')
    return reply('Este formulario público no está disponible.', 404);
  const allowedTypes =
    Array.isArray(form.allowed_signature_types) && form.allowed_signature_types.length
      ? form.allowed_signature_types
      : form.settings?.allowedSignatureTypes;
  if (
    Array.isArray(allowedTypes) &&
    allowedTypes.length &&
    !allowedTypes.includes('autografa_digital')
  )
    return reply('La firma autógrafa no está habilitada para este formulario.', 409);

  const { data: invitee, error: inviteeError } = await service
    .from('form_public_invitees')
    .select('recipient_name,launch_prefill')
    .eq('form_id', form.id)
    .eq('recipient_email', user.email.trim().toLowerCase())
    .maybeSingle();
  if (inviteeError) return reply('No se pudieron consultar los datos de la invitación.', 503);

  const { data: prior, error: priorError } = await service
    .from('form_tokens')
    .select('token,used_at,expires_at,liveness_verified_at')
    .eq('template_id', form.id)
    .eq('access_mode', 'public')
    .eq('recipient_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priorError) return reply('No se pudo comprobar el acceso previo.', 503);
  if (prior?.used_at) return reply('Ya respondiste este formulario.', 409);

  const sessionHash = hashCapabilityToken(mobileSessionToken);
  const { data: mobileSession, error: mobileError } = await service
    .from('mobile_upload_sessions')
    .select('id,user_id,status,expires_at,metadata')
    .eq('token_hash', sessionHash)
    .eq('user_id', user.id)
    .maybeSingle();
  if (mobileError) return reply('No se pudo comprobar la prueba de vida.', 503);
  const mobileMetadata = mobileSession?.metadata as Record<string, unknown> | undefined;
  const captureLogId = String(mobileMetadata?.capture_log_id || '');
  const providerAudit = mobileMetadata?.provider as Record<string, unknown> | undefined;
  if (
    mobileSession?.status !== 'completed' ||
    new Date(mobileSession.expires_at).getTime() <= Date.now() ||
    mobileMetadata?.mode !== 'public_form_liveness' ||
    mobileMetadata.form_id !== form.id ||
    mobileMetadata.identity_match !== true ||
    providerAudit?.liveness_passed !== true ||
    !captureLogId
  )
    return reply('La prueba de vida móvil no está aprobada o expiró. Repítela.', 422);
  const { data: captureLog, error: captureError } = await service
    .from('id_capture_logs')
    .select('id,nubarium_aprobado')
    .eq('id', captureLogId)
    .eq('session_token', sessionHash)
    .eq('user_id', user.id)
    .maybeSingle();
  if (captureError || captureLog?.nubarium_aprobado !== true)
    return reply('No se pudo comprobar la evidencia de identidad.', 422);
  const verifiedAt = String(mobileMetadata.captured_at || new Date().toISOString());
  const reference = String(providerAudit.provider_reference || '').slice(0, 200) || null;
  if (prior && (!prior.expires_at || new Date(prior.expires_at).getTime() > Date.now())) {
    const { error } = await service
      .from('form_tokens')
      .update({
        liveness_verified_at: verifiedAt,
        liveness_reference: reference,
        launch_prefill: invitee?.launch_prefill || {},
        ...(invitee?.recipient_name ? { recipient_name: invitee.recipient_name } : {}),
      })
      .eq('token', prior.token)
      .eq('recipient_user_id', user.id)
      .eq('access_mode', 'public');
    if (error) return reply('No se pudo guardar la prueba de vida.', 503);
    return NextResponse.json({ url: `/form/${prior.token}` }, { headers });
  }

  const configured = Number(form.settings?.expirationHours);
  const expiresAt =
    form.settings?.configureLinkExpiration === true &&
    Number.isFinite(configured) &&
    configured >= 1 / 60 &&
    configured <= 720
      ? new Date(Date.now() + configured * 3_600_000).toISOString()
      : null;
  const token = randomBytes(32).toString('hex');
  const { error: insertError } = await service.from('form_tokens').insert({
    template_id: form.id,
    access_mode: 'public',
    recipient_user_id: user.id,
    recipient_email: user.email.trim().toLowerCase(),
    recipient_name: invitee?.recipient_name || String(user.user_metadata?.full_name || user.email),
    launch_prefill: invitee?.launch_prefill || {},
    signer_role: 'Participante',
    signature_type: 'autografa_digital',
    require_liveness: false,
    liveness_verified_at: verifiedAt,
    liveness_reference: reference,
    token,
    expires_at: expiresAt,
  });
  if (insertError) return reply('No se pudo abrir el formulario.', 503);
  return NextResponse.json({ url: `/form/${token}` }, { headers });
}
