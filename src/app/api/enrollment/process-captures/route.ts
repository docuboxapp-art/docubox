import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { captureEncryptionKey, encryptCapture, normalizeImageBase64, validImageBase64 } from '@/lib/identity/capture-crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token || '');
    const tipoId = String(body.tipoId || '');
    const anversoData = normalizeImageBase64(body.anversoCapture);
    const reversoData = normalizeImageBase64(body.reversoCapture);
    const selfieData = normalizeImageBase64(body.selfieCapture);
    if (!token || !tipoId || !validImageBase64(anversoData) || !validImageBase64(reversoData) || !validImageBase64(selfieData)) {
      return NextResponse.json({ error: 'Las capturas requeridas no son validas.' }, { status: 400 });
    }

    const key = captureEncryptionKey();
    if (!key) {
      return NextResponse.json({ error: 'El cifrado de enrolamiento no esta configurado.' }, { status: 503 });
    }
    const providerUrl = process.env.IDENTITY_VERIFICATION_GATEWAY_URL;
    const providerToken = process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN;
    if (!providerUrl || !providerToken) {
      return NextResponse.json({
        error: 'El proveedor de verificacion de identidad no esta configurado.',
        code: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
      }, { status: 503 });
    }

    const supabase = createServiceClient();
    const { data: tokenData, error: tokenError } = await supabase
      .from('enrollment_tokens')
      .select('id,status,expires_at,session_id,user_id')
      .eq('token', token)
      .maybeSingle();
    if (tokenError || !tokenData) return NextResponse.json({ error: 'Token no encontrado.' }, { status: 404 });
    if (new Date(tokenData.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Token expirado.', expired: true }, { status: 410 });
    }
    if (tokenData.status === 'completed') {
      return NextResponse.json({ error: 'El token ya fue utilizado.' }, { status: 409 });
    }

    const correlationId = crypto.randomUUID();
    const providerResponse = await fetch(providerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({
        operation: 'VERIFY_IDENTITY_AND_LIVENESS',
        correlation_id: correlationId,
        document_type: tipoId,
        document_front_base64: anversoData,
        document_back_base64: reversoData,
        selfie_base64: selfieData,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const provider = await providerResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!providerResponse.ok) {
      return NextResponse.json({ error: 'El proveedor no pudo procesar las capturas.' }, { status: 502 });
    }

    const documentValidation = (provider.document_validation || {}) as Record<string, unknown>;
    const faceValidation = (provider.face_validation || {}) as Record<string, unknown>;
    const liveness = (provider.liveness || {}) as Record<string, unknown>;
    const faceMatchScore = Number(faceValidation.score || 0);
    const validated = provider.status === 'VALID'
      && documentValidation.valid === true
      && faceValidation.match === true
      && faceMatchScore >= Number(process.env.IDENTITY_FACE_MATCH_THRESHOLD || 80)
      && liveness.passed === true;
    const documentMetadata = {
      tipo_documento: tipoId,
      provider: String(provider.provider || 'CONFIGURED_GATEWAY'),
      provider_reference: String(provider.verification_id || ''),
      correlation_id: correlationId,
      document_validation: documentValidation,
      document_fields: provider.document_fields || {},
      face_validation: { score: faceMatchScore, match: faceValidation.match === true },
      liveness: { passed: liveness.passed === true, method: liveness.method || null },
      verified_at: String(provider.verified_at || new Date().toISOString()),
    };

    const encryptedFaceTemplate = provider.face_template_base64
      ? encryptCapture(String(provider.face_template_base64), key)
      : null;
    const { error: updateError } = await supabase.from('enrollment_tokens').update({
      anverso_encrypted: encryptCapture(anversoData, key),
      reverso_encrypted: encryptCapture(reversoData, key),
      selfie_encrypted: encryptCapture(selfieData, key),
      face_encoding_encrypted: encryptedFaceTemplate,
      encryption_iv: null,
      encryption_version: 'AES-256-GCM-V1',
      face_match_score: faceMatchScore,
      document_metadata: documentMetadata,
      processing_status: validated ? 'validated' : 'verification_failed',
      processing_error: validated ? null : 'IDENTITY_OR_LIVENESS_VALIDATION_FAILED',
    }).eq('id', tokenData.id);
    if (updateError) {
      console.error('[process-captures] Encrypted write failed:', updateError.code);
      return NextResponse.json({ error: 'No fue posible conservar las capturas cifradas.' }, { status: 500 });
    }

    return NextResponse.json({
      success: validated,
      faceMatchPassed: validated,
      faceMatchScore,
      processingStatus: validated ? 'validated' : 'verification_failed',
    }, { status: validated ? 200 : 422 });
  } catch (error) {
    console.error('[process-captures] Failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No fue posible procesar las capturas.' }, { status: 500 });
  }
}
