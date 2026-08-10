import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.0';
import { userCanAccessDocument } from '../_shared/document-access.ts';

const allowedOrigin = Deno.env.get('DOCUBOX_ALLOWED_ORIGIN') || '*';
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
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

function isReasonableCredential(value: string) {
  return value.length >= 64 && value.length <= 400_000 && /^[A-Za-z0-9+/=]+$/.test(value);
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
    const body = await request.json();
    const documentId = String(body.document_id || '');
    const formToken = String(body.form_token || '');
    const cerBase64 = cleanBase64(body.cer_b64);
    const keyBase64 = cleanBase64(body.key_b64);
    const password = String(body.password || '');

    const authorization = request.headers.get('authorization') || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const { data: { user }, error: authError } = await supabase.auth.getUser(bearer);
    let formTokenId: string | null = null;
    let formTokenDocumentId: string | null = null;
    if ((!user || authError) && formToken) {
      const { data: tokenRow } = await supabase
        .from('form_tokens')
        .select('id,expires_at,used_at,form_templates(document_id)')
        .eq('token', formToken)
        .maybeSingle();
      if (tokenRow && !tokenRow.used_at && new Date(tokenRow.expires_at).getTime() > Date.now()) {
        formTokenId = tokenRow.id;
        const template = tokenRow.form_templates as unknown as { document_id?: string | null } | null;
        formTokenDocumentId = template?.document_id || null;
      }
    }
    if ((!user || authError) && !formTokenId) return json({ error: 'No autorizado' }, 401);
    if (documentId && user && !await userCanAccessDocument(supabase, user, documentId)) {
      return json({ error: 'No tienes acceso a este documento' }, 403);
    }
    if (documentId && formTokenId && formTokenDocumentId !== documentId) {
      return json({ error: 'El documento no corresponde al formulario autorizado' }, 403);
    }
    if (!isReasonableCredential(cerBase64) || !isReasonableCredential(keyBase64) || !password) {
      return json({ error: 'Se requieren archivos .cer y .key validos y su contrasena' }, 400);
    }

    const gatewayUrl = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_URL');
    const gatewayToken = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_TOKEN');
    if (!gatewayUrl || !gatewayToken) {
      return json({
        error: 'El proveedor seguro de e.firma no esta configurado.',
        code: 'EFIRMA_PROVIDER_NOT_CONFIGURED',
      }, 503);
    }

    const providerResponse = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gatewayToken}` },
      body: JSON.stringify({
        operation: 'VALIDATE_EFIRMA',
        certificate_der_base64: cerBase64,
        encrypted_private_key_base64: keyBase64,
        private_key_password: password,
        document_id: documentId || null,
        correlation_id: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const provider = await providerResponse.json().catch(() => ({})) as Record<string, unknown>;
    if (!providerResponse.ok) {
      return json({ error: 'No fue posible validar la e.firma con el proveedor.', code: 'EFIRMA_PROVIDER_ERROR' }, 502);
    }

    const certificate = (provider.certificate || {}) as Record<string, unknown>;
    const revocationStatus = String(provider.revocation_status || certificate.revocation_status || '').toUpperCase();
    const serial = String(certificate.serial_number || '');
    const rfc = String(certificate.rfc || '').toUpperCase();
    const curp = String(certificate.curp || '').toUpperCase();
    const notBefore = String(certificate.not_before || '');
    const notAfter = String(certificate.not_after || '');
    const valid = provider.status === 'VALID'
      && provider.key_pair_valid === true
      && provider.certificate_chain_valid === true
      && revocationStatus === 'GOOD'
      && Boolean(serial)
      && (!notBefore || new Date(notBefore).getTime() <= Date.now())
      && Boolean(notAfter)
      && new Date(notAfter).getTime() > Date.now();
    if (!valid) {
      return json({
        error: 'La e.firma no supero la validacion criptografica, de vigencia o revocacion.',
        code: 'EFIRMA_VALIDATION_FAILED',
      }, 422);
    }

    if (documentId && user) {
      const { error: evidenceError } = await supabase.from('signature_evidence').insert({
        document_id: documentId,
        evidence_type: 'efirma_validation',
        cert_serial_number: serial,
        cert_subject: String(certificate.subject || ''),
        cert_rfc: rfc || null,
        cert_curp: curp || null,
        cert_not_before: notBefore || null,
        cert_not_after: notAfter,
        cert_issuer: String(certificate.issuer || ''),
        cert_fingerprint_sha256: String(certificate.fingerprint_sha256 || '').toLowerCase() || null,
        ocsp_status: revocationStatus,
        ocsp_checked_at: String(provider.revocation_checked_at || new Date().toISOString()),
        captured_by: user.id,
        captured_at: new Date().toISOString(),
        ip_address: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
        validation_provider: String(provider.provider || 'CONFIGURED_GATEWAY'),
        provider_reference: String(provider.validation_id || ''),
      });
      if (evidenceError) {
        console.error('[validate-efirma] Evidence write failed:', evidenceError.code);
        return json({ error: 'No fue posible registrar la validacion de e.firma.' }, 500);
      }
    }

    return json({
      valid: true,
      validation_id: String(provider.validation_id || ''),
      cert_serial: serial,
      cert_rfc: rfc,
      cert_curp: curp,
      cert_subject: String(certificate.subject || ''),
      cert_not_before: notBefore,
      cert_not_after: notAfter,
      cert_issuer: String(certificate.issuer || ''),
      cert_fingerprint_sha256: String(certificate.fingerprint_sha256 || '').toLowerCase(),
      revocation_status: revocationStatus,
      revocation_checked_at: String(provider.revocation_checked_at || ''),
    });
  } catch (error) {
    console.error('[validate-efirma] Failed:', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'No fue posible validar la e.firma.', code: 'EFIRMA_VALIDATION_ERROR' }, 500);
  }
});
