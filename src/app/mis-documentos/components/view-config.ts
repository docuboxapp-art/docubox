export interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
}

export interface FilterVisibilityConfig {
  id: string;
  label: string;
  visible: boolean;
}

export interface GridColumnConfig {
  id: string;
  label: string;
  selected: boolean;
  order: number;
}

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', visible: true },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: true },
  { id: 'fechaCompletado', label: 'Fecha de completado', visible: true },
  { id: 'numeroDocumento', label: 'Número de documento', visible: false },
  { id: 'folioInterno', label: 'Folio interno documento', visible: false },
  { id: 'etiquetas', label: 'Etiquetas', visible: false },
  { id: 'tamano', label: 'Tamaño', visible: false },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: false },
  { id: 'tipoDocumento', label: 'Tipo de documento', visible: false },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', visible: false },
  { id: 'rutaGuardado', label: 'Ruta de guardado', visible: false },
  { id: 'prioridad', label: 'Prioridad', visible: false },
];

const LEGACY_COLUMN_ORDER = [
  'numeroDocumento',
  'folioInterno',
  'estado',
  'estadoParticipacion',
  'etiquetas',
  'tamano',
  'ultimaModificacion',
  'propietario',
  'fechaCreacion',
  'fechaCompletado',
  'tipoDocumento',
  'fechaVencimiento',
  'rutaGuardado',
  'prioridad',
];
const LEGACY_VISIBLE_COLUMNS = new Set([
  'numeroDocumento',
  'estado',
  'etiquetas',
  'tamano',
  'ultimaModificacion',
  'propietario',
]);

/** Upgrade untouched defaults for existing accounts while keeping intentional customizations. */
export function normalizeDocumentColumns(raw: unknown): ColumnConfig[] {
  const rows = Array.isArray(raw) ? raw : [];
  const legacy =
    rows.length === LEGACY_COLUMN_ORDER.length &&
    rows.every(
      (row, index) =>
        row?.id === LEGACY_COLUMN_ORDER[index] && row.visible === LEGACY_VISIBLE_COLUMNS.has(row.id)
    );
  if (!rows.length || legacy) return DEFAULT_COLUMNS.map((column) => ({ ...column }));
  const seen = new Set<string>();
  const columns: ColumnConfig[] = [];
  for (const row of rows) {
    const known = DEFAULT_COLUMNS.find((column) => column.id === row?.id);
    if (!known || seen.has(known.id)) continue;
    seen.add(known.id);
    columns.push({
      ...known,
      visible: typeof row.visible === 'boolean' ? row.visible : known.visible,
    });
  }
  return [
    ...columns,
    ...DEFAULT_COLUMNS.filter((column) => !seen.has(column.id)).map((column) => ({ ...column })),
  ];
}

export const DEFAULT_GRID_COLUMNS: GridColumnConfig[] = [
  { id: 'estado', label: 'Estado', selected: true, order: 1 },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', selected: false, order: 2 },
  { id: 'etiquetas', label: 'Etiquetas', selected: true, order: 3 },
  { id: 'ultimaModificacion', label: 'Última modificación', selected: true, order: 4 },
  { id: 'tamano', label: 'Tamaño', selected: false, order: 5 },
  { id: 'propietario', label: 'Propietario', selected: false, order: 6 },
  { id: 'numeroDocumento', label: 'Número de documento', selected: false, order: 7 },
  { id: 'folioInterno', label: 'Folio interno', selected: false, order: 8 },
  { id: 'fechaCreacion', label: 'Fecha de creación', selected: false, order: 9 },
  { id: 'fechaCompletado', label: 'Fecha de completado', selected: false, order: 10 },
  { id: 'tipoDocumento', label: 'Tipo de documento', selected: false, order: 11 },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', selected: false, order: 12 },
  { id: 'prioridad', label: 'Prioridad', selected: false, order: 13 },
];

export const DEFAULT_FILTERS: FilterVisibilityConfig[] = [
  { id: 'estructura', label: 'Tipo', visible: true },
  { id: 'origen', label: 'Origen', visible: true },
  { id: 'tipoDocumento', label: 'Tipo de Documento', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: true },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', visible: true },
  { id: 'fechaVencimiento', label: 'Fecha de Vencimiento', visible: true },
  { id: 'etiquetas', label: 'Etiquetas', visible: false },
  { id: 'fechaCompletado', label: 'Fecha de completado', visible: false },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: false },
  { id: 'participantes', label: 'Participantes', visible: false },
  { id: 'estadoParticipantes', label: 'Participaciones en mis documentos', visible: true },
  { id: 'prioridad', label: 'Prioridad', visible: false },
];

export const DEFAULT_CF_COLUMNS: ColumnConfig[] = [
  { id: 'nombre', label: 'Nombre', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: true },
  { id: 'numeroDocumento', label: 'Número de documento', visible: true },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: false },
  { id: 'etiquetas', label: 'Etiquetas', visible: false },
  { id: 'tamano', label: 'Tamaño', visible: false },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', visible: false },
  { id: 'tipoDocumento', label: 'Tipo de documento', visible: false },
  { id: 'prioridad', label: 'Prioridad', visible: false },
  { id: 'folioInterno', label: 'Folio interno', visible: false },
];
