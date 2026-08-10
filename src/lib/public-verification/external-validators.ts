import type { VerificationCheck, VerificationEngine } from './types';

export async function validateWithExternalGateway(input: {
  engine: Extract<
    VerificationEngine,
    'NOM151' | 'RFC3161' | 'XML_XMLDSIG' | 'PDF_PADES' | 'EVIDENCE_CHAIN'
  >;
  gatewayEnv: string;
  payload: Record<string, unknown>;
}): Promise<VerificationCheck[]> {
  const checkedAt = new Date().toISOString();
  const gateway = process.env[input.gatewayEnv];
  if (!gateway) {
    return [
      {
        engine: input.engine,
        checkType: 'PROVIDER_CONFIGURATION',
        status: 'SERVICE_UNAVAILABLE',
        code: 'VALIDATOR_NOT_CONFIGURED',
        message:
          'El validador criptografico especializado no esta configurado. No se emitio un resultado satisfactorio ficticio.',
        checkedAt,
      },
    ];
  }
  try {
    const response = await fetch(gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.DOCUBOX_CRYPTO_GATEWAY_TOKEN
          ? { Authorization: `Bearer ${process.env.DOCUBOX_CRYPTO_GATEWAY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(45_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return [
        {
          engine: input.engine,
          checkType: 'REMOTE_VALIDATION',
          status: 'SERVICE_UNAVAILABLE',
          code: 'VALIDATOR_REQUEST_FAILED',
          message: 'El proveedor de validacion no pudo completar la consulta.',
          checkedAt,
          technicalDetails: { httpStatus: response.status },
        },
      ];
    const status = normalizeGatewayStatus(data.status);
    return [
      {
        engine: input.engine,
        checkType: 'REMOTE_VALIDATION',
        status,
        code: String(data.code || `REMOTE_${status}`),
        message: String(
          data.message || 'Validacion criptografica procesada por el proveedor configurado.'
        ),
        checkedAt,
        technicalDetails: sanitizeDetails(data),
      },
    ];
  } catch {
    return [
      {
        engine: input.engine,
        checkType: 'REMOTE_VALIDATION',
        status: 'SERVICE_UNAVAILABLE',
        code: 'VALIDATOR_UNREACHABLE',
        message: 'El proveedor de validacion no esta disponible temporalmente.',
        checkedAt,
      },
    ];
  }
}

function normalizeGatewayStatus(value: unknown): VerificationCheck['status'] {
  const status = String(value || '').toUpperCase();
  if (['VALID', 'VERIFIED'].includes(status)) return 'VERIFIED';
  if (['INVALID', 'TAMPERED'].includes(status))
    return status === 'TAMPERED' ? 'TAMPERED' : 'INVALID';
  if (status === 'INVALID_SIGNATURE') return 'INVALID_SIGNATURE';
  if (status === 'UNTRUSTED_CERTIFICATE') return 'UNTRUSTED_CERTIFICATE';
  if (status === 'REVOCATION_UNKNOWN') return 'REVOCATION_UNKNOWN';
  return 'INDETERMINATE';
}

function sanitizeDetails(value: Record<string, unknown>) {
  const allowed = [
    'algorithm',
    'policy_oid',
    'serial_number',
    'generation_time',
    'certificate_status',
    'signature_status',
    'message_imprint_match',
    'provider',
  ];
  return Object.fromEntries(
    allowed.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])
  );
}
