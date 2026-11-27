export type WorkspaceDocumentTab = 'descargas' | 'editar' | 'permisos';

type DocumentActionState = {
  estado?: string | null;
  fecha_completado?: string | null;
  participantes?: unknown;
};

export function isCompletedDocument(estado: string | null | undefined) {
  return estado?.trim().toLowerCase() === 'completado';
}

export function canRenameDocument(document: DocumentActionState) {
  return Boolean(
    document.estado && !isCompletedDocument(document.estado) && !document.fecha_completado
  );
}

function hasSignedParticipant(participants: unknown) {
  if (!Array.isArray(participants)) return false;
  return participants.some((participant) => {
    if (!participant || typeof participant !== 'object') return false;
    const signed = [participant.estado, participant.sub_estado].some(
      (value) =>
        typeof value === 'string' &&
        ['firmo', 'firmó', 'firmado', 'signed'].includes(value.trim().toLowerCase())
    );
    return signed || participant.firma_completada === true || Boolean(participant.fecha_firma);
  });
}

export function canEditDocumentInProgress(document: DocumentActionState) {
  const state = document.estado?.trim().toLowerCase();
  return (
    (state === 'en_proceso' || state === 'en_progreso') &&
    !document.fecha_completado &&
    !hasSignedParticipant(document.participantes)
  );
}
