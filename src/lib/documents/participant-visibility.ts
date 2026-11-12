export type ParticipantRecord = Record<string, unknown>;

export type ParticipationResponseRecord = {
  participante_id?: string | null;
  participante_email?: string | null;
  firma_data?: string | null;
  firma_completada?: boolean | null;
  aprobacion_completada?: boolean | null;
  terminos_aceptados?: boolean | null;
  consent_accepted?: boolean | null;
  campos_completados?: unknown[] | null;
};

export type ParticipantActivityRecord = {
  actor_id?: string | null;
  actor_email?: string | null;
  action?: string | null;
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
  _evidence: SignatureEvidenceRecord[] = []
) {
  if (participant.historical_participation === true) return true;

  const states = [
    participant.participation_status,
    participant.sub_estado,
    participant.estado,
    participant.status,
  ];
  if (states.some((state) => EFFECTIVE_PARTICIPATION_STATES.has(normalized(state)))) {
    return true;
  }

  const ids = participantIds(participant);
  return responses.some(
    (candidate) =>
      ((typeof candidate.participante_id === 'string' && ids.includes(candidate.participante_id)) ||
        sameEmail(candidate.participante_email, participant.email)) &&
      (candidate.firma_completada === true || candidate.aprobacion_completada === true)
  );
}

// "En revisión" is the initial state of new invitations. Only persisted
// evidence of an actual visit or action makes an invitation non-revocable.
export function hasPriorParticipantInteraction(
  participant: ParticipantRecord,
  responses: ParticipationResponseRecord[] = [],
  activity: ParticipantActivityRecord[] = []
) {
  if (hasEffectiveParticipation(participant, responses)) return true;
  if (participant.fecha_participacion || participant.fecha_firma || participant.fecha_rechazo)
    return true;

  const ids = participantIds(participant);
  const matches = (id: unknown, email: unknown) =>
    (typeof id === 'string' && ids.includes(id)) || sameEmail(email, participant.email);

  if (responses.some((response) =>
    matches(response.participante_id, response.participante_email) && (
      response.terminos_aceptados === true ||
      response.consent_accepted === true ||
      Boolean(response.firma_data) ||
      (Array.isArray(response.campos_completados) && response.campos_completados.length > 0)
    )
  )) return true;

  return activity.some((event) =>
    matches(event.actor_id, event.actor_email) &&
    !new Set(['invitacion_enviada', 'invitacion_reenviada', 'recordatorio_enviado'])
      .has(normalized(event.action))
  );
}

export function canAccessParticipantRecord(participant: ParticipantRecord) {
  return participant.current_access !== false || participant.historical_participation === true;
}

export function canAccessParticipantDocument(participant: ParticipantRecord) {
  return participant.current_access !== false;
}
