import { operationalPriorityRank } from '../../../lib/documents/priority';

export type CustomSortField =
  | 'operativo'
  | 'nombre'
  | 'ultimaModificacion'
  | 'fechaCreacion'
  | 'fechaCompletado'
  | 'fechaVencimiento'
  | 'estado';
export type CustomSortDirection = 'asc' | 'desc';

export interface CustomSortableDocument {
  id: string;
  name: string;
  estado: string;
  updatedAt?: string | null;
  ultimaModificacion?: string | null;
  createdAt?: string | null;
  fechaCreacion?: string | null;
  completedAt?: string | null;
  fechaCompletado?: string | null;
  fechaVencimiento?: string | null;
  priority?: unknown;
  esUrgente?: boolean;
}

export interface CustomSortableFolder {
  id: string;
  name: string;
  updatedAt?: string | null;
  createdAt?: string | null;
}

const columnByField: Partial<Record<CustomSortField, string>> = {
  operativo: 'prioridad',
  ultimaModificacion: 'ultimaModificacion',
  fechaCreacion: 'fechaCreacion',
  fechaCompletado: 'fechaCompletado',
  fechaVencimiento: 'fechaVencimiento',
  estado: 'estado',
};

export function availableCustomSortFields(
  visibleColumnIds: readonly string[],
  activeFilterIds: readonly string[],
  foldersOnly: boolean
): CustomSortField[] {
  if (foldersOnly) return ['nombre', 'ultimaModificacion', 'fechaCreacion'];
  const visible = new Set(visibleColumnIds);
  const filters = new Set(activeFilterIds);
  return (
    [
      'operativo',
      'nombre',
      'ultimaModificacion',
      'fechaCreacion',
      'fechaCompletado',
      'fechaVencimiento',
      'estado',
    ] as const
  ).filter((field) => {
    if (field === 'nombre') return true;
    const column = columnByField[field];
    return Boolean(column && (visible.has(column) || filters.has(column)));
  });
}

const nameCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function timestamp(value?: string | null): number {
  if (!value || value === '—') return Number.NaN;
  const local = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?)?/i
  );
  if (local) {
    let hour = Number(local[4] || 0);
    if (local[7]) hour = (hour % 12) + (local[7].toLowerCase() === 'p' ? 12 : 0);
    return new Date(
      Number(local[3]),
      Number(local[2]) - 1,
      Number(local[1]),
      hour,
      Number(local[5] || 0),
      Number(local[6] || 0)
    ).getTime();
  }
  return Date.parse(value);
}

function compareDates(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: CustomSortDirection
): number {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  const leftMissing = !Number.isFinite(leftTime);
  const rightMissing = !Number.isFinite(rightTime);
  if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  if (leftMissing && rightMissing) return 0;
  return direction === 'asc' ? leftTime - rightTime : rightTime - leftTime;
}

export function compareCustomDocuments(
  left: CustomSortableDocument,
  right: CustomSortableDocument,
  field: CustomSortField,
  direction: CustomSortDirection
): number {
  if (field === 'operativo') {
    const difference =
      operationalPriorityRank({
        priority: left.priority,
        legacyUrgent: left.esUrgente,
        expiresAt: left.fechaVencimiento,
      }) -
      operationalPriorityRank({
        priority: right.priority,
        legacyUrgent: right.esUrgente,
        expiresAt: right.fechaVencimiento,
      });
    if (difference) return direction === 'desc' ? difference : -difference;
  } else if (field === 'nombre' || field === 'estado') {
    const difference = nameCollator.compare(
      left[field === 'nombre' ? 'name' : 'estado'],
      right[field === 'nombre' ? 'name' : 'estado']
    );
    if (difference) return direction === 'asc' ? difference : -difference;
  } else {
    const date = (document: CustomSortableDocument) => {
      switch (field) {
        case 'fechaCreacion':
          return document.createdAt || document.fechaCreacion;
        case 'fechaCompletado':
          return document.completedAt || document.fechaCompletado;
        case 'fechaVencimiento':
          return document.fechaVencimiento;
        default:
          return document.updatedAt || document.ultimaModificacion;
      }
    };
    const difference = compareDates(date(left), date(right), direction);
    if (difference) return difference;
  }
  return nameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id);
}

export function compareCustomFolders(
  left: CustomSortableFolder,
  right: CustomSortableFolder,
  field: CustomSortField,
  direction: CustomSortDirection
): number {
  if (field === 'nombre') {
    const difference = nameCollator.compare(left.name, right.name);
    if (difference) return direction === 'asc' ? difference : -difference;
  } else {
    const difference = compareDates(
      field === 'fechaCreacion' ? left.createdAt : left.updatedAt,
      field === 'fechaCreacion' ? right.createdAt : right.updatedAt,
      direction
    );
    if (difference) return difference;
  }
  return nameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id);
}
