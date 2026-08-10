import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import {
  captureEncryptionKey,
  decryptCapture,
  encryptCapture,
  normalizeImageBase64,
  validImageBase64,
} from '@/lib/identity/capture-crypto';

async function storedDocumentFront(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  key: Buffer,
) {
  const { data: capture } = await supabase
    .from('id_capture_logs')
    .select('anverso_b64')
    .eq('user_id', userId)
    .not('anverso_b64', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (capture?.anverso_b64) {
    try { return decryptCapture(capture.anverso_b64, key); } catch { /* legacy row */ }
  }

  const { data: result } = await supabase
    .from('enrollment_results')
    .select('enrollment_token_id')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!result?.enrollment_token_id) return null;
  const { data: enrollment } = await supabase
    .from('enrollment_tokens')
    .select('anverso_encrypted')
    .eq('id', result.enrollment_token_id)
    .maybeSingle();
  if (!enrollment?.anverso_encrypted) return null;
  try { return decryptCapture(enrollment.anverso_encrypted, key); } catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token || '');
    const selfie = normalizeImageBase64(body.selfieData);
    let front = normalizeImageBase64(body.anversoData);
    let back = normalizeImageBase64(body.reversoData);
    const video = normalizeImageBase64(body.selfieVideo);
    if (!/^[a-f0-9]{64}$/i.test(token) || !validImageBase64(selfie)) {
      return NextResponse.json({ error: 'La sesion o la selfie no son validas.' }, { status: 400 });
    }

    const key = captureEncryptionKey();
    if (!key) return NextResponse.json({ error: 'El cifrado biometrico no esta configurado.' }, { status: 503 });
    const providerUrl = process.env.IDENTITY_VERIFICATION_GATEWAY_URL;
    const providerToken = process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN;
    if (!providerUrl || !providerToken) {
      return NextResponse.json({
        error: 'El proveedor de identidad y prueba de vida no esta configurado.',
        code: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
      }, { status: 503 });
    }

    const supabase = createServiceClient();
    const { data: session } = await supabase
      .from('mobile_upload_sessions')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!session?.user_id || !session.metadata?.document_id) {
      return NextResponse.json({ error: 'Sesion invalida o expirada.' }, { status: 404 });
    }

    if (!validImageBase64(front)) {
      front = await storedDocumentFront(supabase, session.user_id, key) || '';
    }
    if (!validImageBase64(back)) back = front;
    if (!validImageBase64(front) || !validImageBase64(back)) {
      return NextResponse.json({ error: 'Se requiere una identificacion valida.' }, { status: 400 });
    }

    const providerResponse = await fetch(providerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({
        operation: 'VERIFY_IDENTITY_AND_LIVENESS',
        correlation_id: randomUUID(),
        document_front_base64: front,
        document_back_base64: back,
        selfie_base64: selfie,
        ...(validImageBase64(video) ? { liveness_video_base64: video } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const provider = await providerResponse.json().catch(() => ({})) as Record<string, any>;
    if (!providerResponse.ok) {
      return NextResponse.json({ error: 'No fue posible validar la identidad.' }, { status: 502 });
    }

    const documentValidation = provider.document_validation || {};
    const faceValidation = provider.face_validation || {};
    const liveness = provider.liveness || {};
    const faceScore = Number(faceValidation.score || 0);
    const threshold = Number(process.env.IDENTITY_FACE_MATCH_THRESHOLD || 80);
    const fields = provider.document_fields || {};
    const providerCurp = String(fields.curp || '').trim().toUpperCase() || null;
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('curp,full_name')
      .eq('id', session.user_id)
      .maybeSingle();
    const profileCurp = String(profile?.curp || '').trim().toUpperCase() || null;
    const curpMatch = providerCurp && profileCurp ? providerCurp === profileCurp : null;
    const identityMatch = provider.status === 'VALID'
      && documentValidation.valid === true
      && faceValidation.match === true
      && faceScore >= threshold
      && liveness.passed === true
      && curpMatch !== false;
    const providerAudit = {
      provider: provider.provider || 'CONFIGURED_GATEWAY',
      provider_reference: provider.verification_id || null,
      verified_at: provider.verified_at || new Date().toISOString(),
      document_valid: documentValidation.valid === true,
      face_match: faceValidation.match === true,
      face_score: faceScore,
      liveness_passed: liveness.passed === true,
      liveness_method: liveness.method || null,
    };

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip') || null;
    const { data: captureLog, error: captureError } = await supabase
      .from('id_capture_logs')
      .insert({
        session_token: token,
        user_id: session.user_id,
        document_id: session.metadata.document_id,
        has_enrollment: session.metadata.has_enrollment === true,
        nubarium_similitud: faceScore,
        nubarium_aprobado: identityMatch,
        identity_match: identityMatch,
        identity_mismatch_reason: identityMatch ? null : 'IDENTITY_OR_LIVENESS_VALIDATION_FAILED',
        raw_nubarium_response: providerAudit,
        ip_address: ipAddress,
        user_agent: request.headers.get('user-agent') || null,
        anverso_b64: encryptCapture(front, key),
        reverso_b64: encryptCapture(back, key),
        selfie_b64: encryptCapture(selfie, key),
        selfie_video_b64: validImageBase64(video) ? encryptCapture(video, key) : null,
        curp_extracted: providerCurp,
        nombre_extracted: fields.nombre_completo || fields.nombre || null,
        curp_match: curpMatch,
        curp_profile: profileCurp,
        document_id_ref: session.metadata.document_id,
        encryption_version: 'AES-256-GCM-V1',
      })
      .select('id')
      .single();
    if (captureError || !captureLog) {
      return NextResponse.json({ error: 'No fue posible registrar la evidencia biometrica.' }, { status: 500 });
    }

    const nextStatus = identityMatch ? 'completed' : 'identity_failed';
    const resultMetadata = {
      ...(session.metadata || {}),
      mode: 'id_capture',
      captured_at: new Date().toISOString(),
      provider: providerAudit,
      nubarium_similitud: faceScore,
      nubarium_aprobado: identityMatch,
      identity_match: identityMatch,
      curp_match: curpMatch,
      curp_extracted: providerCurp,
      capture_log_id: captureLog.id,
      user_profile_compared: { curp: profileCurp, nombre: profile?.full_name || null },
    };
    const { data: updatedSession, error: sessionError } = await supabase
      .from('mobile_upload_sessions')
      .update({
        status: nextStatus,
        file_data: encryptCapture(selfie, key),
        file_name: 'identity-capture.enc',
        file_type: 'application/vnd.docubox.encrypted-capture+json',
        metadata: resultMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (sessionError || !updatedSession) {
      return NextResponse.json({ error: 'La sesion ya fue procesada o no pudo cerrarse.' }, { status: 409 });
    }

    await supabase.rpc('append_legal_evidence_event', {
      p_document_id: session.metadata.document_id,
      p_event_type: 'IDENTITY_LIVENESS_VERIFIED',
      p_event_category: 'IDENTITY',
      p_event_result: identityMatch ? 'SUCCESS' : 'FAILED',
      p_actor_id: session.user_id,
      p_actor_type: 'PARTICIPANT',
      p_payload: providerAudit,
      p_idempotency_key: `identity-capture:${captureLog.id}`,
    });

    return NextResponse.json({
      success: identityMatch,
      identity_match: identityMatch,
      nubarium_similitud: faceScore,
      nubarium_aprobado: identityMatch,
      curp_match: curpMatch,
      curp_extracted: providerCurp,
      capture_log_id: captureLog.id,
    }, { status: identityMatch ? 200 : 422 });
  } catch (error) {
    console.error('[submit-id-capture] Failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No fue posible procesar la prueba de vida.' }, { status: 500 });
  }
}
