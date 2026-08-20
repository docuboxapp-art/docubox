import { createHash, randomBytes } from 'crypto';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export { organizationApiFailure as certificaApiFailure };

export function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

export function createCertificationFolio() {
  const year = new Date().getUTCFullYear();
  return `DBX-CERT-${year}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function safeFilename(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 140) || 'documento';
}

export function hashRequestContext(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const agent = request.headers.get('user-agent') || 'unknown';
  return { ipHash: sha256(forwarded), userAgentHash: sha256(agent) };
}

export async function appendCertificationEvent({
  service,
  certificationId,
  workspaceId,
  actorId,
  eventType,
  result = 'success',
  payload = {},
}: {
  service: SupabaseClient;
  certificationId: string;
  workspaceId: string;
  actorId?: string | null;
  eventType: string;
  result?: 'success' | 'failed' | 'pending' | 'denied';
  payload?: Record<string, unknown>;
}) {
  const { data: previous } = await service
    .from('certification_case_events')
    .select('sequence_number,event_hash')
    .eq('certification_id', certificationId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sequence = Number(previous?.sequence_number || 0) + 1;
  const occurredAt = new Date().toISOString();
  const eventHash = sha256(JSON.stringify({
    certificationId,
    sequence,
    eventType,
    actorId: actorId || null,
    result,
    payload,
    previousEventHash: previous?.event_hash || null,
    occurredAt,
  }));
  const { error } = await service.from('certification_case_events').insert({
    certification_id: certificationId,
    workspace_id: workspaceId,
    sequence_number: sequence,
    event_type: eventType,
    actor_id: actorId || null,
    result,
    payload,
    previous_event_hash: previous?.event_hash || null,
    event_hash: eventHash,
    occurred_at: occurredAt,
  });
  if (error) throw new OrganizationApiError(500, 'audit_event_failed', 'No se pudo registrar la auditoria de la operacion.');
}

export async function requireCertification(service: SupabaseClient, id: string, workspaceId: string) {
  const { data, error } = await service
    .from('certification_cases')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new OrganizationApiError(404, 'certification_not_found', 'No se encontro la certificacion.');
  return data;
}

