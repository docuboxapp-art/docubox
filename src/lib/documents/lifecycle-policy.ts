export type DocumentLifecycleRecord = {
  estado?: string | null;
  deleted_at?: string | null;
  trashed_at?: string | null;
  restore_until?: string | null;
  legal_hold?: boolean | null;
  legal_hold_status?: string | null;
  retention_status?: string | null;
  retention_until?: string | null;
  participantes?: unknown;
};

export type DocumentDisposition = {
  legalHoldActive: boolean;
  retentionActive: boolean;
  hasActiveParticipants: boolean;
  isTrashed: boolean;
  withinRecoveryPeriod: boolean;
  canTrash: boolean;
  canCancel: boolean;
  canRestore: boolean;
  canPurgeFromTrash: boolean;
  canDirectPurgeDraft: boolean;
  canDirectPurge: boolean;
  blockingCode:
    | 'NONE'
    | 'LEGAL_HOLD'
    | 'RETENTION_ACTIVE'
    | 'ACTIVE_PARTICIPANTS'
    | 'RECOVERY_PERIOD'
    | 'DOCUMENT_NOT_TRASHED';
};

const ACTIVE_DOCUMENT_STATES = new Set([
  'pendiente',
  'en_proceso',
  'en progreso',
  'sent',
  'in_progress',
  'waiting_signatures',
  'en_espera',
]);

const DRAFT_DOCUMENT_STATES = new Set([
  'borrador',
  'draft',
  'preparing',
  'preparando',
  'en_preparacion',
  'en preparación',
]);

const DIRECT_PURGE_DOCUMENT_STATES = new Set([
  ...DRAFT_DOCUMENT_STATES,
  'cancelado',
  'cancelled',
  'rechazado',
  'rejected',
  'expirado',
  'vencido',
  'expired',
]);

const TERMINAL_PARTICIPANT_STATES = new Set([
  'firmo',
  'firmado',
  'rechazo',
  'rechazado',
  'aprobo',
  'aprobado',
  'cancelo',
  'cancelado',
  'expirado',
  'vencido',
]);

function normalized(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isFuture(value: string | null | undefined, now: Date) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > now.getTime();
}

function hasActiveParticipants(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((participant) => {
    if (!participant || typeof participant !== 'object') return true;
    const source = participant as Record<string, unknown>;
    const state = normalized(source.sub_estado || source.estado || source.status);
    return !TERMINAL_PARTICIPANT_STATES.has(state);
  });
}

export function evaluateDocumentDisposition(
  document: DocumentLifecycleRecord,
  now: Date = new Date()
): DocumentDisposition {
  const estado = normalized(document.estado);
  const legalHoldActive =
    document.legal_hold === true || normalized(document.legal_hold_status) === 'active';
  const retentionActive =
    normalized(document.retention_status) === 'active' || isFuture(document.retention_until, now);
  const isTrashed = Boolean(document.deleted_at || document.trashed_at);
  const recoveryUntil = document.restore_until || null;
  const withinRecoveryPeriod = isTrashed && (recoveryUntil ? isFuture(recoveryUntil, now) : true);
  const activeParticipants = hasActiveParticipants(document.participantes);
  const workflowActive = ACTIVE_DOCUMENT_STATES.has(estado) && activeParticipants;
  const isDraft = DRAFT_DOCUMENT_STATES.has(estado);
  const directPurgeEligibleState = DIRECT_PURGE_DOCUMENT_STATES.has(estado);

  if (legalHoldActive) {
    return {
      legalHoldActive,
      retentionActive,
      hasActiveParticipants: activeParticipants,
      isTrashed,
      withinRecoveryPeriod,
      canTrash: false,
      canCancel: false,
      canRestore: isTrashed,
      canPurgeFromTrash: false,
      canDirectPurgeDraft: false,
      canDirectPurge: false,
      blockingCode: 'LEGAL_HOLD',
    };
  }

  if (retentionActive) {
    return {
      legalHoldActive,
      retentionActive,
      hasActiveParticipants: activeParticipants,
      isTrashed,
      withinRecoveryPeriod,
      canTrash: !isTrashed && !workflowActive,
      canCancel: workflowActive,
      canRestore: isTrashed,
      canPurgeFromTrash: false,
      canDirectPurgeDraft: false,
      canDirectPurge: false,
      blockingCode: 'RETENTION_ACTIVE',
    };
  }

  if (isTrashed) {
    return {
      legalHoldActive,
      retentionActive,
      hasActiveParticipants: activeParticipants,
      isTrashed,
      withinRecoveryPeriod,
      canTrash: false,
      canCancel: false,
      canRestore: true,
      canPurgeFromTrash: !withinRecoveryPeriod,
      canDirectPurgeDraft: false,
      canDirectPurge: false,
      blockingCode: withinRecoveryPeriod ? 'RECOVERY_PERIOD' : 'NONE',
    };
  }

  if (workflowActive) {
    return {
      legalHoldActive,
      retentionActive,
      hasActiveParticipants: activeParticipants,
      isTrashed,
      withinRecoveryPeriod,
      canTrash: false,
      canCancel: true,
      canRestore: false,
      canPurgeFromTrash: false,
      canDirectPurgeDraft: false,
      canDirectPurge: false,
      blockingCode: 'ACTIVE_PARTICIPANTS',
    };
  }

  return {
    legalHoldActive,
    retentionActive,
    hasActiveParticipants: activeParticipants,
    isTrashed,
    withinRecoveryPeriod,
    canTrash: true,
    canCancel: false,
    canRestore: false,
    canPurgeFromTrash: false,
    canDirectPurgeDraft: isDraft,
    canDirectPurge: directPurgeEligibleState && (isDraft || !activeParticipants),
    blockingCode: 'NONE',
  };
}

export function documentDispositionMessage(code: DocumentDisposition['blockingCode']) {
  switch (code) {
    case 'LEGAL_HOLD':
      return 'Este documento está protegido mediante Legal Hold y no puede moverse a Papelera ni eliminarse.';
    case 'RETENTION_ACTIVE':
      return 'Este documento debe conservarse mientras su retención esté vigente.';
    case 'ACTIVE_PARTICIPANTS':
      return 'El documento tiene participantes activos. Cancélalo antes de moverlo a Papelera.';
    case 'RECOVERY_PERIOD':
      return 'El documento permanece disponible para restauración durante 30 días.';
    case 'DOCUMENT_NOT_TRASHED':
      return 'El documento debe estar en Papelera antes de eliminarse definitivamente.';
    default:
      return '';
  }
}
