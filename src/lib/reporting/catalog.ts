export type DatasetId =
  | 'documentos'
  | 'plantillas'
  | 'formularios'
  | 'respuestas'
  | 'expedientes'
  | 'tareas'
  | 'participantes'
  | 'actividad'
  | 'usuarios'
  | 'contactos'
  | 'certificaciones'
  | 'notificaciones'
  | 'colaboracion'
  | 'firmas_masivas';
export type FieldType = 'text' | 'number' | 'date' | 'boolean';
export type ReportField = { id: string; label: string; type: FieldType; legacy?: boolean };
export type ReportRow = Record<string, string | number | boolean | null>;
export type Operator =
  'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty';
export type Condition = { field: string; operator: Operator; value: string };
export type Visualization = 'table' | 'bar' | 'line' | 'pie' | 'kpi';
export type ReportConfig = {
  fields: string[];
  conditions: Condition[];
  match: 'all' | 'any';
  period: 'all' | '7d' | '30d' | '90d' | '1y';
  dateField: string;
  visualization: Visualization;
  groupBy: string;
  metric: string;
  metricOperation?: 'sum' | 'average';
  dateBucket?: 'day' | 'month';
  formId?: string;
  sortBy: string;
  sortDirection: 'asc' | 'desc';
};
export type ReportDefinition = {
  id: string;
  workspace_id?: string;
  created_by?: string;
  name: string;
  description: string;
  dataset: DatasetId;
  config: ReportConfig;
  created_at?: string;
  updated_at?: string;
  system?: boolean;
  listed?: boolean;
};

export const DATASETS: Record<
  DatasetId,
  { label: string; description: string; icon: string; fields: ReportField[] }
> = {
  documentos: {
    label: 'Documentos',
    description: 'Estado, plazos, propiedad y participación.',
    icon: 'file',
    fields: [
      { id: 'nombre', label: 'Documento', type: 'text' },
      { id: 'folio', label: 'Folio', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'tipo', label: 'Tipo documental', type: 'text' },
      { id: 'propietario', label: 'Propietario', type: 'text' },
      { id: 'participantes', label: 'Participantes', type: 'number' },
      { id: 'urgente', label: 'Urgente', type: 'boolean' },
      { id: 'tamano', label: 'Tamaño (bytes)', type: 'number' },
      { id: 'creado', label: 'Creado', type: 'date' },
      { id: 'actualizado', label: 'Actualizado', type: 'date' },
      { id: 'vence', label: 'Vence', type: 'date' },
      { id: 'completado', label: 'Completado', type: 'date' },
      { id: 'folio_interno', label: 'Folio interno', type: 'text' },
      { id: 'oficio', label: 'Número de oficio', type: 'text' },
      { id: 'prioridad', label: 'Prioridad', type: 'text' },
      { id: 'origen', label: 'Origen', type: 'text' },
      { id: 'publico', label: 'Público', type: 'boolean' },
      { id: 'cancelado', label: 'Cancelado el', type: 'date' },
    ],
  },
  plantillas: {
    label: 'Plantillas',
    description: 'Uso y configuración de plantillas documentales.',
    icon: 'template',
    fields: [
      { id: 'nombre', label: 'Plantilla', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'categoria', label: 'Categoría', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'idioma', label: 'Idioma', type: 'text' },
      { id: 'efirma', label: 'Requiere e.firma', type: 'boolean' },
      { id: 'nom151', label: 'Requiere NOM-151', type: 'boolean' },
      { id: 'campos', label: 'Campos', type: 'number' },
      { id: 'oficio', label: 'Número de oficio', type: 'text' },
      { id: 'area', label: 'Área responsable', type: 'text' },
      { id: 'tipo', label: 'Tipo de plantilla', type: 'text' },
      { id: 'version', label: 'Versión publicada', type: 'text' },
      { id: 'revisor', label: 'Revisor', type: 'text' },
      { id: 'ultimo_borrador', label: 'Último borrador', type: 'date' },
      { id: 'creador', label: 'Creada por', type: 'text' },
      { id: 'creado', label: 'Creada', type: 'date' },
      { id: 'actualizado', label: 'Actualizada', type: 'date' },
    ],
  },
  formularios: {
    label: 'Formularios',
    description: 'Publicación, respuestas y configuración.',
    icon: 'form',
    fields: [
      { id: 'nombre', label: 'Formulario', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'version', label: 'Versión', type: 'number' },
      { id: 'campos', label: 'Campos', type: 'number' },
      { id: 'respuestas', label: 'Respuestas', type: 'number' },
      { id: 'creador', label: 'Creado por', type: 'text' },
      { id: 'creado', label: 'Creado', type: 'date' },
      { id: 'actualizado', label: 'Actualizado', type: 'date' },
      { id: 'requiere_firma', label: 'Requiere firma', type: 'boolean' },
      { id: 'publicado', label: 'Publicado el', type: 'date' },
      { id: 'cerrado', label: 'Cerrado el', type: 'date' },
      { id: 'archivado', label: 'Archivado el', type: 'date' },
    ],
  },
  respuestas: {
    label: 'Respuestas',
    description: 'Envíos de formularios y campos capturados.',
    icon: 'response',
    fields: [
      { id: 'formulario', label: 'Formulario', type: 'text' },
      { id: 'participante', label: 'Participante', type: 'text' },
      { id: 'correo', label: 'Correo', type: 'text' },
      { id: 'documento', label: 'Documento generado', type: 'text' },
      { id: 'enviado', label: 'Fecha de respuesta', type: 'date' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'folio', label: 'Folio de respuesta', type: 'text' },
      { id: 'acceso', label: 'Modalidad de acceso', type: 'text' },
      { id: 'pdf', label: 'PDF generado', type: 'boolean' },
      { id: 'requiere_firma', label: 'Requiere firma', type: 'boolean' },
    ],
  },
  expedientes: {
    label: 'Expedientes',
    description: 'Avance, responsables y cierres.',
    icon: 'folder',
    fields: [
      { id: 'folio', label: 'Folio', type: 'text' },
      { id: 'nombre', label: 'Expediente', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'tipo', label: 'Tipo', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'prioridad', label: 'Prioridad', type: 'text' },
      { id: 'progreso', label: 'Progreso (%)', type: 'number' },
      { id: 'responsable', label: 'Responsable', type: 'text' },
      { id: 'creado', label: 'Creado', type: 'date' },
      { id: 'objetivo', label: 'Fecha objetivo', type: 'date' },
      { id: 'cerrado', label: 'Cerrado', type: 'date' },
      { id: 'subtipo', label: 'Tipo de expediente', type: 'text' },
      { id: 'sujeto', label: 'Titular del expediente', type: 'text' },
      { id: 'area', label: 'Área responsable', type: 'text' },
      { id: 'emisor', label: 'Emisor', type: 'text' },
      { id: 'etiquetas', label: 'Etiquetas', type: 'text' },
      { id: 'apertura', label: 'Abierto el', type: 'date' },
      { id: 'actualizado', label: 'Actualizado', type: 'date' },
    ],
  },
  tareas: {
    label: 'Tareas y acciones',
    description: 'Asignaciones, estados y plazos.',
    icon: 'task',
    fields: [
      { id: 'nombre', label: 'Tarea', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'tipo', label: 'Tipo', type: 'text' },
      { id: 'clase', label: 'Acción o actividad', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'prioridad', label: 'Prioridad', type: 'text' },
      { id: 'riesgo', label: 'Riesgo', type: 'text' },
      { id: 'origen', label: 'Origen', type: 'text' },
      { id: 'responsable', label: 'Responsable', type: 'text' },
      { id: 'creador', label: 'Creada por', type: 'text' },
      { id: 'recurso', label: 'Recurso vinculado', type: 'text' },
      { id: 'creado', label: 'Creada', type: 'date' },
      { id: 'vence', label: 'Fecha límite', type: 'date' },
      { id: 'completado', label: 'Completada', type: 'date' },
      { id: 'programada', label: 'Programada para', type: 'date' },
      { id: 'actualizado', label: 'Actualizada', type: 'date' },
      { id: 'critica', label: 'Crítica', type: 'boolean' },
      { id: 'bloqueada', label: 'Bloqueada', type: 'boolean' },
      { id: 'etiquetas', label: 'Etiquetas', type: 'text' },
      { id: 'sla', label: 'Vencimiento del SLA', type: 'date' },
    ],
  },
  participantes: {
    label: 'Participantes',
    description: 'Personas vinculadas a documentos y expedientes.',
    icon: 'users',
    fields: [
      { id: 'nombre', label: 'Participante', type: 'text' },
      { id: 'correo', label: 'Correo', type: 'text' },
      { id: 'rol', label: 'Rol', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'recurso', label: 'Recurso', type: 'text' },
      { id: 'modulo', label: 'Módulo', type: 'text' },
      { id: 'creado', label: 'Vinculado', type: 'date' },
      { id: 'respondido', label: 'Última participación', type: 'date' },
      { id: 'vence', label: 'Invitación vence', type: 'date' },
    ],
  },
  actividad: {
    label: 'Actividad y eventos',
    description: 'Acciones del usuario y de participantes en documentos.',
    icon: 'activity',
    fields: [
      { id: 'accion', label: 'Acción', type: 'text' },
      { id: 'categoria', label: 'Categoría', type: 'text' },
      { id: 'actor', label: 'Realizada por', type: 'text' },
      { id: 'correo', label: 'Correo del actor', type: 'text' },
      { id: 'documento', label: 'Recurso', type: 'text' },
      { id: 'modulo', label: 'Módulo', type: 'text' },
      { id: 'fecha', label: 'Fecha', type: 'date' },
    ],
  },
  usuarios: {
    label: 'Usuarios del espacio',
    description: 'Integrantes, roles y fechas de ingreso.',
    icon: 'users',
    fields: [
      { id: 'nombre', label: 'Usuario', type: 'text' },
      { id: 'correo', label: 'Correo', type: 'text' },
      { id: 'rol', label: 'Rol', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'ingreso', label: 'Ingreso', type: 'date' },
      { id: 'vence', label: 'Vencimiento del acceso', type: 'date' },
    ],
  },
  contactos: {
    label: 'Contactos',
    description: 'Directorio personal e interacciones de contacto.',
    icon: 'users',
    fields: [
      { id: 'nombre', label: 'Nombre', type: 'text' },
      { id: 'correo', label: 'Correo', type: 'text' },
      { id: 'telefono', label: 'Teléfono', type: 'text' },
      { id: 'empresa', label: 'Empresa', type: 'text' },
      { id: 'cargo', label: 'Cargo', type: 'text' },
      { id: 'tipo', label: 'Tipo de persona', type: 'text' },
      { id: 'rol', label: 'Rol', type: 'text' },
      { id: 'canal', label: 'Canal preferido', type: 'text' },
      { id: 'creado', label: 'Creado', type: 'date' },
      { id: 'actualizado', label: 'Actualizado', type: 'date' },
      { id: 'etiquetas', label: 'Etiquetas', type: 'text' },
    ],
  },
  certificaciones: {
    label: 'Certificaciones',
    description: 'Casos, servicios y estado de certificación.',
    icon: 'file',
    fields: [
      { id: 'folio', label: 'Folio', type: 'text' },
      { id: 'nombre', label: 'Certificación', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'origen', label: 'Origen', type: 'text' },
      { id: 'servicio', label: 'Servicio', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'modo', label: 'Proveedor', type: 'text' },
      { id: 'creador', label: 'Creado por', type: 'text' },
      { id: 'creado', label: 'Creado', type: 'date' },
      { id: 'enviado', label: 'Enviado', type: 'date' },
      { id: 'emitido', label: 'Emitido', type: 'date' },
      { id: 'validado', label: 'Validado', type: 'date' },
      { id: 'finalidad', label: 'Finalidad', type: 'text' },
      { id: 'conservar_hasta', label: 'Conservar hasta', type: 'date' },
      { id: 'actualizado', label: 'Actualizado', type: 'date' },
      { id: 'revisor', label: 'Revisor asignado', type: 'text' },
    ],
  },
  notificaciones: {
    label: 'Notificaciones',
    description: 'Avisos recibidos por el usuario.',
    icon: 'activity',
    fields: [
      { id: 'titulo', label: 'Aviso', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'tipo', label: 'Tipo', type: 'text' },
      { id: 'categoria', label: 'Categoría', type: 'text' },
      { id: 'prioridad', label: 'Prioridad', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'leida', label: 'Leída', type: 'boolean' },
      { id: 'creado', label: 'Recibida', type: 'date' },
      { id: 'leido', label: 'Leída el', type: 'date' },
    ],
  },
  colaboracion: {
    label: 'Colaboración',
    description: 'Espacios de trabajo colaborativo y su avance.',
    icon: 'folder',
    fields: [
      { id: 'nombre', label: 'Espacio', type: 'text' },
      { id: 'descripcion', label: 'Descripción', type: 'text' },
      { id: 'tipo', label: 'Tipo', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'confidencialidad', label: 'Confidencialidad', type: 'text' },
      { id: 'responsable', label: 'Responsable', type: 'text' },
      { id: 'creado', label: 'Creado', type: 'date' },
      { id: 'cerrado', label: 'Cerrado', type: 'date' },
      { id: 'actualizado', label: 'Actualizado', type: 'date' },
      { id: 'archivado', label: 'Archivado', type: 'date' },
      { id: 'creador', label: 'Creado por', type: 'text' },
    ],
  },
  firmas_masivas: {
    label: 'Firmas masivas',
    description: 'Campañas, avance de los envíos y resultados de firma.',
    icon: 'file',
    fields: [
      { id: 'nombre', label: 'Campaña', type: 'text' },
      { id: 'estado', label: 'Estado', type: 'text' },
      { id: 'total', label: 'Total de documentos', type: 'number' },
      { id: 'completados', label: 'Completados', type: 'number' },
      { id: 'pendientes', label: 'Pendientes', type: 'number' },
      { id: 'fallidos', label: 'Fallidos', type: 'number' },
      { id: 'participantes', label: 'Participantes', type: 'number' },
      { id: 'tipo', label: 'Tipo de campaña', type: 'text' },
      { id: 'origen', label: 'Origen', type: 'text' },
      { id: 'prioridad', label: 'Prioridad', type: 'text' },
      { id: 'area', label: 'Área', type: 'text' },
      { id: 'referencia', label: 'Referencia interna', type: 'text' },
      { id: 'responsable', label: 'Responsable', type: 'text' },
      { id: 'creado', label: 'Creada', type: 'date' },
      { id: 'programada', label: 'Programada para', type: 'date' },
      { id: 'iniciada', label: 'Iniciada', type: 'date' },
      { id: 'vence', label: 'Vence', type: 'date' },
      { id: 'completado', label: 'Completada', type: 'date' },
      { id: 'cerrado', label: 'Cerrada', type: 'date' },
      { id: 'actualizado', label: 'Actualizada', type: 'date' },
    ],
  },
};

export const datasetIds = Object.keys(DATASETS) as DatasetId[];
export const reportPeriods = [
  ['all', 'Todo el historial'],
  ['7d', 'Últimos 7 días'],
  ['30d', 'Últimos 30 días'],
  ['90d', 'Últimos 90 días'],
  ['1y', 'Último año'],
] as const;

export function reportableDatasets(organization: boolean): DatasetId[] {
  return datasetIds.filter(
    (id) =>
      id !== 'notificaciones' && (organization || (id !== 'usuarios' && id !== 'colaboracion'))
  );
}
export function defaultConfig(dataset: DatasetId): ReportConfig {
  const fields = DATASETS[dataset].fields;
  const dateField =
    fields.find((field) => field.id === 'creado' && field.type === 'date')?.id ||
    fields.find((field) => field.type === 'date')?.id ||
    '';
  return {
    fields: fields.slice(0, 5).map((field) => field.id),
    conditions: [],
    match: 'all',
    period: 'all',
    dateField,
    visualization: 'table',
    groupBy: '',
    metric: '__count',
    sortBy: dateField,
    sortDirection: 'desc',
  };
}

function preset(
  id: string,
  name: string,
  description: string,
  dataset: DatasetId,
  overrides: Partial<ReportConfig> = {}
): ReportDefinition {
  return {
    id,
    name,
    description,
    dataset,
    system: true,
    config: { ...defaultConfig(dataset), ...overrides },
  };
}
export const BUILTIN_REPORTS: ReportDefinition[] = [
  preset(
    'docubox-documentos',
    'Estado de documentos',
    'Volumen y situación de documentos del espacio.',
    'documentos',
    { visualization: 'bar', groupBy: 'estado' }
  ),
  preset(
    'docubox-vencimientos',
    'Documentos con vencimiento',
    'Consulta los documentos con fecha de vencimiento, ordenados por el plazo más próximo.',
    'documentos',
    {
      fields: ['nombre', 'estado', 'propietario', 'vence'],
      conditions: [{ field: 'vence', operator: 'not_empty', value: '' }],
      sortBy: 'vence',
      sortDirection: 'asc',
    }
  ),
  preset(
    'docubox-firmas',
    'Participación y firmas',
    'Estado de las personas invitadas a documentos.',
    'participantes',
    {
      fields: ['nombre', 'correo', 'rol', 'estado', 'recurso'],
      conditions: [{ field: 'modulo', operator: 'eq', value: 'Documentos' }],
      groupBy: 'estado',
    }
  ),
  preset(
    'docubox-formularios',
    'Formularios y respuestas',
    'Número de respuestas recibidas por formulario.',
    'formularios',
    {
      fields: ['nombre', 'estado', 'respuestas', 'creador', 'publicado'],
      visualization: 'bar',
      groupBy: 'nombre',
      metric: 'respuestas',
    }
  ),
  preset(
    'docubox-respuestas',
    'Respuestas capturadas',
    'Registro de respuestas recibidas y documentos generados.',
    'respuestas',
    {
      fields: ['formulario', 'participante', 'correo', 'documento', 'enviado', 'estado'],
      groupBy: 'formulario',
    }
  ),
  preset(
    'docubox-expedientes',
    'Avance de expedientes',
    'Estado y progreso de los expedientes.',
    'expedientes',
    { fields: ['folio', 'nombre', 'estado', 'progreso', 'objetivo'], groupBy: 'estado' }
  ),
  {
    ...preset(
      'docubox-tareas',
      'Tareas y plazos',
      'Acciones y actividades pendientes o concluidas.',
      'tareas',
      { fields: ['nombre', 'estado', 'prioridad', 'responsable', 'vence'] }
    ),
    listed: false,
  },
  preset(
    'docubox-tareas-abiertas',
    'Tareas abiertas',
    'Trabajo pendiente, en curso o vencido del espacio.',
    'tareas',
    {
      fields: ['nombre', 'tipo', 'estado', 'prioridad', 'responsable', 'vence'],
      conditions: ['completada', 'cancelada', 'rechazada'].map((value) => ({
        field: 'estado',
        operator: 'neq' as const,
        value,
      })),
      sortBy: 'vence',
      sortDirection: 'asc',
    }
  ),
  preset(
    'docubox-actividad',
    'Actividad y auditoría',
    'Eventos de documentos, formularios, expedientes y tareas del espacio.',
    'actividad',
    {
      fields: ['accion', 'modulo', 'actor', 'documento', 'fecha'],
      conditions: [{ field: 'modulo', operator: 'neq', value: 'Acceso' }],
    }
  ),
  preset(
    'docubox-plantillas',
    'Plantillas documentales',
    'Inventario y configuración de plantillas.',
    'plantillas',
    { fields: ['nombre', 'categoria', 'estado', 'creador', 'actualizado'], groupBy: 'estado' }
  ),
  preset(
    'docubox-certificaciones',
    'Estado de certificaciones',
    'Seguimiento de los casos de certificación.',
    'certificaciones',
    { fields: ['folio', 'nombre', 'servicio', 'estado', 'creado', 'emitido'], groupBy: 'estado' }
  ),
  {
    ...preset(
      'docubox-notificaciones',
      'Avisos recibidos',
      'Notificaciones y recordatorios del usuario.',
      'notificaciones',
      { fields: ['titulo', 'categoria', 'prioridad', 'leida', 'creado'] }
    ),
    listed: false,
  },
  preset(
    'docubox-contactos',
    'Directorio de contactos',
    'Contactos registrados por el usuario.',
    'contactos',
    {
      fields: ['nombre', 'correo', 'telefono', 'tipo', 'creado'],
      sortBy: 'nombre',
      sortDirection: 'asc',
    }
  ),
  preset(
    'docubox-firmas-masivas',
    'Campañas de firma',
    'Documentos completados, pendientes y fallidos por campaña.',
    'firmas_masivas',
    { fields: ['nombre', 'estado', 'total', 'completados', 'pendientes', 'fallidos', 'creado'] }
  ),
];
