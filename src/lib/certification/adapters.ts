import { constants, createPublicKey, verify } from 'node:crypto';
import { sha256Hex } from './canonical';
import { CertificationError, KmsPurpose, VerifiedKmsSignature, VerifiedTimestamp } from './types';

function requireGateway(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new CertificationError(
      'CRYPTOGRAPHIC_PROVIDER_NOT_CONFIGURED',
      `El proveedor seguro ${name} no esta configurado. La certificacion no puede simularse.`,
      503,
    );
  }
  return value;
}

export function getCryptographicProviderStatus() {
  const required = [
    'DOCUBOX_KMS_GATEWAY_URL',
    'DOCUBOX_TSA_GATEWAY_URL',
    'DOCUBOX_PADES_GATEWAY_URL',
  ] as const;
  const missing = required.filter((name) => !process.env[name]);
  return { ready: missing.length === 0, missing };
}

async function gatewayRequest(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.DOCUBOX_CRYPTO_GATEWAY_TOKEN
        ? { Authorization: `Bearer ${process.env.DOCUBOX_CRYPTO_GATEWAY_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CertificationError(
      'CRYPTOGRAPHIC_PROVIDER_ERROR',
      String(payload.error || `El proveedor criptografico respondio HTTP ${response.status}`),
      502,
    );
  }
  return payload as Record<string, unknown>;
}

export async function signDigestWithKms(
  purpose: KmsPurpose,
  digestHex: string,
  canonicalBytes: Uint8Array,
): Promise<VerifiedKmsSignature> {
  const url = requireGateway('DOCUBOX_KMS_GATEWAY_URL');
  const payload = await gatewayRequest(url, {
    operation: 'SIGN_DIGEST',
    purpose,
    algorithm: 'RSA-PSS-SHA256',
    message_type: 'DIGEST',
    digest_sha256: digestHex,
  });

  const signatureBase64 = String(payload.signature_base64 || '');
  const publicKeyPem = String(payload.public_key_pem || '');
  const algorithm = String(payload.algorithm || '');
  const keySize = Number(payload.key_size_bits || 0);
  if (!signatureBase64 || !publicKeyPem || algorithm !== 'RSA-PSS-SHA256' || keySize < 3072) {
    throw new CertificationError('INVALID_KMS_RESPONSE', 'El sello KMS no cumple RSA-PSS SHA-256 con llave RSA de 3072 bits.', 502);
  }

  const publicKey = createPublicKey(publicKeyPem);
  const verified = verify(
    'sha256',
    Buffer.from(canonicalBytes),
    { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
    Buffer.from(signatureBase64, 'base64'),
  );
  if (!verified) throw new CertificationError('KMS_SIGNATURE_INVALID', 'El sello devuelto por KMS no pudo verificarse.', 502);

  const signatureBytes = Buffer.from(signatureBase64, 'base64');
  const certificatePem = payload.certificate_pem ? String(payload.certificate_pem) : null;
  return {
    status: 'VALID',
    signatureBase64,
    signatureSha256: sha256Hex(signatureBytes),
    algorithm: 'RSA-PSS-SHA256',
    keySizeBits: keySize,
    keyId: String(payload.key_id || ''),
    keyVersion: String(payload.key_version || ''),
    publicKeyPem,
    publicKeyFingerprintSha256: sha256Hex(publicKey.export({ type: 'spki', format: 'der' })),
    certificatePem,
    certificateFingerprintSha256: certificatePem ? sha256Hex(certificatePem) : null,
    signedAt: String(payload.signed_at || new Date().toISOString()),
  };
}

export async function requestVerifiedTimestamp(messageImprintSha256: string): Promise<VerifiedTimestamp> {
  const url = requireGateway('DOCUBOX_TSA_GATEWAY_URL');
  const payload = await gatewayRequest(url, {
    operation: 'RFC3161_TIMESTAMP',
    input_type: 'PRECOMPUTED_DIGEST',
    hash_algorithm: 'SHA-256',
    message_imprint_sha256: messageImprintSha256,
    certificate_requested: true,
  });

  if (
    payload.status !== 'VALID'
    || payload.message_imprint_sha256 !== messageImprintSha256
    || payload.token_signature_valid !== true
    || payload.tsa_certificate_valid !== true
  ) {
    throw new CertificationError('RFC3161_VALIDATION_FAILED', 'La estampa RFC 3161 no supero la validacion criptografica.', 502);
  }

  const responseBytes = Buffer.from(String(payload.response_base64 || ''), 'base64');
  const tokenBytes = Buffer.from(String(payload.token_base64 || ''), 'base64');
  const requestBytes = payload.request_base64 ? Buffer.from(String(payload.request_base64), 'base64') : null;
  if (!responseBytes.length || !tokenBytes.length) {
    throw new CertificationError('RFC3161_ARTIFACTS_MISSING', 'La TSA no devolvio los artefactos binarios requeridos.', 502);
  }

  return {
    standard: 'RFC3161',
    status: 'VALID',
    messageImprintSha256,
    requestBytes,
    responseBytes,
    tokenBytes,
    genTime: String(payload.gen_time),
    tsaName: String(payload.tsa_name),
    tsaPolicyOid: String(payload.tsa_policy_oid),
    tsaSerialNumber: String(payload.tsa_serial_number),
    tsaNonce: payload.tsa_nonce ? String(payload.tsa_nonce) : null,
    certificateSerialNumber: String(payload.tsa_certificate_serial_number),
    certificateFingerprintSha256: String(payload.tsa_certificate_fingerprint_sha256).toLowerCase(),
    issuer: String(payload.tsa_issuer),
    certificatePem: String(payload.tsa_certificate_pem || ''),
    chainPem: String(payload.tsa_chain_pem || ''),
    verifiedAt: String(payload.verified_at || new Date().toISOString()),
  };
}

export async function signPdfWithPades(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const url = requireGateway('DOCUBOX_PADES_GATEWAY_URL');
  const payload = await gatewayRequest(url, {
    operation: 'SIGN_PADES',
    profile: 'PAdES-B-T',
    pdf_base64: Buffer.from(pdfBytes).toString('base64'),
  });
  if (payload.status !== 'VALID' || payload.byte_range_valid !== true || !payload.pdf_base64) {
    throw new CertificationError('PADES_VALIDATION_FAILED', 'La firma PAdES final no pudo verificarse.', 502);
  }
  return Buffer.from(String(payload.pdf_base64), 'base64');
}
