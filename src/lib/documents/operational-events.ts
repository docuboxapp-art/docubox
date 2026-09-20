import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentOperationalEventInput = {
  documentId: string;
  workspaceId?: string | null;
  participantReferenceId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  eventKey: string;
  correlationId?: string | null;
  causationId?: string | null;
  source?: 'api' | 'database' | 'worker' | 'system';
  payload?: Record<string, unknown>;
};

function uuidOrNull(value: string | null | undefined) {
  return value && UUID_PATTERN.test(value) ? value : null;
}

export async function appendDocumentOperationalEvent(
  service: SupabaseClient,
  input: DocumentOperationalEventInput
) {
  if (!UUID_PATTERN.test(input.documentId)) throw new Error('INVALID_DOCUMENT_EVENT_DOCUMENT');
  if (!/^[a-z][a-z0-9_.-]{2,120}$/.test(input.eventType)) {
    throw new Error('INVALID_DOCUMENT_EVENT_TYPE');
  }
  const eventKey = input.eventKey.trim().slice(0, 240);
  if (!eventKey) throw new Error('INVALID_DOCUMENT_EVENT_KEY');

  const inserted = await service
    .from('document_operational_events')
    .insert({
      document_id: input.documentId,
      workspace_id: uuidOrNull(input.workspaceId),
      participant_reference_id: uuidOrNull(input.participantReferenceId),
      actor_user_id: uuidOrNull(input.actorUserId),
      event_type: input.eventType,
      event_key: eventKey,
      correlation_id: uuidOrNull(input.correlationId) || randomUUID(),
      causation_id: uuidOrNull(input.causationId),
      source: input.source || 'api',
      payload: input.payload || {},
    })
    .select('id,correlation_id')
    .maybeSingle();
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
  return {
    created: Boolean(inserted.data),
    id: inserted.data?.id || null,
    correlationId: inserted.data?.correlation_id || uuidOrNull(input.correlationId),
  };
}
