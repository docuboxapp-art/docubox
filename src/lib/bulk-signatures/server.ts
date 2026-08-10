import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export class BulkSignatureError extends Error {
  constructor(
    message: string,
    public readonly status = 422
  ) {
    super(message);
    this.name = 'BulkSignatureError';
  }
}

export async function requireBulkSignatureUser(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new BulkSignatureError('Debes iniciar sesion.', 401);
  }
  const { data, error } = await createAnonClient().auth.getUser(authorization.slice(7).trim());
  if (error || !data.user) throw new BulkSignatureError('La sesion no es valida.', 401);
  return data.user;
}

export async function assertBulkWorkspaceAccess(workspaceId: string, userId: string) {
  const { data } = await createServiceClient()
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) throw new BulkSignatureError('No tienes acceso a este espacio de trabajo.', 403);
  return data.role as string;
}

export async function appendBulkCampaignEvent(input: {
  campaignId: string;
  workspaceId: string;
  eventType: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
  request?: NextRequest;
}) {
  const correlationId = input.request?.headers.get('x-correlation-id') || randomUUID();
  const { error } = await createServiceClient()
    .from('bulk_campaign_events')
    .insert({
      campaign_id: input.campaignId,
      workspace_id: input.workspaceId,
      event_type: input.eventType,
      actor_id: input.actorId || null,
      correlation_id: correlationId,
      ip_address: input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: input.request?.headers.get('user-agent') || null,
      metadata: input.metadata || {},
    });
  if (error)
    throw new BulkSignatureError(`No se pudo registrar la auditoria: ${error.message}`, 500);
  return correlationId;
}

export function bulkSignatureErrorResponse(error: unknown) {
  const value = error as { message?: string; status?: number };
  return {
    message: value?.message || 'No fue posible completar la operacion.',
    status: value?.status || 500,
  };
}
