import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { validateWithExternalGateway } from './external-validators';
import type { PublicVerificationResult, VerificationEngine } from './types';
import { VERIFIER_VERSION } from './types';
import { enforcePublicRateLimit } from './gateway';

export async function handleTechnicalValidation(
  request: NextRequest,
  config: {
    engine: Extract<
      VerificationEngine,
      'NOM151' | 'RFC3161' | 'XML_XMLDSIG' | 'PDF_PADES' | 'EVIDENCE_CHAIN'
    >;
    method: PublicVerificationResult['method'];
    gatewayEnv: string;
    acceptedExtensions: string[];
  }
) {
  if (!enforcePublicRateLimit(request, config.method, 12))
    return response({ error: 'Demasiadas consultas. Intenta mas tarde.' }, 429);
  try {
    const body = await request.json();
    const hash = String(body.hash || '')
      .trim()
      .toLowerCase();
    const fileName = String(body.fileName || '').slice(0, 180);
    const artifactBase64 = typeof body.artifactBase64 === 'string' ? body.artifactBase64 : '';
    const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(hash))
      return response({ error: 'La huella SHA-256 no es valida.' }, 400);
    if (fileName && !config.acceptedExtensions.includes(extension))
      return response({ error: 'El formato no es compatible con este validador.' }, 415);
    if (artifactBase64.length > 12_000_000)
      return response({ error: 'El artefacto excede el limite permitido.' }, 413);
    const checks = await validateWithExternalGateway({
      engine: config.engine,
      gatewayEnv: config.gatewayEnv,
      payload: {
        hash_algorithm: 'SHA-256',
        artifact_sha256: hash,
        file_name: fileName || null,
        file_size: Number(body.fileSize || 0),
        artifact_base64: artifactBase64 || null,
        document_sha256: typeof body.documentHash === 'string' ? body.documentHash : null,
      },
    });
    const status = checks[0]?.status || 'INDETERMINATE';
    return response({
      verificationId: randomUUID(),
      method: config.method,
      overallStatus: status,
      headline:
        status === 'VERIFIED'
          ? 'Evidencia criptografica verificada'
          : status === 'SERVICE_UNAVAILABLE'
            ? 'Validador no configurado'
            : status === 'INVALID'
              ? 'La evidencia no supero la validacion'
              : 'Resultado indeterminado',
      message: checks[0]?.message,
      validatorVersion: VERIFIER_VERSION,
      checkedAt: new Date().toISOString(),
      schemaVersion: 'manifest-v4',
      document: null,
      artifactMatches: [],
      checks,
      warnings: [],
    });
  } catch {
    return response({ error: 'No fue posible procesar la solicitud.' }, 400);
  }
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
