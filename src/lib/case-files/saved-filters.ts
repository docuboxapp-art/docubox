import { parseCaseFilters } from './consultation-filters';
import { CUSTOM_FILTER_ICON_OPTIONS } from '@/lib/filters/custom-filter-icons';
import { caseOrderOptions } from './consultation-order';

export type CaseFilterValues = {
  category: string;
  subtype: string;
  responsible: string;
  type: string;
  status: string;
  scope: string;
  query: string;
  priority: string;
  tag: string;
  access: string;
  from: string;
  to: string;
  scheduled: boolean;
  sort: string;
};
export const EMPTY_CASE_FILTERS: CaseFilterValues = {
  category: '',
  subtype: '',
  responsible: '',
  type: '',
  status: 'all',
  scope: 'all',
  query: '',
  priority: '',
  tag: '',
  access: '',
  from: '',
  to: '',
  scheduled: false,
  sort: 'recent',
};
export const CASE_FILTER_ICONS = ['folder', 'filter', 'star', 'clock', 'tag', 'check'] as const;
export const CASE_FILTER_CRITERIA = [
  'category',
  'subtype',
  'responsible',
  'scope',
  'type',
  'status',
  'priority',
  'tag',
  'access',
  'dates',
  'query',
  'scheduled',
  'sort',
] as const;
export type CaseFilterCriterion = (typeof CASE_FILTER_CRITERIA)[number];
export type SavedCaseFilter = {
  id: string;
  name: string;
  description: string;
  icon: (typeof CASE_FILTER_ICONS)[number];
  filters: CaseFilterValues;
  emoji?: string;
  criteria?: CaseFilterCriterion[];
};
export const LEGACY_CASE_FILTER_EMOJI: Record<SavedCaseFilter['icon'], string> = {
  folder: '📁',
  filter: '🔍',
  star: '⭐',
  clock: '⏰',
  tag: '🏷️',
  check: '✅',
};

export function configuredCaseCriteria(
  filters: CaseFilterValues,
  order: readonly CaseFilterCriterion[] = []
): CaseFilterCriterion[] {
  const configured = CASE_FILTER_CRITERIA.filter((key) =>
    key === 'dates' ? !!(filters.from || filters.to) : filters[key] !== EMPTY_CASE_FILTERS[key]
  );
  return [
    ...new Set([...order.filter((key) => CASE_FILTER_CRITERIA.includes(key)), ...configured]),
  ];
}
export function removeCaseCriterion(
  filters: CaseFilterValues,
  key: CaseFilterCriterion
): CaseFilterValues {
  return key === 'dates'
    ? { ...filters, from: '', to: '' }
    : { ...filters, [key]: EMPTY_CASE_FILTERS[key] };
}
export function reorderCaseCriteria(criteria: CaseFilterCriterion[], from: number, to: number) {
  const next = [...criteria];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function caseFilterViewKey(workspaceId: string) {
  if (!uuid.test(workspaceId)) throw new Error('Selecciona un espacio de trabajo válido.');
  return `mis_expedientes_v1:${workspaceId}`;
}
export function normalizeCaseFilterValues(value: unknown): CaseFilterValues {
  const raw = object(value);
  const result = { ...EMPTY_CASE_FILTERS };
  for (const key of Object.keys(result) as (keyof CaseFilterValues)[]) {
    if (key === 'scheduled') result.scheduled = raw.scheduled === true;
    else if (typeof raw[key] === 'string') result[key] = (raw[key] as string).trim();
  }
  if (result.type && !uuid.test(result.type))
    throw new Error('Selecciona un tipo de expediente válido.');
  if (!caseOrderOptions.some(({ id }) => id === result.sort))
    throw new Error('Selecciona un orden válido.');
  if (result.query.length > 120 || result.tag.length > 120)
    throw new Error('La búsqueda y las etiquetas admiten hasta 120 caracteres.');
  parseCaseFilters(
    new URLSearchParams({
      categoria: result.category,
      subtipo: result.subtype,
      responsable: result.responsible,
      estado: result.status,
      vista: result.scope,
      prioridad: result.priority,
      acceso: result.access,
      desde: result.from,
      hasta: result.to,
    })
  );
  return result;
}
export function sameCaseFilters(a: CaseFilterValues, b: CaseFilterValues) {
  return (Object.keys(EMPTY_CASE_FILTERS) as (keyof CaseFilterValues)[]).every((key) =>
    key === 'query' ? a.query.trim() === b.query.trim() : a[key] === b[key]
  );
}
export function buildSavedCaseFilter(
  value: SavedCaseFilter,
  others: SavedCaseFilter[]
): SavedCaseFilter {
  const name = value.name.trim();
  if (!name) throw new Error('Escribe un nombre para el filtro.');
  if (name.length > 80) throw new Error('El nombre admite hasta 80 caracteres.');
  if (value.description.trim().length > 200)
    throw new Error('La descripción admite hasta 200 caracteres.');
  if (
    others.some(
      (item) =>
        item.id !== value.id && item.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es')
    )
  )
    throw new Error('Ya tienes un filtro con ese nombre.');
  if (!uuid.test(value.id) || !CASE_FILTER_ICONS.includes(value.icon))
    throw new Error('El filtro no es válido.');
  const filters = normalizeCaseFilterValues(value.filters);
  if (sameCaseFilters({ ...filters, sort: 'recent' }, EMPTY_CASE_FILTERS))
    throw new Error('Selecciona al menos un criterio para guardar el filtro.');
  if (value.emoji && !CUSTOM_FILTER_ICON_OPTIONS.some((emoji) => emoji === value.emoji))
    throw new Error('Selecciona un ícono válido.');
  return {
    id: value.id,
    name,
    description: value.description.trim(),
    icon: value.icon,
    filters,
    ...(value.emoji ? { emoji: value.emoji } : {}),
    ...(value.criteria ? { criteria: configuredCaseCriteria(filters, value.criteria) } : {}),
  };
}
export function readSavedCaseFilters(value: unknown): SavedCaseFilter[] {
  if (!Array.isArray(value)) return [];
  const result: SavedCaseFilter[] = [];
  for (const raw of value) {
    const item = object(raw);
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.description !== 'string' ||
      typeof item.icon !== 'string'
    )
      continue;
    try {
      if (result.some((existing) => existing.id === item.id)) continue;
      result.push(
        buildSavedCaseFilter(
          {
            id: item.id,
            name: item.name,
            description: item.description,
            icon: item.icon as SavedCaseFilter['icon'],
            filters: normalizeCaseFilterValues(item.filters),
            ...(typeof item.emoji === 'string' ? { emoji: item.emoji } : {}),
            ...(Array.isArray(item.criteria)
              ? {
                  criteria: item.criteria.filter(
                    (key): key is CaseFilterCriterion =>
                      typeof key === 'string' && CASE_FILTER_CRITERIA.some((value) => value === key)
                  ),
                }
              : {}),
          },
          result
        )
      );
    } catch {
      /* Ignore obsolete or malformed preferences without broadening their criteria. */
    }
  }
  return result;
}
