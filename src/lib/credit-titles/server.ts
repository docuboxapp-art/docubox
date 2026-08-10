import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export class CreditTitleError extends Error {
  constructor(
    message: string,
    public readonly status = 422
  ) {
    super(message);
    this.name = 'CreditTitleError';
  }
}

export async function requireCreditTitleUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer '))
    throw new CreditTitleError('Debes iniciar sesion.', 401);
  const {
    data: { user },
    error,
  } = await createAnonClient().auth.getUser(authorization.slice(7).trim());
  if (error || !user) throw new CreditTitleError('La sesion no es valida.', 401);
  return user;
}

export async function assertCreditTitleWorkspaceAccess(workspaceId: string, userId: string) {
  const { data } = await createServiceClient()
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new CreditTitleError('No tienes acceso a este espacio de trabajo.', 403);
  return data.role as string;
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
    .join(',')}}`;
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function createPublicToken() {
  return randomBytes(32).toString('base64url');
}

export function createPromissoryNoteFolio() {
  return `PG-MX-${new Date().getUTCFullYear()}-${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export function createTitleIdentity() {
  return { internalUuid: randomUUID(), publicToken: createPublicToken() };
}

export async function appendTitleEvent(input: {
  titleId: string;
  workspaceId: string;
  eventType: string;
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'public';
  metadata?: Record<string, unknown>;
  request?: NextRequest;
}) {
  const supabase = createServiceClient();
  const ipAddress = input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const { data, error } = await supabase.rpc('append_credit_title_event', {
    p_title_id: input.titleId,
    p_workspace_id: input.workspaceId,
    p_event_type: input.eventType,
    p_actor_id: input.actorUserId || null,
    p_actor_type: input.actorType || 'user',
    p_metadata: input.metadata || {},
    p_ip_address: ipAddress,
    p_user_agent: input.request?.headers.get('user-agent') || null,
  });
  if (error) throw new CreditTitleError(`No se pudo registrar la evidencia: ${error.message}`, 500);
  return data;
}

export function creditTitleErrorResponse(error: unknown) {
  const value = error as { message?: string; status?: number };
  return {
    message: value?.message || 'No fue posible completar la operacion.',
    status: value?.status || 500,
  };
}
