export type ParticipantRecord = Record<string, unknown>;

export type ParticipationResponseRecord = {
  participante_id?: string | null;
  participante_email?: string | null;
  firma_data?: string | null;
  firma_completada?: boolean | null;
  aprobacion_completada?: boolean | null;
  terminos_aceptados?: boolean | null;
};

export type SignatureEvidenceRecord = {
  captured_by?: string | null;
  participant_email?: string | null;
};

const EFFECTIVE_PARTICIPATION_STATES = new Set([
  'firmo',
  'firmado',
  'aprobo',
  'aprobado',
  'rechazo',
  'rechazado',
  'acepto',
  'aceptado',
  'accepted',
  'identity_verified',
  'evidence_generated',
  'consent_captured',
]);

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function sameEmail(left: unknown, right: unknown) {
  const normalizedLeft = normalized(left);
  return normalizedLeft.length > 0 && normalizedLeft === normalized(right);
}

function participantIds(participant: ParticipantRecord) {
  return [participant.user_id, participant.id].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
}

export function hasEffectiveParticipation(
  participant: ParticipantRecord,
  responses: ParticipationResponseRecord[] = [],
  evidence: SignatureEvidenceRecord[] = []
) {
  if (participant.historical_participation === true) return true;

  const participantState = normalized(
    participant.participation_status ||
      participant.sub_estado ||
      participant.estado ||
      participant.status
  );
  if (EFFECTIVE_PARTICIPATION_STATES.has(participantState)) return true;

  const ids = participantIds(participant);
  const response = responses.find(
    (candidate) =>
      (typeof candidate.participante_id === 'string' && ids.includes(candidate.participante_id)) ||
      sameEmail(candidate.participante_email, participant.email)
  );
  if (
    response?.firma_completada === true ||
    response?.aprobacion_completada === true ||
    response?.terminos_aceptados === true ||
    (typeof response?.firma_data === 'string' && response.firma_data.trim().length > 0)
  ) {
    return true;
  }

  return evidence.some(
    (candidate) =>
      (typeof candidate.captured_by === 'string' && ids.includes(candidate.captured_by)) ||
      sameEmail(candidate.participant_email, participant.email)
  );
}

export function canAccessParticipantRecord(participant: ParticipantRecord) {
  return participant.current_access !== false || participant.historical_participation === true;
}

export function canAccessParticipantDocument(participant: ParticipantRecord) {
  return participant.current_access !== false;
}
