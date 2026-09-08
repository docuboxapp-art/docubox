import type { NextRequest } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { hashCapabilityToken } from '@/lib/security/capability-token';
export { redactSensitiveText } from './redaction';

export const AI_PROVIDER = 'OPEN_AI' as const;
export const LUCIA_MODEL = 'gpt-4o-mini' as const;
export const EMBEDDING_MODEL = 'text-embedding-3-small' as const;
export const TRANSCRIPTION_MODEL = 'gpt-4o-transcribe' as const;
export const LUCIA_PROMPT_VERSION = 'lucia-phase4-document-intelligence' as const;

export const AI_BODY_LIMITS = {
  ask: 64 * 1024,
  chat: 64 * 1024,
  embed: 24 * 1024,
  audio: 10 * 1024 * 1024,
} as const;

export function hashSecret(value: string) {
  return hashCapabilityToken(value);
}

const PUBLIC_CAPABILITY_PREFIXES = [
  'portal-participante',
  'registro-participante',
  'form',
  'expediente',
  'sala',
  'solicitud',
  'subir-movil',
  'captura-id-movil',
  'enrolamiento',
] as const;

export function redactCapabilityFromRoute(route: string) {
  const [pathname] = route.split('?');
  const segments = pathname.split('/');
  if (segments.length > 2 && PUBLIC_CAPABILITY_PREFIXES.includes(segments[1] as never)) {
    segments[2] = ':token';
  }
  if (['v', 'notificacion', 'invitacion-organizacion'].includes(segments[1])) {
    segments[2] = ':token';
  }
  if (segments[1] === 'verificar-certificacion' && segments[2] === 'c') {
    segments[3] = ':token';
  }
  if (segments[1] === 'verify' && segments[2] === 'promissory-note') {
    segments[3] = ':token';
  }
  return segments.join('/') || '/';
}

export function estimateAiCost(inputTokens?: number | null, outputTokens?: number | null) {
  if (!inputTokens && !outputTokens) return null;
  const inputRate = Number(process.env.LUCIA_INPUT_COST_PER_MILLION || 0);
  const outputRate = Number(process.env.LUCIA_OUTPUT_COST_PER_MILLION || 0);
  return ((inputTokens || 0) * inputRate + (outputTokens || 0) * outputRate) / 1_000_000;
}

export function getRequestIp(request: Request) {
  return (
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export function rejectOversizedRequest(request: Request, limit: number) {
  const declared = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(declared) && declared > limit;
}

export async function readLimitedJson<T>(request: Request, limit: number): Promise<T> {
  if (rejectOversizedRequest(request, limit)) throw new AiRequestError('PAYLOAD_TOO_LARGE', 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > limit) {
    throw new AiRequestError('PAYLOAD_TOO_LARGE', 413);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AiRequestError('INVALID_JSON', 400);
  }
}

export class AiRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message = code
  ) {
    super(message);
  }
}

function accessTokenExpired(accessToken: string) {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1] || '', 'base64url').toString('utf8')
    ) as { exp?: unknown };
    return typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1_000);
  } catch {
    return false;
  }
}

export async function requireAiUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) throw new AiRequestError('UNAUTHORIZED', 401);
  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) throw new AiRequestError('UNAUTHORIZED', 401);
  if (accessTokenExpired(accessToken)) throw new AiRequestError('TOKEN_EXPIRED', 401);
  const { data, error } = await createAnonClient().auth.getUser(accessToken);
  if (error || !data.user) throw new AiRequestError('INVALID_SESSION', 401);
  return { user: data.user, accessToken };
}

type RateLimitInput = {
  request: Request;
  route: string;
  userId?: string | null;
  workspaceId?: string | null;
  tokenGrantId?: string | null;
  limit?: number;
  windowSeconds?: number;
};

export async function enforceAiRateLimits({
  request,
  route,
  userId,
  workspaceId,
  tokenGrantId,
  limit = 30,
  windowSeconds = 60,
}: RateLimitInput) {
  const service = createServiceClient();
  const dimensions = [
    `ip:${getRequestIp(request)}`,
    userId ? `user:${userId}` : null,
    workspaceId ? `workspace:${workspaceId}` : null,
    tokenGrantId ? `grant:${tokenGrantId}` : null,
  ].filter((value): value is string => Boolean(value));

  for (const dimension of dimensions) {
    const { data, error } = await service.rpc('consume_ai_rate_limit', {
      p_key_hash: hashSecret(`${route}:${dimension}`),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new AiRequestError('RATE_LIMIT_UNAVAILABLE', 503);
    if (data !== true) throw new AiRequestError('RATE_LIMITED', 429);
  }
}

export function aiErrorResponse(error: unknown) {
  if (error instanceof AiRequestError) {
    return { status: error.status, body: { error: error.code } };
  }
  return { status: 500, body: { error: 'AI_REQUEST_FAILED' } };
}
