import 'server-only';
import { randomUUID } from 'node:crypto';

type VerificationInput = {
  front: string;
  back: string;
  selfie: string;
  video?: string | null;
  documentType?: string | null;
  approvedDocument?: { curp: string | null; nombre: string | null } | null;
};

type ProviderResult = {
  provider: string;
  verification_id: string;
  verified_at: string;
  status: 'VALID' | 'INVALID';
  document_validation: { valid: boolean };
  document_fields: { curp: string | null; nombre_completo: string | null; nombre?: string | null };
  face_validation: { match: boolean; score: number };
  liveness: { passed: boolean; method: string; score?: number };
  face_template_base64?: string | null;
};

export class IdentityProviderUnavailableError extends Error {}

async function postProvider(url: string, auth: string, payload: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new IdentityProviderUnavailableError('No fue posible conectar con el proveedor biométrico.');
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    throw new IdentityProviderUnavailableError('El proveedor biométrico no pudo procesar la captura.');
  }
  return data;
}

function validDocumentExpiry(value: unknown) {
  if (!value) return true;
  const years = String(value).match(/(?:19|20)\d{2}/g);
  if (!years?.length) return false;
  return Number(years[years.length - 1]) >= new Date().getFullYear();
}

export async function verifyIdentityAndLiveness(input: VerificationInput): Promise<ProviderResult> {
  const gatewayUrl = process.env.IDENTITY_VERIFICATION_GATEWAY_URL;
  const gatewayToken = process.env.IDENTITY_VERIFICATION_GATEWAY_TOKEN;
  if (gatewayUrl && gatewayToken) {
    const result = await postProvider(gatewayUrl, `Bearer ${gatewayToken}`, {
      operation: 'VERIFY_IDENTITY_AND_LIVENESS',
      correlation_id: randomUUID(),
      document_type: input.documentType || '',
      document_front_base64: input.front,
      document_back_base64: input.back,
      selfie_base64: input.selfie,
      ...(input.video ? { liveness_video_base64: input.video } : {}),
    });
    return result as ProviderResult;
  }

  const user = process.env.NUBARIUM_USER;
  const pass = process.env.NUBARIUM_PASS;
  if (!user || !pass) {
    throw new IdentityProviderUnavailableError('El proveedor de identidad y prueba de vida no está configurado.');
  }
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const [document, face, liveness] = await Promise.all([
    input.approvedDocument
      ? Promise.resolve(null)
      : postProvider('https://ocr.nubarium.com/ocr/v1/obtener_datos_id', auth, {
          id: input.front,
          idReverso: input.back,
        }),
    postProvider('https://biometrics.nubarium.com/antifraude/reconocimiento_facial', auth, {
      credencial: input.front,
      captura: input.selfie,
      tipo: 'imagen',
      limiteInferior: '75',
    }),
    postProvider('https://api.nubarium.com/global/biometrics/v1/liveness-face', auth, {
      face: input.selfie,
    }),
  ]);

  const documentValid = input.approvedDocument
    ? true
    : Boolean(document?.tipo && (document?.nombres || document?.nombre) && validDocumentExpiry(document?.vigencia));
  const score = Number(face.similitud || 0);
  const faceMatch = face.estatus === 'OK' && Number.isFinite(score) && score >= 99.5;
  const livenessScore = Number(liveness.score || 0);
  const live = liveness.status === 'OK' && Number(liveness.messageCode) === 0;
  const curp = input.approvedDocument?.curp || String(document?.curp || '').trim() || null;
  const nombre = input.approvedDocument?.nombre ||
    [document?.nombres || document?.nombre, document?.primerApellido, document?.segundoApellido]
      .filter(Boolean).join(' ').trim() || null;
  return {
    provider: 'NUBARIUM',
    verification_id: String(liveness.validationCode || face.codigoValidacion || randomUUID()),
    verified_at: new Date().toISOString(),
    status: documentValid && faceMatch && live ? 'VALID' : 'INVALID',
    document_validation: { valid: documentValid },
    document_fields: { curp, nombre_completo: nombre },
    face_validation: { match: faceMatch, score },
    liveness: { passed: live, method: 'NUBARIUM_PASSIVE_IMAGE', score: livenessScore },
  };
}
