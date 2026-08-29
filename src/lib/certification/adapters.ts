import { constants, createPublicKey, verify } from 'node:crypto';
import { sha256Hex } from './canonical';
import { CertificationError, KmsPurpose, VerifiedKmsSignature } from './types';

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
    'DOCUBOX_TSA_URL',
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

/**
 * @deprecated Kept solely for source compatibility. WP-06 replaces this
 * response-trusting gateway with TimestampAuthorityProvider, which parses and
 * verifies the ASN.1/CMS TimeStampToken locally before PAdES may become B-T.
 */
export async function requestVerifiedTimestamp(_messageImprintSha256: string): Promise<never> {
  throw new CertificationError(
    'RFC3161_LEGACY_GATEWAY_DISABLED',
    'El gateway heredado no aporta una estampa RFC 3161 verificable. Usa TimestampAuthorityProvider.',
    503,
  );
}

/**
 * @deprecated WP-05 replaces this response-trusting gateway adapter with
 * PdfSignatureProvider. It is intentionally disabled so no new flow can call
 * an unverified remote result PAdES-B-T before RFC 3161 exists (WP-06).
 */
export async function signPdfWithPades(_pdfBytes: Uint8Array): Promise<never> {
  throw new CertificationError(
    'PADES_LEGACY_GATEWAY_DISABLED',
    'El gateway heredado no genera evidencia PAdES verificable. Usa PdfSignatureProvider PAdES-B-B.',
    503,
  );
}
