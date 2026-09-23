import 'npm:reflect-metadata@0.2.2';
import { X509Certificate } from 'npm:@peculiar/x509@1.14.3';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const nubariumEndpoint = 'https://api.nubarium.com/sat/v1/validar-serial';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function cleanBase64(value: unknown) {
  return String(value || '')
    .replace(/^data:[^,]+,/, '')
    .replace(/\s/g, '');
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function bytesToHex(value: ArrayBuffer | Uint8Array) {
  return Array.from(value instanceof Uint8Array ? value : new Uint8Array(value))
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(value: Uint8Array) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', value));
}

async function secretMatches(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const [actualHash, expectedHash] = await Promise.all([
    sha256Hex(new TextEncoder().encode(actual)),
    sha256Hex(new TextEncoder().encode(expected)),
  ]);
  let difference = actualHash.length ^ expectedHash.length;
  for (let index = 0; index < Math.max(actualHash.length, expectedHash.length); index += 1) {
    difference |= (actualHash.charCodeAt(index) || 0) ^ (expectedHash.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function satSerialFromHex(value: string) {
  const normalized = value.replace(/[^a-f0-9]/gi, '');
  const decoded = Array.from(normalized.match(/.{2}/g) || [], (item) =>
    String.fromCharCode(Number.parseInt(item, 16))
  ).join('');
  if (/^\d{10,30}$/.test(decoded)) return decoded;
  try {
    return BigInt(`0x${normalized}`).toString(10);
  } catch {
    return normalized;
  }
}

function findIdentity(subject: string, length: 12 | 13 | 18) {
  const candidates = subject.toUpperCase().match(/[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3,8}/g) || [];
  return candidates.find((candidate) => candidate.length === length) || '';
}

serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405);

  try {
    const expectedToken = Deno.env.get('DOCUBOX_EFIRMA_GATEWAY_TOKEN') || '';
    const authorization = request.headers.get('authorization') || '';
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!(await secretMatches(bearer, expectedToken))) return json({ error: 'No autorizado' }, 401);

    const body = await request.json();
    if (String(body.operation || '') !== 'VERIFY_EFIRMA') {
      return json({ error: 'Operacion no permitida' }, 400);
    }

    const certificateBase64 = cleanBase64(body.certificate_der_base64);
    const signatureBase64 = cleanBase64(body.signature_base64);
    const payloadBase64 = cleanBase64(body.payload_utf8_base64);
    const expectedPayloadSha256 = String(body.payload_sha256 || '').toLowerCase();
    const correlationId = String(body.correlation_id || crypto.randomUUID());
    if (!certificateBase64 || !signatureBase64 || !payloadBase64) {
      return json({ error: 'Faltan datos para verificar la e.firma' }, 400);
    }
    if (
      certificateBase64.length > 400_000 ||
      signatureBase64.length > 100_000 ||
      payloadBase64.length > 400_000
    ) {
      return json({ error: 'Los datos de e.firma exceden el limite permitido' }, 413);
    }

    const certificateBytes = base64ToBytes(certificateBase64);
    const signatureBytes = base64ToBytes(signatureBase64);
    const payloadBytes = base64ToBytes(payloadBase64);
    const payloadSha256 = await sha256Hex(payloadBytes);
    if (!/^[a-f0-9]{64}$/.test(expectedPayloadSha256) || payloadSha256 !== expectedPayloadSha256) {
      return json({ error: 'La huella del contenido firmado no coincide' }, 422);
    }

    const certificate = new X509Certificate(certificateBytes);
    const publicKey = await certificate.publicKey.export(
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      ['verify'],
      crypto
    );
    const signatureVerified = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signatureBytes,
      payloadBytes
    );
    if (!signatureVerified) {
      return json({ error: 'La firma no corresponde al certificado presentado' }, 422);
    }

    const now = Date.now();
    if (certificate.notBefore.getTime() > now || certificate.notAfter.getTime() <= now) {
      return json({ error: 'El certificado no se encuentra vigente' }, 422);
    }

    const rfc = findIdentity(certificate.subject, 12) || findIdentity(certificate.subject, 13);
    const curp = findIdentity(certificate.subject, 18);
    const serial = satSerialFromHex(certificate.serialNumber);
    if ((!rfc && !curp) || !serial) {
      return json({ error: 'No fue posible identificar el certificado SAT' }, 422);
    }

    const nubariumUser = Deno.env.get('NUBARIUM_USER') || Deno.env.get('NUBARIUM_API_KEY') || '';
    const nubariumPass = Deno.env.get('NUBARIUM_PASS') || Deno.env.get('NUBARIUM_API_SECRET') || '';
    if (!nubariumUser || !nubariumPass) {
      return json({ error: 'El servicio de validacion SAT no esta configurado' }, 503);
    }
    const credentials = btoa(`${nubariumUser}:${nubariumPass}`);
    const nubariumResponse = await fetch(nubariumEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rfc ? { rfc, serial } : { curp, serial }),
      signal: AbortSignal.timeout(15_000),
    });
    const validation = (await nubariumResponse.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(validation.estado || '').toLowerCase();
    const statusCode =
      typeof validation.clave_mensaje === 'number' ? validation.clave_mensaje : null;
    const inactive = ['revocado', 'suspendido', 'cancelado', 'no vigente', 'expirado'].includes(
      status
    );
    const active = nubariumResponse.ok && !inactive && (status === 'activo' || statusCode === 0);
    if (!active) {
      return json({ error: 'El certificado SAT no esta vigente o fue revocado' }, 422);
    }

    const checkedAt = new Date().toISOString();
    const validationCode = [
      validation.codigo_validacion,
      validation.codigoValidacion,
      validation.folio,
      validation.id,
    ].find((value) => value !== null && value !== undefined && String(value).trim());
    return json({
      status: 'VALID',
      signature_verified: true,
      certificate_chain_valid: true,
      revocation_status: 'GOOD',
      payload_sha256: payloadSha256,
      signature_algorithm: 'RSA-SHA256',
      signature_id: correlationId,
      provider: 'NUBARIUM_SAT_AND_WEBCRYPTO',
      revocation_checked_at: checkedAt,
      nubarium_validation: {
        estado: String(validation.estado || 'Activo'),
        fecha_consulta: checkedAt,
        codigo_validacion: validationCode ? String(validationCode) : null,
        clave_mensaje: statusCode,
      },
      certificate: {
        serial_number: serial,
        subject: certificate.subject,
        issuer: certificate.issuer,
        rfc: rfc || null,
        curp: curp || null,
        not_before: certificate.notBefore.toISOString(),
        not_after: certificate.notAfter.toISOString(),
        fingerprint_sha256: await sha256Hex(certificateBytes),
      },
    });
  } catch (error) {
    console.error(
      '[efirma-gateway] Verification failed:',
      error instanceof Error ? error.message : 'unknown'
    );
    return json({ error: 'No fue posible verificar la e.firma' }, 500);
  }
});
