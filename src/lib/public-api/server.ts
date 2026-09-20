import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import {
  consumeServerRateLimit,
  ServerRateLimitUnavailableError,
} from '@/lib/security/server-rate-limit';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';

const SCOPE_ALIASES: Record<string, string> = {
  'documents:read': 'documents.read',
  'documents:write': 'documents.write',
  'documents:send': 'documents.send',
  'documents:schedule': 'documents.schedule',
  'evidence:read': 'evidence.read',
  'webhooks:manage': 'webhooks.manage',
};

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type PublicApiContext = {
  service: SupabaseClient;
  credential: {
    id: string;
    workspace_id: string;
    created_by: string;
    scopes: string[];
    environment: string;
  };
};

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function hasScope(scopes: string[], requested: string) {
  const normalized = new Set(scopes.map((scope) => SCOPE_ALIASES[scope] || scope));
  return normalized.has(requested) || normalized.has('*');
}

export async function authorizePublicApi(
  request: Request,
  scope: string,
  rate: { limit?: number; windowSeconds?: number } = {}
): Promise<PublicApiContext> {
  const service = createServiceClient();
  if (!(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.publicApi))) {
    throw new PublicApiError(503, 'feature_disabled', 'La API publica no esta habilitada.');
  }
  const token = bearerToken(request);
  if (!token || token.length > 300) {
    throw new PublicApiError(401, 'invalid_api_key', 'La credencial no es valida.');
  }
  const secretHash = createHash('sha256').update(token).digest('hex');
  const lookup = await service
    .from('organization_api_credentials')
    .select('id,workspace_id,created_by,scopes,environment,status,expires_at')
    .eq('secret_hash', secretHash)
    .eq('status', 'active')
    .maybeSingle();
  if (lookup.error || !lookup.data) {
    throw new PublicApiError(401, 'invalid_api_key', 'La credencial no es valida.');
  }
  if (lookup.data.expires_at && new Date(lookup.data.expires_at).getTime() <= Date.now()) {
    await service
      .from('organization_api_credentials')
      .update({ status: 'expired' })
      .eq('id', lookup.data.id)
      .eq('status', 'active');
    throw new PublicApiError(401, 'api_key_expired', 'La credencial expiro.');
  }
  const scopes = Array.isArray(lookup.data.scopes) ? lookup.data.scopes : [];
  if (!hasScope(scopes, scope)) {
    throw new PublicApiError(
      403,
      'insufficient_scope',
      'La credencial no autoriza esta operacion.'
    );
  }
  try {
    const allowed = await consumeServerRateLimit({
      scope: `public-api-v1:${scope}`,
      identifiers: [lookup.data.workspace_id, lookup.data.id],
      limit: rate.limit || 120,
      windowSeconds: rate.windowSeconds || 60,
    });
    if (!allowed) throw new PublicApiError(429, 'rate_limit_exceeded', 'Limite temporal excedido.');
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    if (error instanceof ServerRateLimitUnavailableError) {
      throw new PublicApiError(503, 'rate_limit_unavailable', 'La operacion no esta disponible.');
    }
    throw error;
  }
  await service
    .from('organization_api_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', lookup.data.id);
  return {
    service,
    credential: {
      id: lookup.data.id,
      workspace_id: lookup.data.workspace_id,
      created_by: lookup.data.created_by,
      scopes,
      environment: lookup.data.environment,
    },
  };
}

export async function assertPublicApiDocument(context: PublicApiContext, documentId: string) {
  const result = await context.service
    .from('documentos')
    .select(
      'id,workspace_id,owner_id,nombre,descripcion,estado,participantes,fecha_vencimiento,tiene_vencimiento,created_at,updated_at'
    )
    .eq('id', documentId)
    .eq('workspace_id', context.credential.workspace_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new PublicApiError(404, 'document_not_found', 'Documento no encontrado.');
  return result.data;
}

export function publicApiResponse(cause: unknown) {
  const error = cause as Partial<PublicApiError>;
  const status = typeof error.status === 'number' ? error.status : 500;
  const code = typeof error.code === 'string' ? error.code : 'internal_error';
  return Response.json(
    {
      error: {
        code,
        message: status >= 500 ? 'No se pudo completar la operacion.' : error.message,
      },
    },
    { status }
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export async function beginPublicApiIdempotency(
  context: PublicApiContext,
  request: Request,
  operation: string,
  payload: unknown
) {
  const key = request.headers.get('idempotency-key')?.trim() || '';
  if (!key || key.length > 200) {
    throw new PublicApiError(400, 'idempotency_key_required', 'Idempotency-Key es obligatorio.');
  }
  const requestHash = createHash('sha256')
    .update(JSON.stringify(canonicalize(payload ?? null)))
    .digest('hex');
  const inserted = await context.service
    .from('public_api_idempotency_records')
    .insert({
      workspace_id: context.credential.workspace_id,
      credential_id: context.credential.id,
      operation,
      idempotency_key: key,
      request_hash: requestHash,
    })
    .select('id')
    .maybeSingle();
  if (!inserted.error && inserted.data) return { id: inserted.data.id, replay: null };
  if (inserted.error?.code !== '23505') throw inserted.error;
  const existing = await context.service
    .from('public_api_idempotency_records')
    .select('id,request_hash,status,response_status,response_body,updated_at')
    .eq('credential_id', context.credential.id)
    .eq('operation', operation)
    .eq('idempotency_key', key)
    .single();
  if (existing.error) throw existing.error;
  if (existing.data.request_hash !== requestHash) {
    throw new PublicApiError(
      409,
      'idempotency_conflict',
      'La llave ya fue usada con otra solicitud.'
    );
  }
  if (existing.data.status === 'completed') {
    return {
      id: existing.data.id,
      replay: Response.json(existing.data.response_body || {}, {
        status: existing.data.response_status || 200,
        headers: { 'Idempotency-Replayed': 'true' },
      }),
    };
  }
  const staleProcessing =
    existing.data.status === 'processing' &&
    Date.now() - new Date(existing.data.updated_at).getTime() > 5 * 60 * 1000;
  if (existing.data.status === 'failed' || staleProcessing) {
    const reclaimed = await context.service
      .from('public_api_idempotency_records')
      .update({ status: 'processing', response_status: null, response_body: null })
      .eq('id', existing.data.id)
      .eq('credential_id', context.credential.id)
      .eq('status', existing.data.status)
      .select('id')
      .maybeSingle();
    if (reclaimed.error) throw reclaimed.error;
    if (reclaimed.data) return { id: reclaimed.data.id, replay: null };
  }
  throw new PublicApiError(
    409,
    'request_in_progress',
    'La solicitud equivalente sigue en proceso.'
  );
}

export async function completePublicApiIdempotency(
  context: PublicApiContext,
  recordId: string,
  status: number,
  body: Record<string, unknown>
) {
  const result = await context.service
    .from('public_api_idempotency_records')
    .update({ status: 'completed', response_status: status, response_body: body })
    .eq('id', recordId)
    .eq('credential_id', context.credential.id);
  if (result.error) throw result.error;
}

export async function failPublicApiIdempotency(context: PublicApiContext, recordId: string) {
  const result = await context.service
    .from('public_api_idempotency_records')
    .update({ status: 'failed', response_status: null, response_body: null })
    .eq('id', recordId)
    .eq('credential_id', context.credential.id)
    .eq('status', 'processing');
  if (result.error) throw result.error;
}
