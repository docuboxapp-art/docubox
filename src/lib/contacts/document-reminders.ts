import {
  getContactParticipationStatus,
  isPendingContactParticipation,
  type DocumentParticipantState,
} from './document-participation';

export type ReminderParticipant = DocumentParticipantState & {
  email?: string | null;
  acto?: string | null;
  role?: string | null;
  rol?: string | null;
  delivery_mode?: string | null;
  fecha_recordatorio?: string | null;
};

type ReminderDocument = Parameters<typeof getContactParticipationStatus>[1] & {
  deleted_at?: string | null;
};

export function reminderAction(participant: ReminderParticipant) {
  switch ((participant.acto || participant.role || participant.rol || '').trim().toLowerCase()) {
    case 'firmante':
    case 'signer':
      return 'Firma pendiente';
    case 'aprobador':
    case 'approver':
      return 'Aprobación pendiente';
    case 'revisor':
    case 'reviewer':
      return 'Revisión pendiente';
    case 'testigo':
      return 'Atestiguamiento pendiente';
    case 'observador':
    case 'observer':
      return null;
    default:
      return 'Participación pendiente';
  }
}

export function canRemindDocumentParticipant(
  participant: ReminderParticipant,
  document: ReminderDocument,
  now: number
) {
  const state = document.estado?.trim().toLowerCase();
  if (
    (state !== 'en_proceso' && state !== 'en_progreso') ||
    document.deleted_at ||
    !participant.email?.trim() ||
    participant.visible === false ||
    participant.delivery_mode === 'in_person' ||
    !reminderAction(participant)
  )
    return false;
  const status = getContactParticipationStatus(participant, document, now);
  return status !== 'en_espera' && isPendingContactParticipation(status);
}

export function reminderSentToday(sentAt: string | null | undefined, now: number) {
  const sent = Date.parse(sentAt || '');
  return Math.floor(sent / 86_400_000) === Math.floor(now / 86_400_000);
}
