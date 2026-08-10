import { createHash, randomBytes, randomInt } from 'crypto';
import type { NextRequest } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export class NotificaError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
    this.name = 'NotificaError';
  }
}

export async function requireNotificaUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new NotificaError('Debes iniciar sesion.', 401);
  const { data: { user }, error } = await createAnonClient().auth.getUser(authorization.slice(7).trim());
  if (error || !user) throw new NotificaError('La sesion no es valida.', 401);
  return user;
}

export async function assertWorkspaceAccess(workspaceId: string, userId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (!data) throw new NotificaError('No tienes acceso a este espacio de trabajo.', 403);
  return data.role as string;
}

export function createNotificationFolio() {
  return `NTF-${new Date().getUTCFullYear()}-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}

export function createAccessToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export async function appendNotificationEvent(input: {
  notificationId: string;
  workspaceId: string;
  eventType: string;
  label: string;
  actorUserId?: string | null;
  actorLabel: string;
  metadata?: Record<string, unknown>;
  request?: NextRequest;
}) {
  const supabase = createServiceClient();
  const { data: previous } = await supabase.from('notification_evidence_events').select('sequence_no,event_hash').eq('notification_id', input.notificationId).order('sequence_no', { ascending: false }).limit(1).maybeSingle();
  const sequenceNo = (previous?.sequence_no || 0) + 1;
  const occurredAt = new Date().toISOString();
  const metadata = input.metadata || {};
  const eventHash = sha256(JSON.stringify({ notificationId: input.notificationId, sequenceNo, eventType: input.eventType, label: input.label, actorUserId: input.actorUserId || null, actorLabel: input.actorLabel, occurredAt, metadata, previousHash: previous?.event_hash || null }));
  const forwarded = input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const { error } = await supabase.from('notification_evidence_events').insert({
    workspace_id: input.workspaceId,
    notification_id: input.notificationId,
    sequence_no: sequenceNo,
    event_type: input.eventType,
    label: input.label,
    actor_user_id: input.actorUserId || null,
    actor_label: input.actorLabel,
    ip_address: forwarded || null,
    user_agent: input.request?.headers.get('user-agent') || null,
    metadata,
    previous_hash: previous?.event_hash || null,
    event_hash: eventHash,
    occurred_at: occurredAt,
  });
  if (error) throw new NotificaError(`No se pudo registrar la evidencia: ${error.message}`, 500);
  await supabase.from('certified_notifications').update({ last_event_label: input.label, updated_at: occurredAt }).eq('id', input.notificationId);
  return { sequenceNo, eventHash, occurredAt };
}

export function errorResponse(error: unknown) {
  const value = error as { message?: string; status?: number };
  return { message: value?.message || 'No fue posible completar la operacion.', status: value?.status || 500 };
}
