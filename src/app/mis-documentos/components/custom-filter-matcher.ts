export interface CustomFilterDocument {
  estado: string;
  etiquetas: string[];
  ultimaModificacion: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  fechaCreacion?: string | null;
  fechaCompletado?: string | null;
  fechaVencimiento?: string | null;
  esUrgente?: boolean;
  tipoDocumentoId?: string | null;
  participantes?: Array<Record<string, string | undefined>>;
  miSubEstado?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  sourceTemplateId?: string | null;
  sourceFormResponseId?: string | null;
}

export interface CustomFilterIdentity {
  id?: string;
  email?: string;
}

function parseDocumentDate(value?: string | null): Date | null {
  if (!value || value === '—') return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const date = match
    ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesDatePreset(date: Date | null, preset: string, now: Date): boolean {
  if (!preset) return true;
  if (preset === 'sin_completado') return date === null;
  if (!date) return false;
  const start = new Date(now);
  if (preset === 'today') start.setHours(0, 0, 0, 0);
  else if (preset === 'week') start.setDate(start.getDate() - 7);
  else if (preset === 'month') start.setDate(start.getDate() - 30);
  else if (preset === 'year') start.setDate(start.getDate() - 365);
  else return true;
  return date >= start && date <= now;
}

function participantKey(person: Record<string, string | undefined>): string {
  return (
    (person.email || '').trim().toLowerCase() || person.id || person.user_id || person.userId || ''
  );
}

export function matchesOwnedParticipantStatus(
  doc: Pick<CustomFilterDocument, 'ownerId' | 'participantes' | 'fechaVencimiento'>,
  status: string,
  identity: CustomFilterIdentity,
  now = new Date()
): boolean {
  if (!status) return true;
  if (!identity.id || doc.ownerId !== identity.id) return false;

  const email = (identity.email || '').trim().toLowerCase();
  const otherParticipants = (doc.participantes || []).filter((person) => {
    const personEmail = (person.email || '').trim().toLowerCase();
    return (
      person.user_id !== identity.id &&
      person.userId !== identity.id &&
      person.id !== identity.id &&
      (!email || personEmail !== email)
    );
  });
  if (status === 'sin_participantes') return otherParticipants.length === 0;
  if (otherParticipants.length === 0) return false;

  const expiry = parseDocumentDate(doc.fechaVencimiento);
  if (status === 'participacion_vencida') return Boolean(expiry && expiry < now);
  if (status === 'urgente_atencion')
    return Boolean(expiry && expiry >= now && expiry <= new Date(now.getTime() + 72 * 60 * 60 * 1000));
  // The participation summary counts expiry and urgency before individual states.
  if (expiry && expiry <= new Date(now.getTime() + 72 * 60 * 60 * 1000)) return false;

  return otherParticipants.some((person) => {
    const raw = person.sub_estado || 'sin_revisar';
    const normalized: Record<string, string> = {
      firmado: 'firmo',
      rechazado: 'rechazo',
      aprobado: 'aprobo',
      cancelado: 'cancelo',
    };
    return (normalized[raw] || raw) === status;
  });
}

export function matchesCustomDocumentCriteria(
  doc: CustomFilterDocument,
  filters: Record<string, unknown>,
  identity: CustomFilterIdentity,
  now = new Date()
): boolean {
  const selected = (key: string): string[] => {
    const value = filters[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  };
  const single = (key: string): string =>
    typeof filters[key] === 'string' ? (filters[key] as string) : '';

  if (single('estructura') === 'carpeta') return false;

  const origin = single('origen');
  const fromForm = Boolean(doc.sourceFormResponseId);
  const fromTemplate = Boolean(doc.sourceTemplateId);
  if (origin === 'formulario' && !fromForm) return false;
  if (origin === 'plantilla' && (!fromTemplate || fromForm)) return false;
  if (origin === 'documento' && (fromForm || fromTemplate)) return false;

  const status = single('estado');
  const expiry = parseDocumentDate(doc.fechaVencimiento);
  if (status === 'Vencido') {
    if (!expiry || expiry >= now || ['Completado', 'Cancelado', 'Rechazado'].includes(doc.estado))
      return false;
  } else if (status && doc.estado !== status) return false;

  const priority = single('prioridad');
  if (priority === 'urgente' && !doc.esUrgente) return false;
  if (priority === 'normal' && doc.esUrgente) return false;

  const types = selected('tipoDocumento');
  if (types.length && !types.includes(doc.tipoDocumentoId || '')) return false;
  const tags = selected('etiquetas');
  if (tags.length && !doc.etiquetas.some((tag) => tags.includes(String(tag)))) return false;

  const owner = filters.propietario;
  if (owner === 'mios' && doc.ownerId !== identity.id) return false;
  if (Array.isArray(owner) && owner.length) {
    const key =
      doc.ownerId ||
      `sender:${(doc.ownerName || 'Sin identificar').trim().toLocaleLowerCase('es')}`;
    if (!owner.includes(key)) return false;
  }

  const participants = doc.participantes || [];
  const participant = filters.participantes;
  if (participant === 'yo') {
    const email = (identity.email || '').trim().toLowerCase();
    if (
      !participants.some(
        (person) =>
          person.id === identity.id ||
          person.user_id === identity.id ||
          person.userId === identity.id ||
          (email !== '' && (person.email || '').trim().toLowerCase() === email)
      )
    )
      return false;
  } else if (Array.isArray(participant) && participant.length) {
    if (!participants.some((person) => participant.includes(participantKey(person)))) return false;
  }

  const participationStatus = single('estadoParticipacion');
  if (participationStatus === 'ninguna') {
    if (doc.miSubEstado != null) return false;
  } else if (participationStatus === 'urgente_atencion') {
    if (
      !doc.miSubEstado ||
      !expiry ||
      expiry < now ||
      expiry > new Date(now.getTime() + 72 * 60 * 60 * 1000)
    )
      return false;
  } else if (participationStatus === 'participacion_vencida') {
    if (!doc.miSubEstado || !expiry || expiry >= now) return false;
  } else if (participationStatus && doc.miSubEstado !== participationStatus) return false;

  if (!matchesOwnedParticipantStatus(doc, single('estadoParticipantes'), identity, now))
    return false;

  const modification = single('ultimaModificacion') || single('fechaUltimaModificacion');
  if (
    !matchesDatePreset(
      parseDocumentDate(doc.updatedAt || doc.ultimaModificacion),
      modification,
      now
    )
  )
    return false;
  if (
    !matchesDatePreset(
      parseDocumentDate(doc.createdAt || doc.fechaCreacion),
      single('fechaCreacion'),
      now
    )
  )
    return false;
  if (
    !matchesDatePreset(
      parseDocumentDate(doc.completedAt || doc.fechaCompletado),
      single('fechaCompletado'),
      now
    )
  )
    return false;

  const expiryFilter = single('fechaVencimiento');
  if (expiryFilter === 'sin_vencimiento' && expiry) return false;
  if (expiryFilter === 'vencido' && (!expiry || expiry >= now)) return false;
  if (
    expiryFilter === 'proximos' &&
    (!expiry || expiry < now || expiry > new Date(now.getTime() + 72 * 60 * 60 * 1000))
  )
    return false;

  return true;
}
