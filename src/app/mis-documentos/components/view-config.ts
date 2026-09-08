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
  { id: 'numeroDocumento', label: 'Número de documento', visible: true },
  { id: 'folioInterno', label: 'Folio interno documento', visible: false },
  { id: 'estado', label: 'Estado', visible: true },
  { id: 'estadoParticipacion', label: 'Estado de mi participación', visible: false },
  { id: 'etiquetas', label: 'Etiquetas', visible: true },
  { id: 'tamano', label: 'Tamaño', visible: true },
  { id: 'ultimaModificacion', label: 'Última modificación', visible: true },
  { id: 'propietario', label: 'Propietario', visible: true },
  { id: 'fechaCreacion', label: 'Fecha de creación', visible: false },
  { id: 'fechaCompletado', label: 'Fecha de completado', visible: false },
  { id: 'tipoDocumento', label: 'Tipo de documento', visible: false },
  { id: 'fechaVencimiento', label: 'Fecha de vencimiento', visible: false },
  { id: 'rutaGuardado', label: 'Ruta de guardado', visible: false },
  { id: 'prioridad', label: 'Prioridad', visible: false },
];

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
