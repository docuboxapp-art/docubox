import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashCapabilityToken } from '@/lib/security/capability-token';
import { PublicCodeError, verifyPublicCode } from './public-code-access';

const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function claimPublicForm(request: NextRequest, expectedFormId?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return reply('Servicio no disponible.', 503);
  const service = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const body = await request.json().catch(() => ({}));
  let accessIdentity;
  try {
    accessIdentity = await verifyPublicCode(service, request, { ...body, formId: expectedFormId || body.formId });
  } catch (error) {
    return reply(error instanceof PublicCodeError ? error.message : 'No se pudo comprobar el acceso.',
      error instanceof PublicCodeError ? error.status : 503);
  }
  if (!accessIdentity.userId) return reply('Completa el alta express para continuar.', 409);
  const user = { id: accessIdentity.userId, email: accessIdentity.email };
  const mobileSessionToken = String(body.mobileSessionToken || '').trim();
  const enrollmentToken = String(body.enrollmentToken || '').trim();
  const hasMobileProof = /^[a-f0-9]{64}$/i.test(mobileSessionToken);
  const hasEnrollmentProof = /^[a-f0-9]{64}$/i.test(enrollmentToken);
  if (!hasMobileProof && !hasEnrollmentProof)
    return reply('Completa la prueba de vida desde el móvil.', 400);
  const { data: form, error: formError } = await service
    .from('form_templates')
    .select('id,name,status,settings,allowed_signature_types')
    .eq('id', accessIdentity.formId)
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

  let verifiedAt: string;
  let reference: string | null;
  if (hasEnrollmentProof) {
    // A just-completed biometric enrollment already includes ID matching and
    // liveness, so the new account need not repeat the same capture.
    const { data: enrollmentAccess, error: tokenError } = await service
      .from('enrollment_tokens')
      .select('id,status,document_metadata')
      .eq('token_hash', hashCapabilityToken(enrollmentToken))
      .maybeSingle();
    if (tokenError) return reply('No se pudo comprobar el enrolamiento.', 503);
    if (!enrollmentAccess || enrollmentAccess.status !== 'completed')
      return reply('El enrolamiento no está completo.', 422);
    const { data: enrollment, error: enrollmentError } = await service
      .from('enrollment_results')
      .select('id,face_match_passed,created_at')
      .eq('enrollment_token_id', enrollmentAccess.id)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .maybeSingle();
    if (enrollmentError) return reply('No se pudo comprobar la prueba de vida.', 503);
    const captured = Date.parse(enrollment?.created_at || '');
    if (!enrollment || enrollment.face_match_passed !== true ||
      !Number.isFinite(captured) || captured > Date.now() ||
      Date.now() - captured > 60 * 60_000)
      return reply('El enrolamiento no fue aprobado o ya expiró. Repítelo.', 422);
    verifiedAt = enrollment.created_at;
    const metadata = enrollmentAccess.document_metadata as Record<string, unknown> | null;
    reference = String(metadata?.provider_reference || '').slice(0, 200) || null;
  } else {
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
      mobileMetadata.recipient_email !== user.email ||
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
    verifiedAt = String(mobileMetadata.captured_at || new Date().toISOString());
    reference = String(providerAudit.provider_reference || '').slice(0, 200) || null;
  }
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
      ? new Date(Date.now() + Math.min(configured, 24) * 3_600_000).toISOString()
      : new Date(Date.now() + 24 * 3_600_000).toISOString();
  const token = randomBytes(32).toString('hex');
  const { error: insertError } = await service.from('form_tokens').insert({
    template_id: form.id,
    access_mode: 'public',
    recipient_user_id: user.id,
    recipient_email: user.email.trim().toLowerCase(),
    recipient_name: invitee?.recipient_name || accessIdentity.name || user.email,
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
