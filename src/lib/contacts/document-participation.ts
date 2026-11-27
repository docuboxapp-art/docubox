export type DocumentParticipantState = {
  sub_estado?: string | null;
  estado?: string | null;
  status?: string | null;
  participation_status?: string | null;
  visible?: boolean | null;
  current_access?: boolean | null;
};

type DocumentState = {
  estado?: string | null;
  fecha_vencimiento?: string | null;
  tiene_vencimiento?: boolean | null;
};

export type ContactParticipationStatus =
  | 'pendiente'
  | 'sin_revisar'
  | 'en_revision'
  | 'en_espera'
  | 'firmo'
  | 'aprobo'
  | 'completado'
  | 'rechazo'
  | 'cancelo'
  | 'revocado'
  | 'participacion_vencida'
  | 'urgente_atencion'
  | 'sin_accion';

const statusAliases = new Map<string, ContactParticipationStatus>([
  ['pendiente', 'pendiente'],
  ['pending', 'pendiente'],
  ['sin_revisar', 'sin_revisar'],
  ['sin_revision', 'sin_revisar'],
  ['en_revision', 'en_revision'],
  ['en_proceso', 'en_revision'],
  ['en_progreso', 'en_revision'],
  ['en_espera', 'en_espera'],
  ['postergado', 'en_espera'],
  ['postergo', 'en_espera'],
  ['firmo', 'firmo'],
  ['firmado', 'firmo'],
  ['signed', 'firmo'],
  ['aprobo', 'aprobo'],
  ['aprobado', 'aprobo'],
  ['approved', 'aprobo'],
  ['completado', 'completado'],
  ['completed', 'completado'],
  ['participacion_realizada', 'completado'],
  ['rechazo', 'rechazo'],
  ['rechazado', 'rechazo'],
  ['rejected', 'rechazo'],
  ['cancelo', 'cancelo'],
  ['cancelado', 'cancelo'],
  ['cancelled', 'cancelo'],
  ['cancelled_by_document', 'cancelo'],
  ['revocado', 'revocado'],
  ['revoked', 'revocado'],
  ['vencido', 'participacion_vencida'],
  ['expirado', 'participacion_vencida'],
  ['expired', 'participacion_vencida'],
  ['participacion_vencida', 'participacion_vencida'],
  ['urgente_atencion', 'urgente_atencion'],
]);

function normalizeStatus(value?: string | null) {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s-]+/g, '_')
    : '';
}

const pendingStates = new Set<ContactParticipationStatus>([
  'pendiente',
  'sin_revisar',
  'en_revision',
  'en_espera',
  'urgente_atencion',
]);

export function isPendingContactParticipation(status: ContactParticipationStatus) {
  return pendingStates.has(status);
}

export function getContactParticipationStatus(
  participant: DocumentParticipantState,
  document: DocumentState,
  now: number
): ContactParticipationStatus {
  const states = [
    participant.sub_estado,
    participant.estado,
    participant.status,
    participant.participation_status,
  ].map((value) => statusAliases.get(normalizeStatus(value)));
  const outcome = states.find(
    (state) => state === 'firmo' || state === 'aprobo' || state === 'rechazo'
  );
  if (outcome) return outcome;

  const closed = states.find((state) => state && !isPendingContactParticipation(state));
  if (closed) return closed;

  const documentStatus = statusAliases.get(normalizeStatus(document.estado));
  // A rejection by a different participant ends the pending participation.
  if (documentStatus === 'cancelo' || documentStatus === 'rechazo') return 'cancelo';
  if (participant.current_access === false) return 'revocado';
  if (documentStatus === 'completado') return 'sin_accion';

  const deadline =
    document.tiene_vencimiento !== false ? Date.parse(document.fecha_vencimiento || '') : NaN;
  if (documentStatus === 'participacion_vencida' || deadline <= now) return 'participacion_vencida';
  if (
    participant.visible === false ||
    documentStatus === 'en_espera' ||
    states.includes('en_espera')
  )
    return 'en_espera';
  if (deadline <= now + 72 * 60 * 60 * 1_000 || states.includes('urgente_atencion'))
    return 'urgente_atencion';
  return states.find((state) => state && state !== 'pendiente') || 'pendiente';
}
