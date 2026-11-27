import {
  compareListDates,
  compareTableValues,
  tableDate,
  type TableSortValue,
} from '../workspaces/list-order';

export type ActivityKind = 'formularios' | 'expedientes';
export type ActivityMode = 'received' | 'sent';
export type ActivityState =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'scheduled'
  | 'observed'
  | 'signature'
  | 'paused'
  | 'failed';
export type ActivitySource = 'form-token' | 'form-public' | 'case-invitation';
export type ActivityAction = {
  label: string;
  href?: string;
  open?: { source: ActivitySource; id: string };
  disabledReason?: string;
};
export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  title: string;
  reference: string;
  workspace: string;
  workspaceId: string;
  person: string;
  email: string;
  role: string;
  state: ActivityState;
  stateLabel: string;
  sentAt: string;
  updatedAt: string;
  expiresAt: string | null;
  scheduledAt?: string | null;
  access: 'private' | 'public';
  priority: string;
  progress: number | null;
  detail: string;
  actions: ActivityAction[];
};
export const ACTIVITY_STATE_LABELS: Record<ActivityState, string> = {
  pending: 'Pendientes',
  in_progress: 'En progreso',
  completed: 'Completados',
  expired: 'Vencidos',
  cancelled: 'Cancelados',
  scheduled: 'Programados',
  observed: 'Con observaciones',
  signature: 'Pendientes de firma',
  paused: 'Pausados',
  failed: 'Problemas de envío',
};
export const activityTime = (value?: string | null) => (value ? Date.parse(value) || 0 : 0);
export type ActivityDateField = 'sent' | 'updated' | 'expires' | 'scheduled';
export function activityDate(item: ActivityItem, field: ActivityDateField = 'sent') {
  return field === 'updated'
    ? item.updatedAt
    : field === 'expires'
      ? item.expiresAt
      : field === 'scheduled'
        ? item.scheduledAt || null
        : item.sentAt;
}

const activitySortValues: Readonly<Record<string, (item: ActivityItem) => TableSortValue>> = {
  title: (item) => item.title,
  person: (item) => item.person,
  state: (item) => item.stateLabel,
  sent: (item) => tableDate(item.sentAt),
  progress: (item) => item.progress,
};

export function matchesActivityState(item: ActivityItem, state: string, now = Date.now()) {
  const terminal = ['completed', 'expired', 'cancelled'].includes(item.state);
  if (state === 'active')
    return ['pending', 'in_progress', 'signature', 'observed'].includes(item.state);
  if (state === 'urgent') return !terminal && item.priority === 'urgent';
  if (state === 'due') {
    const expires = activityTime(item.expiresAt);
    return !terminal && expires > now && expires <= now + 72 * 60 * 60 * 1000;
  }
  return !state || item.state === state;
}
export const recipientKey = (formId: string, email: string) =>
  `${formId}:${email.trim().toLowerCase()}`;

export function ownsRecipient(
  user: { id: string; email: string },
  recipient: { recipient_user_id?: string | null; recipient_email: string }
) {
  return recipient.recipient_user_id
    ? recipient.recipient_user_id === user.id
    : recipient.recipient_email.trim().toLowerCase() === user.email.trim().toLowerCase();
}

export const isFormResponseDraft = (status?: string) =>
  status === 'draft' || status === 'started' || status === 'in_progress';

export function formActivityState(
  input: {
    responseStatus?: string;
    submittedAt?: string | null;
    usedAt?: string | null;
    requiresSignature: boolean;
    expiresAt?: string | null;
    templateStatus: string;
    scheduledStatus?: string;
    scheduledAt?: string | null;
  },
  now: number
): { state: ActivityState; stateLabel: string } {
  if (input.scheduledStatus === 'cancelled')
    return { state: 'cancelled', stateLabel: 'Envío cancelado' };
  if (['scheduled', 'pending', 'processing', 'retrying'].includes(input.scheduledStatus || ''))
    return {
      state: 'scheduled',
      stateLabel:
        input.scheduledStatus === 'processing'
          ? 'Procesando envío'
          : input.scheduledStatus === 'retrying'
            ? 'Reintentando envío'
            : 'Envío programado',
    };
  if (input.scheduledStatus === 'failed') return { state: 'failed', stateLabel: 'Error de envío' };
  if (input.responseStatus === 'cancelled')
    return { state: 'cancelled', stateLabel: 'Respuesta cancelada' };
  if (input.responseStatus === 'rejected')
    return { state: 'observed', stateLabel: 'Respuesta rechazada' };
  const draft = isFormResponseDraft(input.responseStatus);
  if (
    input.responseStatus === 'signed' ||
    (!draft && input.submittedAt && !input.requiresSignature)
  )
    return {
      state: 'completed',
      stateLabel: input.requiresSignature ? 'Respuesta firmada' : 'Respondido',
    };
  if (!draft && (input.submittedAt || input.usedAt))
    return input.requiresSignature
      ? { state: 'signature', stateLabel: 'Pendiente de firma' }
      : { state: 'in_progress', stateLabel: 'Procesando respuesta' };
  if (input.expiresAt && activityTime(input.expiresAt) <= now)
    return { state: 'expired', stateLabel: 'Invitación vencida' };
  if (input.templateStatus !== 'published')
    return {
      state: 'paused',
      stateLabel:
        input.templateStatus === 'archived' ? 'Formulario archivado' : 'Formulario pausado',
    };
  if (draft)
    return { state: 'in_progress', stateLabel: 'Respuesta en progreso' };
  return { state: 'pending', stateLabel: 'Pendiente de respuesta' };
}

export function filterActivity(
  items: ActivityItem[],
  criteria: {
    search: string;
    state: string;
    access?: string;
    workspace?: string;
    from: string;
    to: string;
    sort: string;
    priority?: string;
    dateField?: ActivityDateField;
    period?: string;
  },
  now = Date.now()
) {
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es');
  const search = normalize(criteria.search.trim());
  const hasPeriod = !!criteria.period && criteria.period !== 'all';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (criteria.period && ['7', '30', '365'].includes(criteria.period))
    start.setDate(start.getDate() - (Number(criteria.period) - 1));
  const sortField = criteria.sort.slice(0, criteria.sort.lastIndexOf('_'));
  const readSortValue = Object.hasOwn(activitySortValues, sortField)
    ? activitySortValues[sortField]
    : undefined;
  const sortDirection = criteria.sort.endsWith('_desc') ? 'desc' : 'asc';
  return items
    .filter(
      (item) =>
        (!search ||
          normalize(
            [item.title, item.reference, item.person, item.email, item.role].join(' ')
          ).includes(search)) &&
        matchesActivityState(item, criteria.state, now) &&
        (!criteria.priority || item.priority === criteria.priority) &&
        (!criteria.access || item.access === criteria.access) &&
        (!criteria.workspace || item.workspaceId === criteria.workspace) &&
        (!criteria.from ||
          activityTime(activityDate(item, criteria.dateField)) >=
            Date.parse(`${criteria.from}T00:00:00`)) &&
        (!criteria.to ||
          (activityTime(activityDate(item, criteria.dateField)) > 0 &&
            activityTime(activityDate(item, criteria.dateField)) <=
              Date.parse(`${criteria.to}T23:59:59.999`))) &&
        (!hasPeriod ||
          (activityTime(activityDate(item, criteria.dateField)) >= start.getTime() &&
            activityTime(activityDate(item, criteria.dateField)) <= now))
    )
    .sort((a, b) => {
      if (readSortValue) {
        return (
          compareTableValues(readSortValue(a), readSortValue(b), sortDirection) ||
          a.title.localeCompare(b.title, 'es') ||
          a.id.localeCompare(b.id)
        );
      }
      if (criteria.sort === 'urgent') {
        const byUrgency = Number(b.priority === 'urgent') - Number(a.priority === 'urgent');
        if (byUrgency) return byUrgency;
      }
      if (criteria.sort !== 'name') {
        const byDate = compareListDates(
          activityDate(a, criteria.dateField),
          activityDate(b, criteria.dateField),
          criteria.sort === 'oldest' ? 'asc' : 'desc'
        );
        if (byDate) return byDate;
      }
      return a.title.localeCompare(b.title, 'es') || a.id.localeCompare(b.id);
    });
}
