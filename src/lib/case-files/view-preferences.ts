import type { SupabaseClient } from '@supabase/supabase-js';

export type CaseViewColumn = { id: string; label: string; visible: boolean };
export type CaseViewGridRow = { id: string; label: string; selected: boolean; order: number };
export type CaseViewPreferences = {
  columns: CaseViewColumn[];
  filters: CaseViewColumn[];
  gridColumns: CaseViewGridRow[];
};

export const CASE_VIEW_COLUMNS: CaseViewColumn[] = [
  { id: 'type', label: 'Tipo de expediente', visible: true },
  { id: 'participant', label: 'Participante', visible: true },
  { id: 'responsible', label: 'Responsable', visible: true },
  { id: 'issuer', label: 'Emisor', visible: true },
  { id: 'status', label: 'Estado', visible: true },
  { id: 'progress', label: 'Avance', visible: true },
  { id: 'updated', label: 'Última actividad', visible: true },
  { id: 'category', label: 'Categoría de expediente', visible: false },
  { id: 'priority', label: 'Prioridad', visible: false },
  { id: 'folio', label: 'Folio', visible: false },
  { id: 'created', label: 'Fecha de creación', visible: false },
  { id: 'due', label: 'Fecha de vencimiento', visible: false },
  { id: 'access', label: 'Acceso', visible: false },
  { id: 'tags', label: 'Etiquetas', visible: false },
];
const LEGACY_CASE_COLUMNS = [
  'type',
  'participant',
  'status',
  'progress',
  'updated',
  'category',
  'priority',
  'folio',
  'owner',
  'created',
  'due',
  'access',
  'tags',
];
export const CASE_VIEW_FILTERS: CaseViewColumn[] = [
  { id: 'category', label: 'Categoría de expediente', visible: true },
  { id: 'subtype', label: 'Tipo de expediente', visible: true },
  { id: 'responsible', label: 'Responsable', visible: true },
  { id: 'status', label: 'Estado', visible: true },
  { id: 'priority', label: 'Prioridad', visible: true },
  { id: 'tag', label: 'Etiquetas', visible: true },
  { id: 'access', label: 'Acceso', visible: true },
  { id: 'dates', label: 'Fecha de creación', visible: true },
  { id: 'scheduled', label: 'Envío', visible: true },
];
export const CASE_VIEW_GRID: CaseViewGridRow[] = CASE_VIEW_COLUMNS.map((column, index) => ({
  id: column.id,
  label: column.label,
  selected: ['type', 'participant', 'status', 'progress', 'folio'].includes(column.id),
  order: index,
}));
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function orderedCatalog<T extends { id: string }>(raw: unknown, catalog: T[]): T[] {
  const entries = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of entries) {
    const row = object(entry),
      known = catalog.find((item) => item.id === row.id);
    if (!known || seen.has(known.id)) continue;
    seen.add(known.id);
    result.push({
      ...known,
      ...('visible' in known && typeof row.visible === 'boolean' ? { visible: row.visible } : {}),
      ...('selected' in known && typeof row.selected === 'boolean'
        ? { selected: row.selected }
        : {}),
    });
  }
  return [...result, ...catalog.filter((item) => !seen.has(item.id)).map((item) => ({ ...item }))];
}
export function normalizeCaseView(value: unknown): CaseViewPreferences {
  const raw = object(value);
  const oldColumns = Array.isArray(raw.columns) ? raw.columns : [];
  const legacy =
    oldColumns.length === LEGACY_CASE_COLUMNS.length &&
    oldColumns.every((entry, index) => {
      const row = object(entry);
      return row.id === LEGACY_CASE_COLUMNS[index] && row.visible === index < 5;
    });
  const migrateOwner = (rows: unknown) =>
    Array.isArray(rows)
      ? rows.map((entry) => {
          const row = object(entry);
          return row.id === 'owner' ? { ...row, id: 'issuer' } : row;
        })
      : rows;
  let selected = 0;
  return {
    columns: orderedCatalog(legacy ? undefined : migrateOwner(raw.columns), CASE_VIEW_COLUMNS),
    filters: orderedCatalog(raw.filters, CASE_VIEW_FILTERS),
    gridColumns: orderedCatalog(migrateOwner(raw.gridColumns), CASE_VIEW_GRID).map(
      (item, index) => ({
        ...item,
        order: index,
        selected: item.selected && ++selected <= 5,
      })
    ),
  };
}
export function caseViewKey(workspaceId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(workspaceId))
    throw new Error('Selecciona un espacio de trabajo válido.');
  return `mis_expedientes_vista_v1:${workspaceId}`;
}
export async function loadCaseView(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  workspaceId: string
) {
  const { data, error } = await client
    .from('user_view_preferences')
    .select('custom_filters')
    .eq('user_id', userId)
    .eq('view_key', caseViewKey(workspaceId))
    .maybeSingle();
  if (error) throw new Error('No se pudo cargar la personalización de la vista.');
  return normalizeCaseView(
    Array.isArray(data?.custom_filters) ? data.custom_filters[0] : undefined
  );
}
export async function saveCaseView(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  workspaceId: string,
  value: CaseViewPreferences
) {
  const normalized = normalizeCaseView(value);
  const { data, error } = await client
    .from('user_view_preferences')
    .upsert(
      {
        user_id: userId,
        view_key: caseViewKey(workspaceId),
        custom_filters: [{ version: 1, ...normalized }],
      },
      { onConflict: 'user_id,view_key' }
    )
    .select('custom_filters')
    .single();
  if (error || !data) throw new Error('No se pudo guardar la personalización. Intenta de nuevo.');
  return normalizeCaseView(data.custom_filters?.[0]);
}
