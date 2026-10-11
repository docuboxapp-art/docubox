export type DatasetId = 'documentos' | 'plantillas' | 'formularios' | 'respuestas' | 'expedientes' | 'tareas' | 'participantes' | 'actividad' | 'usuarios' | 'contactos' | 'certificaciones' | 'notificaciones' | 'colaboracion';
export type FieldType = 'text' | 'number' | 'date' | 'boolean';
export type ReportField = { id: string; label: string; type: FieldType };
export type ReportRow = Record<string, string | number | boolean | null>;
export type Operator = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty';
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
  sortBy: string;
  sortDirection: 'asc' | 'desc';
};
export type ReportDefinition = { id: string; workspace_id?: string; created_by?: string; name: string; description: string; dataset: DatasetId; config: ReportConfig; created_at?: string; updated_at?: string; system?: boolean };

export const DATASETS: Record<DatasetId, { label: string; description: string; icon: string; fields: ReportField[] }> = {
  documentos: { label: 'Documentos', description: 'Estado, plazos, propiedad y participación.', icon: 'file', fields: [
    { id: 'nombre', label: 'Documento', type: 'text' }, { id: 'folio', label: 'Folio', type: 'text' },
    { id: 'descripcion', label: 'Descripción', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'tipo', label: 'Tipo documental', type: 'text' }, { id: 'propietario', label: 'Propietario', type: 'text' },
    { id: 'participantes', label: 'Participantes', type: 'number' }, { id: 'urgente', label: 'Urgente', type: 'boolean' },
    { id: 'tamano', label: 'Tamaño (bytes)', type: 'number' }, { id: 'creado', label: 'Creado', type: 'date' },
    { id: 'actualizado', label: 'Actualizado', type: 'date' }, { id: 'vence', label: 'Vence', type: 'date' },
    { id: 'completado', label: 'Completado', type: 'date' },
  ] },
  plantillas: { label: 'Plantillas', description: 'Uso y configuración de plantillas documentales.', icon: 'template', fields: [
    { id: 'nombre', label: 'Plantilla', type: 'text' }, { id: 'descripcion', label: 'Descripción', type: 'text' },
    { id: 'categoria', label: 'Categoría', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'idioma', label: 'Idioma', type: 'text' }, { id: 'efirma', label: 'Requiere e.firma', type: 'boolean' },
    { id: 'nom151', label: 'Requiere NOM-151', type: 'boolean' }, { id: 'campos', label: 'Campos', type: 'number' },
    { id: 'creador', label: 'Creada por', type: 'text' }, { id: 'creado', label: 'Creada', type: 'date' }, { id: 'actualizado', label: 'Actualizada', type: 'date' },
  ] },
  formularios: { label: 'Formularios', description: 'Publicación, respuestas y configuración.', icon: 'form', fields: [
    { id: 'nombre', label: 'Formulario', type: 'text' }, { id: 'descripcion', label: 'Descripción', type: 'text' },
    { id: 'estado', label: 'Estado', type: 'text' }, { id: 'version', label: 'Versión', type: 'number' },
    { id: 'campos', label: 'Campos', type: 'number' }, { id: 'respuestas', label: 'Respuestas', type: 'number' },
    { id: 'creador', label: 'Creado por', type: 'text' }, { id: 'creado', label: 'Creado', type: 'date' }, { id: 'actualizado', label: 'Actualizado', type: 'date' },
  ] },
  respuestas: { label: 'Respuestas', description: 'Envíos de formularios y campos capturados.', icon: 'response', fields: [
    { id: 'formulario', label: 'Formulario', type: 'text' }, { id: 'participante', label: 'Participante', type: 'text' },
    { id: 'correo', label: 'Correo', type: 'text' }, { id: 'documento', label: 'Documento generado', type: 'text' },
    { id: 'enviado', label: 'Fecha de respuesta', type: 'date' }, { id: 'estado', label: 'Estado', type: 'text' },
  ] },
  expedientes: { label: 'Expedientes', description: 'Avance, responsables y cierres.', icon: 'folder', fields: [
    { id: 'folio', label: 'Folio', type: 'text' }, { id: 'nombre', label: 'Expediente', type: 'text' },
    { id: 'descripcion', label: 'Descripción', type: 'text' }, { id: 'tipo', label: 'Tipo', type: 'text' },
    { id: 'estado', label: 'Estado', type: 'text' }, { id: 'prioridad', label: 'Prioridad', type: 'text' },
    { id: 'progreso', label: 'Progreso (%)', type: 'number' }, { id: 'responsable', label: 'Responsable', type: 'text' },
    { id: 'creado', label: 'Creado', type: 'date' }, { id: 'objetivo', label: 'Fecha objetivo', type: 'date' },
    { id: 'cerrado', label: 'Cerrado', type: 'date' },
  ] },
  tareas: { label: 'Tareas y acciones', description: 'Asignaciones, estados y plazos.', icon: 'task', fields: [
    { id: 'nombre', label: 'Tarea', type: 'text' }, { id: 'descripcion', label: 'Descripción', type: 'text' },
    { id: 'tipo', label: 'Tipo', type: 'text' }, { id: 'clase', label: 'Acción o actividad', type: 'text' },
    { id: 'estado', label: 'Estado', type: 'text' }, { id: 'prioridad', label: 'Prioridad', type: 'text' },
    { id: 'riesgo', label: 'Riesgo', type: 'text' }, { id: 'origen', label: 'Origen', type: 'text' },
    { id: 'responsable', label: 'Responsable', type: 'text' }, { id: 'creador', label: 'Creada por', type: 'text' },
    { id: 'recurso', label: 'Recurso vinculado', type: 'text' }, { id: 'creado', label: 'Creada', type: 'date' },
    { id: 'vence', label: 'Fecha límite', type: 'date' }, { id: 'completado', label: 'Completada', type: 'date' },
  ] },
  participantes: { label: 'Participantes', description: 'Personas vinculadas a documentos y expedientes.', icon: 'users', fields: [
    { id: 'nombre', label: 'Participante', type: 'text' }, { id: 'correo', label: 'Correo', type: 'text' },
    { id: 'rol', label: 'Rol', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'recurso', label: 'Recurso', type: 'text' }, { id: 'modulo', label: 'Módulo', type: 'text' },
    { id: 'creado', label: 'Vinculado', type: 'date' },
  ] },
  actividad: { label: 'Actividad y eventos', description: 'Acciones del usuario y de participantes en documentos.', icon: 'activity', fields: [
    { id: 'accion', label: 'Acción', type: 'text' }, { id: 'categoria', label: 'Categoría', type: 'text' },
    { id: 'actor', label: 'Realizada por', type: 'text' }, { id: 'correo', label: 'Correo del actor', type: 'text' },
    { id: 'documento', label: 'Recurso', type: 'text' }, { id: 'modulo', label: 'Módulo', type: 'text' },
    { id: 'fecha', label: 'Fecha', type: 'date' },
  ] },
  usuarios: { label: 'Usuarios del espacio', description: 'Integrantes, roles y fechas de ingreso.', icon: 'users', fields: [
    { id: 'nombre', label: 'Usuario', type: 'text' }, { id: 'correo', label: 'Correo', type: 'text' },
    { id: 'rol', label: 'Rol', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'ingreso', label: 'Ingreso', type: 'date' },
  ] },
  contactos: { label: 'Contactos', description: 'Directorio personal e interacciones de contacto.', icon: 'users', fields: [
    { id: 'nombre', label: 'Nombre', type: 'text' }, { id: 'correo', label: 'Correo', type: 'text' },
    { id: 'telefono', label: 'Teléfono', type: 'text' }, { id: 'empresa', label: 'Empresa', type: 'text' },
    { id: 'cargo', label: 'Cargo', type: 'text' }, { id: 'tipo', label: 'Tipo de persona', type: 'text' },
    { id: 'rol', label: 'Rol', type: 'text' }, { id: 'canal', label: 'Canal preferido', type: 'text' },
    { id: 'creado', label: 'Creado', type: 'date' }, { id: 'actualizado', label: 'Actualizado', type: 'date' },
  ] },
  certificaciones: { label: 'Certificaciones', description: 'Casos, servicios y estado de certificación.', icon: 'file', fields: [
    { id: 'folio', label: 'Folio', type: 'text' }, { id: 'nombre', label: 'Certificación', type: 'text' },
    { id: 'descripcion', label: 'Descripción', type: 'text' }, { id: 'origen', label: 'Origen', type: 'text' },
    { id: 'servicio', label: 'Servicio', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'modo', label: 'Proveedor', type: 'text' }, { id: 'creador', label: 'Creado por', type: 'text' },
    { id: 'creado', label: 'Creado', type: 'date' }, { id: 'enviado', label: 'Enviado', type: 'date' },
    { id: 'emitido', label: 'Emitido', type: 'date' }, { id: 'validado', label: 'Validado', type: 'date' },
  ] },
  notificaciones: { label: 'Notificaciones', description: 'Avisos recibidos por el usuario.', icon: 'activity', fields: [
    { id: 'titulo', label: 'Aviso', type: 'text' }, { id: 'descripcion', label: 'Descripción', type: 'text' },
    { id: 'tipo', label: 'Tipo', type: 'text' }, { id: 'categoria', label: 'Categoría', type: 'text' },
    { id: 'prioridad', label: 'Prioridad', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'leida', label: 'Leída', type: 'boolean' }, { id: 'creado', label: 'Recibida', type: 'date' },
    { id: 'leido', label: 'Leída el', type: 'date' },
  ] },
  colaboracion: { label: 'Colaboración', description: 'Espacios de trabajo colaborativo y su avance.', icon: 'folder', fields: [
    { id: 'nombre', label: 'Espacio', type: 'text' }, { id: 'descripcion', label: 'Descripción', type: 'text' },
    { id: 'tipo', label: 'Tipo', type: 'text' }, { id: 'estado', label: 'Estado', type: 'text' },
    { id: 'confidencialidad', label: 'Confidencialidad', type: 'text' }, { id: 'responsable', label: 'Responsable', type: 'text' },
    { id: 'creado', label: 'Creado', type: 'date' }, { id: 'cerrado', label: 'Cerrado', type: 'date' },
  ] },
};

export const datasetIds = Object.keys(DATASETS) as DatasetId[];
export function defaultConfig(dataset: DatasetId): ReportConfig {
  const fields = DATASETS[dataset].fields;
  const dateField = fields.find(field => field.type === 'date')?.id || '';
  return { fields: fields.slice(0, 5).map(field => field.id), conditions: [], match: 'all', period: 'all', dateField,
    visualization: 'table', groupBy: '', metric: '__count', sortBy: dateField, sortDirection: 'desc' };
}

function preset(id: string, name: string, description: string, dataset: DatasetId, overrides: Partial<ReportConfig> = {}): ReportDefinition {
  return { id, name, description, dataset, system: true, config: { ...defaultConfig(dataset), ...overrides } };
}
export const BUILTIN_REPORTS: ReportDefinition[] = [
  preset('docubox-documentos', 'Estado de documentos', 'Volumen y situación de documentos del espacio.', 'documentos', { visualization: 'bar', groupBy: 'estado' }),
  preset('docubox-vencimientos', 'Documentos con vencimiento', 'Plazos documentales y seguimiento.', 'documentos', { fields: ['nombre','estado','propietario','vence'], conditions: [{ field: 'vence', operator: 'not_empty', value: '' }], sortBy: 'vence' }),
  preset('docubox-firmas', 'Participación y firmas', 'Estado de las personas invitadas a documentos.', 'participantes', { fields: ['nombre','correo','rol','estado','recurso'], conditions: [{ field: 'modulo', operator: 'eq', value: 'Documentos' }] }),
  preset('docubox-formularios', 'Formularios y respuestas', 'Actividad de formularios publicados y sus respuestas.', 'formularios', { fields: ['nombre','estado','respuestas','creador','creado'], visualization: 'bar', groupBy: 'estado' }),
  preset('docubox-expedientes', 'Avance de expedientes', 'Estado y progreso de los expedientes.', 'expedientes', { fields: ['folio','nombre','estado','progreso','objetivo'] }),
  preset('docubox-tareas', 'Tareas y plazos', 'Acciones y actividades pendientes o concluidas.', 'tareas', { fields: ['nombre','estado','prioridad','responsable','vence'] }),
  preset('docubox-actividad', 'Actividad y auditoría', 'Interacciones registradas sobre documentos.', 'actividad', { fields: ['accion','actor','documento','fecha'] }),
  preset('docubox-plantillas', 'Plantillas documentales', 'Inventario y configuración de plantillas.', 'plantillas', { fields: ['nombre','categoria','estado','creador','actualizado'] }),
  preset('docubox-certificaciones', 'Estado de certificaciones', 'Seguimiento de los casos de certificación.', 'certificaciones', { fields: ['folio','nombre','servicio','estado','creado','emitido'] }),
  preset('docubox-notificaciones', 'Avisos recibidos', 'Notificaciones y recordatorios del usuario.', 'notificaciones', { fields: ['titulo','categoria','prioridad','leida','creado'] }),
];
