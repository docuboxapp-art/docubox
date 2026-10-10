import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { matchesPublicCode, normalizePublicCode, publicCodeLookup } from './public-access-code';
import {
  captureEncryptionKey,
  decryptCapture,
  normalizeImageBase64,
  validImageBase64,
} from '@/lib/identity/capture-crypto';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

async function storedIdentityFront(service: SupabaseClient, userId: string) {
  const key = captureEncryptionKey();
  if (!key) return null;
  const { data: capture } = await service
    .from('id_capture_logs')
    .select('anverso_b64')
    .eq('user_id', userId)
    .not('anverso_b64', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (capture?.anverso_b64) {
    try {
      return decryptCapture(capture.anverso_b64, key);
    } catch {
      /* Try enrollment. */
    }
  }
  const { data: enrollment } = await service
    .from('enrollment_results')
    .select('enrollment_token_id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!enrollment?.enrollment_token_id) return null;
  const { data: token } = await service
    .from('enrollment_tokens')
    .select('anverso_encrypted')
    .eq('id', enrollment.enrollment_token_id)
    .maybeSingle();
  if (!token?.anverso_encrypted) return null;
  try {
    return decryptCapture(token.anverso_encrypted, key);
  } catch {
    return null;
  }
}

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
  const selfie = normalizeImageBase64(body.selfie);
  if (!/^DBX[0-9A-F]{18}$/.test(code)) return reply('Ingresa un código de acceso válido.', 400);
  if (!validImageBase64(selfie)) return reply('Captura una selfie para la prueba de vida.', 400);
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
    .select('form_id,code_hash')
    .eq('code_lookup', lookup)
    .maybeSingle();
  if (accessError) return reply('No se pudo comprobar el código.', 503);
  const valid = Boolean(
    access &&
    matchesPublicCode(code, access.code_hash) &&
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

  const gatewayUrl = process.env.IDENTITY_VERIFICATION_GATEWAY_URL;
  const gatewayToken = process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN;
  if (!gatewayUrl || !gatewayToken)
    return reply('La prueba de vida no está disponible en este momento.', 503);
  const identityFront = await storedIdentityFront(service, user.id);
  let verification: Record<string, unknown>;
  try {
    const provider = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gatewayToken}` },
      body: JSON.stringify({
        operation: identityFront ? 'VERIFY_IDENTITY_AND_LIVENESS' : 'VERIFY_LIVENESS',
        correlation_id: randomUUID(),
        selfie_base64: selfie,
        ...(identityFront
          ? { document_front_base64: identityFront, document_back_base64: identityFront }
          : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    verification = provider.ok ? await provider.json() : {};
  } catch {
    return reply('No se pudo verificar la prueba de vida. Inténtalo de nuevo.', 502);
  }
  const liveness = verification.liveness as { passed?: boolean } | undefined;
  const documentValidation = verification.document_validation as { valid?: boolean } | undefined;
  const faceValidation = verification.face_validation as
    { match?: boolean; score?: number } | undefined;
  const matchedIdentity =
    !identityFront ||
    (documentValidation?.valid === true &&
      faceValidation?.match === true &&
      Number(faceValidation.score || 0) >= Number(process.env.IDENTITY_FACE_MATCH_THRESHOLD || 80));
  if (verification.status !== 'VALID' || liveness?.passed !== true || !matchedIdentity)
    return reply('La prueba de vida no fue aprobada. Repite la captura.', 422);
  const verifiedAt = new Date().toISOString();
  const reference = String(verification.verification_id || '').slice(0, 200) || null;
  if (prior && (!prior.expires_at || new Date(prior.expires_at).getTime() > Date.now())) {
    const { error } = await service
      .from('form_tokens')
      .update({ liveness_verified_at: verifiedAt, liveness_reference: reference,
        launch_prefill: invitee?.launch_prefill || {},
        ...(invitee?.recipient_name ? { recipient_name: invitee.recipient_name } : {}) })
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
