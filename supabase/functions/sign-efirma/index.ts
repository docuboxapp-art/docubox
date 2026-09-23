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
  return String(value || '')
    .replace(/^data:[^,]+,/, '')
    .replace(/\s/g, '');
}

function validBrowserGeolocation(geo: unknown) {
  const value = geo as { latitude?: unknown; longitude?: unknown } | null | undefined;
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function resolveParticipantRecordId(value: unknown, authenticatedUserId: string) {
  const candidate = String(value || '').trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(candidate) ? candidate : authenticatedUserId;
}

function nullableInteger(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue) : null;
}

function inferDeviceType(userAgent: string) {
  if (/iPhone|Android.+Mobile|Mobile/i.test(userAgent)) return 'mobile';
  if (/iPad|Android/i.test(userAgent)) return 'tablet';
  return 'desktop';
}

async function sha256Hex(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

function authorizedParticipant(document: Record<string, unknown>, userId: string, email: string) {
  if (document.owner_id === userId) return true;
  const normalizedEmail = email.trim().toLowerCase();
  return (
    Array.isArray(document.participantes) &&
    document.participantes.some(
      (participant: Record<string, unknown>) =>
        participant.id === userId ||
        String(participant.email || '')
          .trim()
          .toLowerCase() === normalizedEmail
    )
  );
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Metodo no permitido' }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
      { auth: { persistSession: false } }
    );
    const authorization = request.headers.get('authorization') || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(bearer);
    if (authError || !user?.email) return json({ error: 'No autorizado' }, 401);

    const body = await request.json();
    const operation = String(body.operation || '').toUpperCase();
    const documentId = String(body.document_id || '');
    const cerBase64 = cleanBase64(body.cer_b64);
    const challengeId = String(body.challenge_id || '');
    const clientSignatureBase64 = cleanBase64(body.signature_base64);
    if (!['PREPARE_CLIENT_SIGNATURE', 'COMPLETE_CLIENT_SIGNATURE'].includes(operation)) {
      return json({ error: 'Operación de firma no permitida' }, 400);
    }
    if (!documentId) {
      return json({ error: 'Se requiere document_id' }, 400);
    }
    if (
      operation === 'COMPLETE_CLIENT_SIGNATURE' &&
      (!challengeId || !cerBase64 || !clientSignatureBase64)
    ) {
      return json({ error: 'Se requieren challenge_id, cer_b64 y signature_base64' }, 400);
    }
    if (!validBrowserGeolocation(body.session_evidence?.geo)) {
      return json(
        {
          error: 'La geolocalización del navegador es obligatoria para firmar con e.firma.',
          code: 'GEOLOCATION_REQUIRED',
        },
        422
      );
    }
    if (cerBase64.length > 400_000 || clientSignatureBase64.length > 100_000) {
      return json(
        {
          error: 'Los archivos de e.firma exceden el limite permitido',
        },
        413
      );
    }

    const { data: document, error: documentError } = await supabase
      .from('documentos')
      .select(
        'id,documento_id,nombre,owner_id,workspace_id,file_hash_sha256,file_size,created_at,participantes'
      )
      .eq('id', documentId)
      .maybeSingle();
    if (documentError || !document) {
      return json({ error: 'Documento no encontrado' }, 404);
    }

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
    if (!authorized) {
      return json({ error: 'No tienes acceso a este documento' }, 403);
    }

    const normalizedEmail = user.email.trim().toLowerCase();
    const participant = Array.isArray(document.participantes)
      ? document.participantes.find(
          (candidate: Record<string, unknown>) =>
            candidate.id === user.id ||
            candidate.user_id === user.id ||
            String(candidate.email || '')
              .trim()
              .toLowerCase() === normalizedEmail
        )
      : null;
    let workspaceName: string | null = null;
    if (document.workspace_id) {
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', document.workspace_id)
        .maybeSingle();
      workspaceName = workspace?.name || null;
    }
    const { data: documentMetadata } = await supabase
      .from('document_metadata')
      .select('pdf_page_count')
      .eq('document_id', documentId)
      .maybeSingle();

    const documentSha256 = String(document.file_hash_sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(documentSha256)) {
      return json(
        {
          error: 'El documento no cuenta con una huella SHA-256 verificable',
        },
        422
      );
    }

    if (operation === 'PREPARE_CLIENT_SIGNATURE') {
      const evidenceId = crypto.randomUUID();
      const signedAt = new Date().toISOString();
      const geoLatitude = Number(body.session_evidence.geo.latitude);
      const geoLongitude = Number(body.session_evidence.geo.longitude);
      const signedPayload = JSON.stringify({
        schema: 'DOCUBOX_EFIRMA_ACT',
        version: '2.0',
        evidence_id: evidenceId,
        document_id: documentId,
        document_folio: document.documento_id,
        document_sha256: documentSha256,
        signer_id: user.id,
        signer_email_sha256: await sha256Hex(user.email.trim().toLowerCase()),
        signed_at: signedAt,
        geo_latitude: geoLatitude,
        geo_longitude: geoLongitude,
      });
      const signedPayloadSha256 = await sha256Hex(signedPayload);
      const { data: challenge, error: challengeError } = await supabase
        .from('efirma_signing_challenges')
        .insert({
          evidence_id: evidenceId,
          user_id: user.id,
          document_id: documentId,
          signed_payload: signedPayload,
          signed_payload_sha256: signedPayloadSha256,
          session_evidence: body.session_evidence || {},
          device_fingerprint: body.device_fingerprint || {},
          participant_context: body.participant_context || {},
          client_timestamp: body.client_timestamp || null,
        })
        .select('id,evidence_id,expires_at')
        .single();
      if (challengeError || !challenge) {
        return json({ error: 'No fue posible preparar la firma local.' }, 500);
      }

      return json({
        challenge_id: challenge.id,
        evidence_id: challenge.evidence_id,
        payload_utf8_base64: btoa(signedPayload),
        payload_sha256: signedPayloadSha256,
        expires_at: challenge.expires_at,
      });
    }

    const gatewayUrl = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_URL');
    const gatewayToken = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_TOKEN');
    if (!gatewayUrl || !gatewayToken) {
      return json(
        {
          error: 'El proveedor seguro de e.firma no esta configurado.',
          code: 'EFIRMA_PROVIDER_NOT_CONFIGURED',
        },
        503
      );
    }

    let evidenceId = crypto.randomUUID();
    let signedAt = new Date().toISOString();
    let persistedSessionEvidence = (body.session_evidence || {}) as Record<string, any>;
    let persistedDeviceFingerprint = (body.device_fingerprint || {}) as Record<string, any>;
    let persistedParticipantContext = (body.participant_context || {}) as Record<string, any>;
    let persistedClientTimestamp = String(body.client_timestamp || '') || null;
    let signedPayload = '';
    let signedPayloadSha256 = '';

    if (operation === 'COMPLETE_CLIENT_SIGNATURE') {
      const consumedAt = new Date().toISOString();
      const { data: challenge, error: challengeError } = await supabase
        .from('efirma_signing_challenges')
        .update({ used_at: consumedAt })
        .eq('id', challengeId)
        .eq('user_id', user.id)
        .eq('document_id', documentId)
        .is('used_at', null)
        .gt('expires_at', consumedAt)
        .select(
          'evidence_id,signed_payload,signed_payload_sha256,session_evidence,device_fingerprint,participant_context,client_timestamp'
        )
        .maybeSingle();
      if (challengeError || !challenge) {
        return json(
          {
            error: 'El desafío de firma venció o ya fue utilizado. Intenta firmar nuevamente.',
            code: 'EFIRMA_CHALLENGE_INVALID',
          },
          409
        );
      }
      evidenceId = challenge.evidence_id;
      signedPayload = challenge.signed_payload;
      signedPayloadSha256 = challenge.signed_payload_sha256;
      persistedSessionEvidence = challenge.session_evidence || {};
      persistedDeviceFingerprint = challenge.device_fingerprint || {};
      persistedParticipantContext = challenge.participant_context || {};
      persistedClientTimestamp = challenge.client_timestamp || null;
      const parsedPayload = JSON.parse(signedPayload) as Record<string, unknown>;
      signedAt = String(parsedPayload.signed_at || consumedAt);
      if (
        parsedPayload.document_id !== documentId ||
        parsedPayload.signer_id !== user.id ||
        parsedPayload.document_sha256 !== documentSha256 ||
        (await sha256Hex(signedPayload)) !== signedPayloadSha256
      ) {
        return json({ error: 'El desafío de firma no es íntegro.' }, 422);
      }
    } else {
      const geoLatitude = Number(persistedSessionEvidence.geo.latitude);
      const geoLongitude = Number(persistedSessionEvidence.geo.longitude);
      signedPayload = JSON.stringify({
        schema: 'DOCUBOX_EFIRMA_ACT',
        version: '1.0',
        evidence_id: evidenceId,
        document_id: documentId,
        document_folio: document.documento_id,
        document_sha256: documentSha256,
        signer_id: user.id,
        signer_email_sha256: await sha256Hex(user.email.trim().toLowerCase()),
        signed_at: signedAt,
        geo_latitude: geoLatitude,
        geo_longitude: geoLongitude,
      });
      signedPayloadSha256 = await sha256Hex(signedPayload);
    }

    const geoLatitude = Number(persistedSessionEvidence.geo.latitude);
    const geoLongitude = Number(persistedSessionEvidence.geo.longitude);
    const geoAccuracyMeters = Number(persistedSessionEvidence.geo.accuracy_meters || 0);

    const providerResponse = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        operation: 'VERIFY_EFIRMA',
        certificate_der_base64: cerBase64,
        signature_base64: clientSignatureBase64,
        signature_algorithm: 'RSA-SHA256',
        payload_utf8_base64: btoa(signedPayload),
        payload_sha256: signedPayloadSha256,
        correlation_id: evidenceId,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const provider = (await providerResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const certificate = (provider.certificate || {}) as Record<string, unknown>;
    const nubariumValidation = (provider.nubarium_validation || {}) as Record<string, unknown>;
    const signatureBase64 = clientSignatureBase64;
    const revocationStatus = String(
      provider.revocation_status || certificate.revocation_status || ''
    ).toUpperCase();
    if (
      !providerResponse.ok ||
      provider.status !== 'VALID' ||
      provider.signature_verified !== true ||
      provider.certificate_chain_valid !== true ||
      revocationStatus !== 'GOOD' ||
      provider.payload_sha256 !== signedPayloadSha256 ||
      !signatureBase64
    ) {
      return json(
        {
          error: 'La firma no supero la validacion criptografica del proveedor.',
          code: 'EFIRMA_SIGNING_FAILED',
        },
        422
      );
    }

    const signatureBytes = Uint8Array.from(atob(signatureBase64), (character) =>
      character.charCodeAt(0)
    );
    const signatureSha256 = await sha256Hex(signatureBytes);
    const sealPath = `${documentId}/efirma/${evidenceId}.sig`;
    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(sealPath, signatureBytes, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
    if (uploadError) {
      return json({ error: 'No fue posible conservar el sello de firma.' }, 500);
    }
    const evidenceBundle = JSON.stringify({
      schema: 'docubox-efirma-evidence-bundle-v1',
      payload_utf8_base64: btoa(signedPayload),
      payload_sha256: signedPayloadSha256,
      signature_base64: signatureBase64,
      signature_sha256: signatureSha256,
      signature_algorithm: String(provider.signature_algorithm || 'RSA-SHA256'),
      certificate_der_base64: cerBase64,
      certificate_fingerprint_sha256: String(certificate.fingerprint_sha256 || '').toLowerCase(),
      certificate_chain_valid: provider.certificate_chain_valid === true,
      signature_verified: provider.signature_verified === true,
      revocation_status: revocationStatus,
      validation_provider: String(provider.provider || 'CONFIGURED_GATEWAY'),
      validated_at: String(provider.revocation_checked_at || signedAt),
      nubarium_validation: nubariumValidation,
    });
    const bundleBytes = new TextEncoder().encode(evidenceBundle);
    const bundleSha256 = await sha256Hex(bundleBytes);
    const bundlePath = `${documentId}/efirma/${evidenceId}.evidence.json`;
    const { error: bundleUploadError } = await supabase.storage
      .from('evidence')
      .upload(bundlePath, bundleBytes, {
        contentType: 'application/json',
        upsert: false,
      });
    if (bundleUploadError) {
      await supabase.storage.from('evidence').remove([sealPath]);
      return json(
        {
          error: 'No fue posible conservar el paquete verificable de e.firma.',
        },
        500
      );
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const sessionEvidence = persistedSessionEvidence;
    const deviceFingerprint = persistedDeviceFingerprint;
    const participantContext = persistedParticipantContext;
    const userAgent = String(sessionEvidence.user_agent || request.headers.get('user-agent') || '');
    const { error: evidenceError } = await supabase.from('signature_evidence').insert({
      id: evidenceId,
      capture_id: evidenceId,
      signature_id: evidenceId,
      participant_record_id: resolveParticipantRecordId(body.participant_id, user.id),
      evidence_role: 'FINAL_SIGNATURE',
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
      digital_seal: signatureBase64,
      digital_seal_path: sealPath,
      efirma_bundle_path: bundlePath,
      efirma_bundle_sha256: bundleSha256,
      bundle_storage_bucket: 'evidence',
      signed_payload_sha256: signedPayloadSha256,
      sign_algorithm: String(provider.signature_algorithm || 'RSA-SHA256'),
      signed_at: signedAt,
      ip_address: ip,
      user_agent: userAgent,
      timezone: String(sessionEvidence.timezone || ''),
      geo_latitude: geoLatitude,
      geo_longitude: geoLongitude,
      geo_accuracy_m: Number.isFinite(geoAccuracyMeters) ? geoAccuracyMeters : null,
      fingerprint_id: String(deviceFingerprint.fingerprint_id || '') || null,
      language: String(sessionEvidence.language || deviceFingerprint.language || '') || null,
      screen_resolution:
        String(sessionEvidence.screen || deviceFingerprint.screen_resolution || '') || null,
      device_type: inferDeviceType(userAgent),
      cpu_cores: nullableInteger(deviceFingerprint.cpu_cores),
      device_memory_gb: Number.isFinite(Number(deviceFingerprint.device_memory_gb))
        ? Number(deviceFingerprint.device_memory_gb)
        : null,
      canvas_hash: String(deviceFingerprint.canvas_hash || '') || null,
      webgl_renderer: String(deviceFingerprint.webgl_renderer || '') || null,
      audio_hash: String(deviceFingerprint.audio_hash || '') || null,
      geo_source: String(sessionEvidence.geo?.source || '') || null,
      country: String(sessionEvidence.geo?.country || '') || null,
      country_code: String(sessionEvidence.geo?.country_code || '') || null,
      region: String(sessionEvidence.geo?.region || '') || null,
      city: String(sessionEvidence.geo?.city || '') || null,
      client_timestamp: persistedClientTimestamp,
      workspace_id: document.workspace_id || null,
      workspace_name: workspaceName,
      document_pages: nullableInteger(documentMetadata?.pdf_page_count),
      document_size_kb: Number.isFinite(Number(document.file_size))
        ? Math.round((Number(document.file_size) / 1024) * 100) / 100
        : null,
      document_created_at: document.created_at || null,
      participant_name:
        String(participantContext.name || participant?.nombre || participant?.name || '') || null,
      participant_email: String(participantContext.email || user.email || '') || null,
      participant_role:
        String(participantContext.role || participant?.role || participant?.rol || '') || null,
      validation_provider: String(provider.provider || 'CONFIGURED_GATEWAY'),
      provider_reference: String(provider.signature_id || ''),
      nubarium_estado: String(nubariumValidation.estado || '') || null,
      nubarium_fecha_consulta:
        String(nubariumValidation.fecha_consulta || provider.revocation_checked_at || signedAt),
      nubarium_codigo_validacion:
        String(nubariumValidation.codigo_validacion || '') || null,
      efirma_nubarium_resp: Object.keys(nubariumValidation).length ? nubariumValidation : null,
      captured_by: user.id,
      captured_at: signedAt,
      context_ip_status: ip === 'unknown' ? 'unavailable' : 'available',
      context_geo_status:
        geoLatitude === null || geoLongitude === null ? 'unavailable' : 'available',
      context_user_agent_status: userAgent ? 'available' : 'unavailable',
    });
    if (evidenceError) {
      await supabase.storage.from('evidence').remove([sealPath, bundlePath]);
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
        validation_provider: String(provider.provider || 'CONFIGURED_GATEWAY'),
        nubarium_estado: String(nubariumValidation.estado || '') || null,
        nubarium_codigo_validacion: String(nubariumValidation.codigo_validacion || '') || null,
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
      efirma_bundle_sha256: bundleSha256,
      document_sha256: documentSha256,
      signed_payload_sha256: signedPayloadSha256,
      signed_at: signedAt,
      revocation_status: revocationStatus,
      provider_reference: String(provider.signature_id || ''),
    });
  } catch (error) {
    console.error('[sign-efirma] Failed:', error instanceof Error ? error.message : 'unknown');
    return json(
      {
        error: 'No fue posible completar la firma.',
        code: 'EFIRMA_SIGNING_ERROR',
      },
      500
    );
  }
});
