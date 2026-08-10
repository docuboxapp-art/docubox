import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('DOCUBOX_ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanBase64(value: unknown) {
  return String(value || '').replace(/^data:[^,]+,/, '').replace(/\s/g, '');
}

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

function authorizedParticipant(document: Record<string, unknown>, userId: string, email: string) {
  if (document.owner_id === userId) return true;
  const normalizedEmail = email.trim().toLowerCase();
  return Array.isArray(document.participantes) && document.participantes.some((participant: Record<string, unknown>) =>
    participant.id === userId || String(participant.email || '').trim().toLowerCase() === normalizedEmail
  );
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } },
    );
    const authorization = request.headers.get('authorization') || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const { data: { user }, error: authError } = await supabase.auth.getUser(bearer);
    if (authError || !user?.email) return json({ error: 'No autorizado' }, 401);

    const body = await request.json();
    const documentId = String(body.document_id || '');
    const cerBase64 = cleanBase64(body.cer_b64);
    const keyBase64 = cleanBase64(body.key_b64);
    const password = String(body.password || '');
    if (!documentId || !cerBase64 || !keyBase64 || !password) {
      return json({ error: 'Se requieren document_id, cer_b64, key_b64 y password' }, 400);
    }
    if (cerBase64.length > 400_000 || keyBase64.length > 400_000) {
      return json({ error: 'Los archivos de e.firma exceden el limite permitido' }, 413);
    }

    const { data: document, error: documentError } = await supabase
      .from('documentos')
      .select('id,documento_id,nombre,owner_id,workspace_id,file_hash_sha256,participantes')
      .eq('id', documentId)
      .maybeSingle();
    if (documentError || !document) return json({ error: 'Documento no encontrado' }, 404);

    let authorized = authorizedParticipant(document, user.id, user.email);
    if (!authorized) {
      const { data: participation } = await supabase
        .from('participation_responses')
        .select('id')
        .eq('documento_id', documentId)
        .ilike('participante_email', user.email.trim().toLowerCase())
        .limit(1)
        .maybeSingle();
      authorized = Boolean(participation);
    }
    if (!authorized) return json({ error: 'No tienes acceso a este documento' }, 403);

    const documentSha256 = String(document.file_hash_sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(documentSha256)) {
      return json({ error: 'El documento no cuenta con una huella SHA-256 verificable' }, 422);
    }

    const gatewayUrl = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_URL');
    const gatewayToken = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_TOKEN');
    if (!gatewayUrl || !gatewayToken) {
      return json({ error: 'El proveedor seguro de e.firma no esta configurado.', code: 'EFIRMA_PROVIDER_NOT_CONFIGURED' }, 503);
    }

    const evidenceId = crypto.randomUUID();
    const signedAt = new Date().toISOString();
    const signedPayload = JSON.stringify({
      schema: 'DOCUBOX_EFIRMA_ACT',
      version: '1.0',
      evidence_id: evidenceId,
      document_id: documentId,
      document_folio: document.documento_id,
      document_sha256: documentSha256,
      signer_id: user.id,
      signer_email_sha256: await sha256Hex(user.email.trim().toLowerCase()),
      signed_at: signedAt,
    });
    const signedPayloadSha256 = await sha256Hex(signedPayload);

    const providerResponse = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gatewayToken}` },
      body: JSON.stringify({
        operation: 'SIGN_EFIRMA',
        certificate_der_base64: cerBase64,
        encrypted_private_key_base64: keyBase64,
        private_key_password: password,
        payload_utf8_base64: btoa(signedPayload),
        payload_sha256: signedPayloadSha256,
        correlation_id: evidenceId,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const provider = await providerResponse.json().catch(() => ({})) as Record<string, unknown>;
    const certificate = (provider.certificate || {}) as Record<string, unknown>;
    const signatureBase64 = String(provider.signature_base64 || '');
    const revocationStatus = String(provider.revocation_status || certificate.revocation_status || '').toUpperCase();
    if (
      !providerResponse.ok
      || provider.status !== 'VALID'
      || provider.signature_verified !== true
      || provider.key_pair_valid !== true
      || provider.certificate_chain_valid !== true
      || revocationStatus !== 'GOOD'
      || provider.payload_sha256 !== signedPayloadSha256
      || !signatureBase64
    ) {
      return json({ error: 'La firma no supero la validacion criptografica del proveedor.', code: 'EFIRMA_SIGNING_FAILED' }, 422);
    }

    const signatureBytes = Uint8Array.from(atob(signatureBase64), (character) => character.charCodeAt(0));
    const signatureSha256 = await sha256Hex(signatureBytes);
    const sealPath = `${documentId}/efirma/${evidenceId}.sig`;
    const { error: uploadError } = await supabase.storage.from('evidence').upload(sealPath, signatureBytes, {
      contentType: 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) return json({ error: 'No fue posible conservar el sello de firma.' }, 500);

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const { error: evidenceError } = await supabase.from('signature_evidence').insert({
      id: evidenceId,
      document_id: documentId,
      evidence_type: 'efirma_sat',
      cert_serial_number: String(certificate.serial_number || ''),
      cert_subject: String(certificate.subject || ''),
      cert_rfc: String(certificate.rfc || '').toUpperCase() || null,
      cert_curp: String(certificate.curp || '').toUpperCase() || null,
      cert_not_before: String(certificate.not_before || '') || null,
      cert_not_after: String(certificate.not_after || '') || null,
      cert_issuer: String(certificate.issuer || ''),
      cert_fingerprint_sha256: String(certificate.fingerprint_sha256 || '').toLowerCase() || null,
      ocsp_status: revocationStatus,
      ocsp_checked_at: String(provider.revocation_checked_at || signedAt),
      document_sha256: documentSha256,
      digital_seal_sha256: signatureSha256,
      digital_seal_path: sealPath,
      signed_payload_sha256: signedPayloadSha256,
      sign_algorithm: String(provider.signature_algorithm || 'RSA-SHA256'),
      signed_at: signedAt,
      ip_address: ip,
      user_agent: String(body.session_evidence?.user_agent || request.headers.get('user-agent') || ''),
      timezone: String(body.session_evidence?.timezone || ''),
      fingerprint_id: String(body.device_fingerprint?.fingerprint_id || '') || null,
      validation_provider: String(provider.provider || 'CONFIGURED_GATEWAY'),
      provider_reference: String(provider.signature_id || ''),
      captured_by: user.id,
      captured_at: signedAt,
    });
    if (evidenceError) {
      await supabase.storage.from('evidence').remove([sealPath]);
      return json({ error: 'No fue posible registrar la evidencia de firma.' }, 500);
    }

    await supabase.rpc('append_legal_evidence_event', {
      p_document_id: documentId,
      p_event_type: 'EFIRMA_SIGNATURE_CREATED',
      p_event_category: 'SIGNATURE',
      p_event_result: 'SUCCESS',
      p_actor_id: user.id,
      p_actor_type: 'PARTICIPANT',
      p_payload: {
        evidence_id: evidenceId,
        signature_sha256: signatureSha256,
        signed_payload_sha256: signedPayloadSha256,
        certificate_fingerprint_sha256: String(certificate.fingerprint_sha256 || '').toLowerCase(),
        revocation_status: revocationStatus,
        provider_reference: String(provider.signature_id || ''),
      },
      p_document_sha256: documentSha256,
      p_actor_email: user.email,
      p_idempotency_key: `efirma-signature:${evidenceId}`,
      p_source_system: 'SIGN_EFIRMA_EDGE',
    });

    return json({
      evidence_id: evidenceId,
      digital_seal_sha256: signatureSha256,
      document_sha256: documentSha256,
      signed_payload_sha256: signedPayloadSha256,
      signed_at: signedAt,
      revocation_status: revocationStatus,
      provider_reference: String(provider.signature_id || ''),
    });
  } catch (error) {
    console.error('[sign-efirma] Failed:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'No fue posible completar la firma.', code: 'EFIRMA_SIGNING_ERROR' }, 500);
  }
});
