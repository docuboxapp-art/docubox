import type { SupabaseClient } from '@supabase/supabase-js';
import { restoreViewOrder, viewConfigRecord as object } from '../workspaces/view-order';

export type CaseViewColumn = { id: string; label: string; visible: boolean };
export type CaseViewGridRow = { id: string; label: string; selected: boolean; order: number };
export type CaseViewPreferences = {
  columns: CaseViewColumn[];
  filters: CaseViewColumn[];
  gridColumns: CaseViewGridRow[];
};
export type CaseColumnWidths = Record<string, number>;

export const CASE_COLUMN_WIDTHS: CaseColumnWidths = {
  title: 248,
  type: 164,
  participant: 144,
  responsible: 144,
  issuer: 144,
  status: 152,
  progress: 104,
  updated: 132,
  category: 168,
  priority: 112,
  folio: 168,
  created: 144,
  due: 152,
  access: 128,
  tags: 144,
};
export const CASE_COLUMN_MAX_WIDTH = 720;

export function caseColumnMinWidth(id: string) {
  return id === 'title' ? 168 : 96;
}

function normalizeCaseColumnWidths(value: unknown): CaseColumnWidths {
  const raw = object(value);
  const widths: CaseColumnWidths = {};
  for (const id of Object.keys(CASE_COLUMN_WIDTHS)) {
    const width = raw[id];
    if (typeof width === 'number' && Number.isFinite(width)) {
      widths[id] = Math.min(
        CASE_COLUMN_MAX_WIDTH,
        Math.max(caseColumnMinWidth(id), Math.round(width))
      );
    }
  }
  return widths;
}

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
  { id: 'template', label: 'Nombre del tipo de expediente', visible: true },
  { id: 'scope', label: 'Seguimiento y favoritos', visible: true },
];
export const CASE_VIEW_GRID: CaseViewGridRow[] = CASE_VIEW_COLUMNS.map((column, index) => ({
  id: column.id,
  label: column.label,
  selected: ['type', 'participant', 'status', 'progress', 'folio'].includes(column.id),
  order: index,
}));
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
    columns: restoreViewOrder(legacy ? undefined : migrateOwner(raw.columns), CASE_VIEW_COLUMNS),
    filters: restoreViewOrder(raw.filters, CASE_VIEW_FILTERS),
    gridColumns: restoreViewOrder(migrateOwner(raw.gridColumns), CASE_VIEW_GRID).map(
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
    .select('custom_filters,column_widths_config')
    .eq('user_id', userId)
    .eq('view_key', caseViewKey(workspaceId))
    .maybeSingle();
  if (error) throw new Error('No se pudo cargar la personalización de la vista.');
  return {
    view: normalizeCaseView(
      Array.isArray(data?.custom_filters) ? data.custom_filters[0] : undefined
    ),
    widths: normalizeCaseColumnWidths(data?.column_widths_config),
  };
}

export async function saveCaseColumnWidths(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  workspaceId: string,
  widths: CaseColumnWidths
) {
  const { error } = await client.from('user_view_preferences').upsert(
    {
      user_id: userId,
      view_key: caseViewKey(workspaceId),
      column_widths_config: normalizeCaseColumnWidths(widths),
    },
    { onConflict: 'user_id,view_key', defaultToNull: false }
  );
  if (error) throw new Error('No se pudo guardar el ancho de las columnas.');
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
      { onConflict: 'user_id,view_key', defaultToNull: false }
    )
    .select('custom_filters')
    .single();
  if (error || !data) throw new Error('No se pudo guardar la personalización. Intenta de nuevo.');
  return normalizeCaseView(data.custom_filters?.[0]);
}
