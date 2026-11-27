import 'server-only';

import { activityTime, type ActivityState } from './model';

type CaseInvitation = {
  case_file_id: string;
  workspace_id: string;
  recipient: string;
  not_before: string;
  expires_at: string;
  revoked_at: string | null;
};

type CaseAccess = { id: string; workspace_id: string; status: string };

export type CaseInvitationParticipant = {
  id: string;
  case_file_id: string;
  workspace_id: string;
  user_id: string | null;
  status: string;
};

type CaseInvitationBlock = {
  state: ActivityState;
  stateLabel: string;
  reason: string;
  httpStatus: number;
};

export function caseInvitationTiming(invitation: CaseInvitation, now: number): CaseInvitationBlock | null {
  if (invitation.revoked_at)
    return {
      state: 'cancelled', stateLabel: 'Invitación revocada',
      reason: 'La invitación al expediente fue revocada.', httpStatus: 410,
    };
  if (activityTime(invitation.expires_at) <= now)
    return {
      state: 'expired', stateLabel: 'Invitación vencida',
      reason: 'La invitación al expediente venció.', httpStatus: 410,
    };
  if (activityTime(invitation.not_before) > now)
    return {
      state: 'scheduled', stateLabel: 'Envío programado',
      reason: 'El envío del expediente todavía está programado.', httpStatus: 409,
    };
  return null;
}

export function caseInvitationBlock(
  invitation: CaseInvitation,
  actor: { id: string; email: string },
  caseFile: CaseAccess | undefined,
  participant: CaseInvitationParticipant | undefined,
  now: number
): CaseInvitationBlock | null {
  const timing = caseInvitationTiming(invitation, now);
  if (timing) return timing;

  if (
    !caseFile || !participant || caseFile.workspace_id !== invitation.workspace_id ||
    participant.workspace_id !== caseFile.workspace_id || participant.case_file_id !== caseFile.id
  ) return {
    state: 'cancelled', stateLabel: 'Participación no disponible',
    reason: 'La participación en este expediente ya no está disponible.', httpStatus: 410,
  };
  if (
    invitation.recipient.trim().toLowerCase() !== actor.email ||
    (participant.user_id && participant.user_id !== actor.id)
  ) return {
    state: 'cancelled', stateLabel: 'Participación no disponible',
    reason: 'Esta participación no está disponible para tu cuenta.', httpStatus: 403,
  };
  if (caseFile.status === 'cancelled') return {
    state: 'cancelled', stateLabel: 'Expediente cancelado',
    reason: 'El expediente fue cancelado.', httpStatus: 410,
  };
  if (participant.status === 'cancelled' || participant.status === 'revoked') return {
    state: 'cancelled', stateLabel: 'Participación no disponible',
    reason: 'La participación en este expediente ya no está activa.', httpStatus: 410,
  };
  return null;
}
