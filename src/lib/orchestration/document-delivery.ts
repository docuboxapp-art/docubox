import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isEmailNotificationEnabled,
  sendParticipantInvitationEmails,
} from '@/lib/emailNotifications';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { getParticipantPortalUrl } from '@/lib/publicAppUrl';

export type DeliveryParticipant = Record<string, unknown> & {
  id?: string;
  user_id?: string | null;
  email?: string;
  name?: string;
  isCurrentUser?: boolean;
  visible?: boolean;
  delivery_mode?: string;
  tipoNotificacion?: string[];
  portal_token?: string;
  participant_ref_id?: string;
};

export async function deliverDocumentInvitations(
  service: SupabaseClient,
  input: {
    documentId: string;
    workspaceId: string;
    ownerId: string;
    documentName: string;
    documentDescription?: string | null;
    participants: DeliveryParticipant[];
    eventType?: string;
  }
) {
  const owner = await service
    .from('user_profiles')
    .select('full_name,email')
    .eq('id', input.ownerId)
    .maybeSingle();
  if (owner.error) throw owner.error;
  const senderName = owner.data?.full_name || owner.data?.email || 'Docubox';
  let eligible = input.participants.filter(
    (participant) =>
      participant.visible && !participant.isCurrentUser && participant.delivery_mode !== 'in_person'
  );

  const participantReferences = eligible
    .map((participant) => participant.participant_ref_id)
    .filter((value): value is string => Boolean(value));
  if (participantReferences.length) {
    const delegations = await service
      .from('document_participant_delegations')
      .select('id,original_participant_reference_id,delegate_user_id')
      .eq('document_id', input.documentId)
      .eq('workspace_id', input.workspaceId)
      .eq('status', 'active')
      .in('original_participant_reference_id', participantReferences);
    if (
      delegations.error &&
      !['42P01', 'PGRST205'].includes(String(delegations.error.code || ''))
    ) {
      throw delegations.error;
    }
    const rows = delegations.data || [];
    if (rows.length) {
      const profiles = await service
        .from('user_profiles')
        .select('id,full_name,email')
        .in(
          'id',
          rows.map((row) => row.delegate_user_id)
        );
      if (profiles.error) throw profiles.error;
      const profileById = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
      const delegationByReference = new Map(
        rows.map((row) => [row.original_participant_reference_id, row])
      );
      eligible = eligible.map((participant) => {
        const delegation = delegationByReference.get(participant.participant_ref_id || '');
        const profile = delegation ? profileById.get(delegation.delegate_user_id) : null;
        return profile
          ? {
              ...participant,
              user_id: profile.id,
              email: profile.email,
              name: profile.full_name || profile.email,
              delegated_from_participant_ref_id: participant.participant_ref_id,
            }
          : participant;
      });
    }
  }

  for (const participant of eligible) {
    if (!participant.user_id) continue;
    const signingUrl = getParticipantPortalUrl(participant.portal_token || input.documentId);
    await createNotificationServer({
      userId: participant.user_id,
      type: 'document',
      eventType: input.eventType || 'signature.requested',
      category: 'SIGNATURE',
      severity: 'warning',
      workspaceId: input.workspaceId,
      actorUserId: input.ownerId,
      entityType: 'document',
      entityId: input.documentId,
      actionUrl: signingUrl,
      actionLabel: 'Revisar y firmar',
      deduplicationKey: `${input.eventType || 'signature.requested'}:${input.documentId}:${participant.id || participant.user_id}`,
      title:
        input.eventType === 'workflow.step_available'
          ? 'Es tu turno de participar en un documento'
          : 'Has sido invitado a participar en un documento',
      description: `${senderName} requiere tu participación en "${input.documentName}".`,
      priority: 'alta',
      metadata: { documentoId: input.documentId, documentName: input.documentName, senderName },
    });
  }

  const emailParticipants = eligible.filter(
    (participant) =>
      participant.email?.includes('@') && isEmailNotificationEnabled(participant.tipoNotificacion)
  );
  if (!emailParticipants.length) return { attempted: 0, sent: [], failed: [] };
  return sendParticipantInvitationEmails({
    participants: emailParticipants.map((participant) => ({
      ...participant,
      documentUrl: getParticipantPortalUrl(participant.portal_token || input.documentId),
    })) as Parameters<typeof sendParticipantInvitationEmails>[0]['participants'],
    documentId: input.documentId,
    documentName: input.documentName,
    documentDescription: input.documentDescription || undefined,
    senderName,
    documentUrl: getParticipantPortalUrl(input.documentId),
  });
}

export function stampDeliveredParticipants(
  participants: DeliveryParticipant[],
  deliveredEmails: string[],
  at: string
) {
  const delivered = new Set(deliveredEmails.map((email) => email.trim().toLowerCase()));
  return participants.map((participant) =>
    delivered.has(
      String(participant.email || '')
        .trim()
        .toLowerCase()
    )
      ? { ...participant, notificado: true, fecha_notificacion: at }
      : participant
  );
}
