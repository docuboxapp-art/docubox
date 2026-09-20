import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { appendDocumentOperationalEvent } from '@/lib/documents/operational-events';

export const PHASE_B_FEATURE_KEYS = {
  packages: 'document_package_resources',
  requirements: 'participant_document_requirements',
  visibility: 'granular_participant_visibility',
  inPerson: 'in_person_signing',
} as const;

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export async function isPhaseBFeatureEnabled(service: SupabaseClient, featureKey: string) {
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DOCUBOX_PHASE_B_LOCAL_ENABLED !== 'false'
  ) {
    return true;
  }
  const result = await service
    .from('platform_feature_flags')
    .select('global_enabled,rollout_percentage')
    .eq('flag_key', featureKey)
    .maybeSingle();
  if (result.error || !result.data) return false;
  return result.data.global_enabled === true && Number(result.data.rollout_percentage || 0) > 0;
}

export async function ensureDocumentPackage(input: {
  service: SupabaseClient;
  documentId: string;
  workspaceId: string;
  actorUserId: string;
}) {
  const result = await input.service
    .from('document_packages')
    .upsert(
      {
        document_id: input.documentId,
        workspace_id: input.workspaceId,
        created_by: input.actorUserId,
      },
      { onConflict: 'document_id', ignoreDuplicates: true }
    )
    .select('id,document_id,workspace_id')
    .maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return result.data;
  const existing = await input.service
    .from('document_packages')
    .select('id,document_id,workspace_id')
    .eq('document_id', input.documentId)
    .single();
  if (existing.error) throw existing.error;
  return existing.data;
}

export async function resolveParticipantReference(input: {
  service: SupabaseClient;
  documentId: string;
  user: User;
}) {
  const email = input.user.email?.trim().toLowerCase() || '';
  const result = await input.service
    .from('document_participant_references')
    .select('id,document_id,workspace_id,snapshot,active')
    .eq('document_id', input.documentId)
    .eq('active', true)
    .or(
      `participant_user_id.eq.${input.user.id}${email ? `,participant_email_normalized.eq.${email}` : ''}`
    )
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

export async function canUserViewPackageResource(input: {
  service: SupabaseClient;
  documentId: string;
  resourceId: string;
  user: User;
  privileged: boolean;
}) {
  if (input.privileged) return { allowed: true, participant: null };
  const participant = await resolveParticipantReference(input);
  if (!participant) return { allowed: false, participant: null };
  const visibility = await input.service
    .from('document_resource_visibility')
    .select('participant_reference_id,visibility_mode,valid_from,valid_until')
    .eq('document_id', input.documentId)
    .eq('resource_id', input.resourceId);
  if (visibility.error) throw visibility.error;
  if (!visibility.data?.length) return { allowed: true, participant };
  const now = Date.now();
  const allowed = visibility.data.some(
    (item) =>
      item.participant_reference_id === participant.id &&
      item.visibility_mode === 'allow' &&
      (!item.valid_from || Date.parse(item.valid_from) <= now) &&
      (!item.valid_until || Date.parse(item.valid_until) > now)
  );
  return { allowed, participant };
}

export async function appendPackageEvent(input: {
  service: SupabaseClient;
  documentId: string;
  workspaceId: string;
  participantReferenceId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  eventKey: string;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
}) {
  return appendDocumentOperationalEvent(input.service, {
    documentId: input.documentId,
    workspaceId: input.workspaceId,
    participantReferenceId: input.participantReferenceId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    eventKey: input.eventKey,
    correlationId: input.correlationId || randomUUID(),
    source: 'api',
    payload: input.payload,
  });
}

export function phaseBUnavailableResponse() {
  return Response.json(
    { error: 'Esta capacidad todavía no está habilitada.', code: 'FEATURE_DISABLED' },
    { status: 404 }
  );
}
