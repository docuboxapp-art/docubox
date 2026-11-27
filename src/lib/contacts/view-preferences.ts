import type { SupabaseClient } from '@supabase/supabase-js';
import { restoreViewOrder, viewConfigRecord } from '../workspaces/view-order';

export const CONTACT_LIST_FIELDS = [
  { id: 'datos', label: 'Datos de contacto', visible: true },
  { id: 'etiquetas', label: 'Etiquetas', visible: true },
  { id: 'documentos', label: 'Documentos', visible: true },
  { id: 'seguimiento', label: 'Seguimiento', visible: true },
  { id: 'actividad', label: 'Documento reciente', visible: true },
  { id: 'grupo', label: 'Grupos', visible: false },
  { id: 'pendientes', label: 'Pendientes', visible: false },
  { id: 'vencimiento', label: 'Próximo vencimiento', visible: false },
  { id: 'interaccion', label: 'Última interacción', visible: false },
  { id: 'correo', label: 'Correo electrónico', visible: false },
  { id: 'telefono', label: 'Teléfono', visible: false },
  { id: 'tipo', label: 'Tipo de persona', visible: false },
  { id: 'rfc', label: 'RFC', visible: false },
  { id: 'alta', label: 'Fecha de alta', visible: false },
] as const;

export const CONTACT_FILTER_FIELDS = [
  { id: 'tipo', label: 'Tipo de contacto', visible: true },
  { id: 'favoritos', label: 'Favoritos', visible: true },
  { id: 'pendientes', label: 'Pendientes', visible: true },
  { id: 'etiqueta', label: 'Etiquetas', visible: true },
  { id: 'grupo', label: 'Grupos', visible: true },
  { id: 'seguimiento', label: 'Seguimiento', visible: false },
] as const;

export type ContactFieldId = (typeof CONTACT_LIST_FIELDS)[number]['id'];
export type ContactFilterId = (typeof CONTACT_FILTER_FIELDS)[number]['id'];
export type ContactColumnId = ContactFieldId | 'contacto';
export type ContactColumnWidths = Partial<Record<ContactColumnId, number>>;
export type ContactView = {
  columns: { id: ContactFieldId; label: string; visible: boolean }[];
  filters: { id: ContactFilterId; label: string; visible: boolean }[];
  gridColumns: { id: ContactFieldId; label: string; selected: boolean; order: number }[];
};

export const CONTACT_COLUMN_WIDTHS: Record<ContactColumnId, number> = {
  contacto: 200,
  datos: 178,
  etiquetas: 120,
  documentos: 110,
  seguimiento: 123,
  actividad: 142,
  grupo: 145,
  pendientes: 105,
  vencimiento: 155,
  interaccion: 148,
  correo: 200,
  telefono: 130,
  tipo: 135,
  rfc: 135,
  alta: 125,
};
export const CONTACT_COLUMN_MAX_WIDTH = 720;

export function contactColumnMinWidth(id: ContactColumnId) {
  return id === 'contacto' ? 144 : 96;
}

export function normalizeContactColumnWidths(value: unknown): ContactColumnWidths {
  const raw = viewConfigRecord(value);
  const widths: ContactColumnWidths = {};
  for (const id of Object.keys(CONTACT_COLUMN_WIDTHS) as ContactColumnId[]) {
    const width = raw[id];
    if (typeof width === 'number' && Number.isFinite(width)) {
      widths[id] = Math.min(
        CONTACT_COLUMN_MAX_WIDTH,
        Math.max(contactColumnMinWidth(id), Math.round(width))
      );
    }
  }
  return widths;
}

const gridDefaults = ['datos', 'etiquetas', 'rfc', 'seguimiento'] as const;
const CONTACT_GRID_FIELDS = CONTACT_LIST_FIELDS.map(({ id, label }, order) => ({
  id,
  label,
  selected: gridDefaults.some((key) => key === id),
  order,
}));

export function normalizeContactView(value: unknown): ContactView {
  const raw = viewConfigRecord(value);
  let visibleRows = 0;
  return {
    columns: restoreViewOrder(raw.columns, CONTACT_LIST_FIELDS),
    filters: restoreViewOrder(raw.filters, CONTACT_FILTER_FIELDS),
    gridColumns: restoreViewOrder(raw.gridColumns, CONTACT_GRID_FIELDS).map((field, index) => ({
      ...field,
      order: index,
      selected: field.selected && ++visibleRows <= 5,
    })),
  };
}

export const DEFAULT_CONTACT_VIEW = normalizeContactView(null);

const viewKey = 'mis_contactos';
const preferenceColumns = 'columns_config,filters_config,grid_columns_config';

function readView(data: {
  columns_config: unknown;
  filters_config: unknown;
  grid_columns_config: unknown;
}) {
  return normalizeContactView({
    columns: data.columns_config,
    filters: data.filters_config,
    gridColumns: data.grid_columns_config,
  });
}

export async function loadContactView(client: Pick<SupabaseClient, 'from'>, userId: string) {
  const { data, error } = await client
    .from('user_view_preferences')
    .select('columns_config,filters_config,grid_columns_config,column_widths_config')
    .eq('user_id', userId)
    .eq('view_key', viewKey)
    .maybeSingle();
  if (error) throw new Error('No se pudo cargar la personalización de la agenda.');
  return {
    view: data ? readView(data) : normalizeContactView(null),
    widths: normalizeContactColumnWidths(data?.column_widths_config),
  };
}

export async function saveContactColumnWidths(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  widths: ContactColumnWidths
) {
  const { error } = await client.from('user_view_preferences').upsert(
    {
      user_id: userId,
      view_key: viewKey,
      column_widths_config: normalizeContactColumnWidths(widths),
    },
    { onConflict: 'user_id,view_key', defaultToNull: false }
  );
  if (error) throw new Error('No se pudo guardar el ancho de las columnas.');
}

export async function saveContactView(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  value: unknown
) {
  const view = normalizeContactView(value);
  const { data, error } = await client
    .from('user_view_preferences')
    .upsert(
      {
        user_id: userId,
        view_key: viewKey,
        columns_config: view.columns,
        filters_config: view.filters,
        grid_columns_config: view.gridColumns,
      },
      { onConflict: 'user_id,view_key', defaultToNull: false }
    )
    .select(preferenceColumns)
    .single();
  if (error || !data) throw new Error('No se pudo guardar la vista. Intenta de nuevo.');
  return readView(data);
}
