export const LUCIA_CAPABILITY_VERSION = 'lucia-phase4-2026-09-05';

export type LuciaAccessMode =
  'authenticated' | 'public_token' | 'public_deterministic' | 'privileged_admin' | 'redirect_alias';

export type LuciaMode = 'enabled' | 'limited' | 'disabled' | 'deterministic_only';

export type LuciaModuleStatus = 'available' | 'in_development';

export type LuciaDataAvailability = 'schema_unavailable' | 'partial' | 'ready';

export type LuciaScope =
  | 'workspace'
  | 'documents'
  | 'document'
  | 'signing'
  | 'participations'
  | 'requests'
  | 'tasks'
  | 'contacts'
  | 'templates'
  | 'forms'
  | 'expedientes'
  | 'notifications'
  | 'certified_notifications'
  | 'certifications'
  | 'batch_signatures'
  | 'credit_titles'
  | 'organization'
  | 'collaboration'
  | 'configuration'
  | 'profile'
  | 'billing'
  | 'reports'
  | 'integrations'
  | 'public_token'
  | 'public_verification'
  | 'authentication'
  | 'admin'
  | 'unsupported';

export type LuciaAssistantPlacement = 'top_nav' | 'floating' | 'none';

export interface LuciaModuleCapability {
  routePattern: string;
  canonicalRoute: string;
  moduleKey: string;
  moduleName: string;
  accessMode: LuciaAccessMode;
  luciaMode: LuciaMode;
  moduleStatus: LuciaModuleStatus;
  dataAvailability: LuciaDataAvailability;
  scope: LuciaScope;
  purpose: string;
  entities: string[];
  dataSources: string[];
  requiredContext: string[];
  suggestedPrompts: string[];
  allowedReadActions: string[];
  disallowedActions: string[];
  sensitiveFields: string[];
  evidenceRequirements: string[];
  assistantPlacement: LuciaAssistantPlacement;
}

type ModuleTemplate = Omit<
  LuciaModuleCapability,
  | 'routePattern'
  | 'canonicalRoute'
  | 'accessMode'
  | 'luciaMode'
  | 'moduleStatus'
  | 'dataAvailability'
  | 'assistantPlacement'
> & {
  accessMode?: LuciaAccessMode;
  luciaMode?: LuciaMode;
  moduleStatus?: LuciaModuleStatus;
  dataAvailability?: LuciaDataAvailability;
  assistantPlacement?: LuciaAssistantPlacement;
};

type RouteDefinition =
  | string
  | {
      routePattern: string;
      canonicalRoute?: string;
      accessMode?: LuciaAccessMode;
      luciaMode?: LuciaMode;
      moduleStatus?: LuciaModuleStatus;
      dataAvailability?: LuciaDataAvailability;
      assistantPlacement?: LuciaAssistantPlacement;
    };

const NEVER_WRITE = [
  'crear, editar o eliminar registros',
  'cambiar estados o permisos',
  'firmar o aprobar por el usuario',
  'ejecutar operaciones administrativas',
];

function defineModule(template: ModuleTemplate, routes: RouteDefinition[]) {
  return routes.map((definition): LuciaModuleCapability => {
    const route = typeof definition === 'string' ? { routePattern: definition } : definition;
    return {
      ...template,
      routePattern: route.routePattern,
      canonicalRoute: route.canonicalRoute || route.routePattern,
      accessMode: route.accessMode || template.accessMode || 'authenticated',
      luciaMode: route.luciaMode || template.luciaMode || 'enabled',
      moduleStatus: route.moduleStatus || template.moduleStatus || 'available',
      dataAvailability: route.dataAvailability || template.dataAvailability || 'ready',
      assistantPlacement: route.assistantPlacement || template.assistantPlacement || 'top_nav',
    };
  });
}

const home = defineModule(
  {
    moduleKey: 'home',
    moduleName: 'Inicio',
    scope: 'workspace',
    purpose: 'Resumir el espacio de trabajo, sus pendientes y actividad reciente.',
    entities: ['workspace', 'documents', 'tasks', 'participations', 'activity'],
    dataSources: [
      'workspaces',
      'documentos',
      'tareas',
      'participation_responses',
      'document_activity_log',
    ],
    requiredContext: [
      'route_context',
      'user_context',
      'workspace_membership',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué requiere atención hoy?',
      'Resume mis pendientes',
      '¿Qué documentos vencen pronto?',
      'Muéstrame la actividad reciente',
    ],
    allowedReadActions: [
      'resumir métricas',
      'listar pendientes',
      'consultar actividad',
      'consultar documentos visibles',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['participant_email', 'actor_email'],
    evidenceRequirements: ['métricas agregadas reales', 'documentos autorizados', 'eventos reales'],
  },
  ['/inicio']
);

const documents = defineModule(
  {
    moduleKey: 'documents',
    moduleName: 'Documentos',
    scope: 'documents',
    purpose: 'Consultar documentos visibles, su metadata, revisión e historial de versiones.',
    entities: [
      'documents',
      'folders',
      'versions',
      'reviewers',
      'activity',
      'document_intelligence',
    ],
    dataSources: [
      'documentos',
      'document_user_visibility',
      'document_versions',
      'document_reviewers',
      'document_activity_log',
      'ai_document_profiles',
      'ai_document_classifications',
      'ai_document_completeness_checks',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_document_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      'Clasifica documentos sin tipo',
      'Sugiere etiquetas',
      'Detecta documentos incompletos',
      'Agrupa por tipo documental',
      'Muéstrame documentos con baja calidad',
    ],
    allowedReadActions: [
      'buscar documentos',
      'filtrar metadata',
      'consultar revisiones',
      'consultar versiones',
      'consultar historial',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['storage_path', 'participant_email', 'deleted_by'],
    evidenceRequirements: [
      'document_id autorizado',
      'filas visibles',
      'versiones o eventos reales',
    ],
  },
  ['/mis-documentos', '/documentos/[documentId]/revision', '/documentos/[documentId]/versiones']
);

const viewer = defineModule(
  {
    moduleKey: 'document_viewer',
    moduleName: 'Visor de documento',
    scope: 'document',
    purpose: 'Explicar el documento actual, sus participantes, contenido, versiones y evidencia.',
    entities: [
      'document',
      'participants',
      'chunks',
      'versions',
      'activity',
      'signature_evidence',
      'document_intelligence',
    ],
    dataSources: [
      'documentos',
      'participation_responses',
      'ai_document_chunks',
      'document_versions',
      'document_activity_log',
      'ai_document_profiles',
      'ai_document_extracted_fields',
      'ai_document_obligations',
      'ai_document_completeness_checks',
    ],
    requiredContext: [
      'route_context',
      'document_id',
      'document_acl',
      'allowed_document_ids',
      'structured_context',
      'rag_context',
    ],
    suggestedPrompts: [
      'Genera ficha inteligente',
      'Extrae datos clave',
      'Detecta obligaciones',
      '¿Qué fechas importantes hay?',
      '¿Qué metadatos sugieres?',
      '¿Está completo este documento?',
    ],
    allowedReadActions: [
      'resumir contenido indexado',
      'consultar participantes',
      'consultar estado',
      'consultar historial',
      'buscar contenido',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['storage_path', 'portal_token_hash', 'otp', 'signature_private_material'],
    evidenceRequirements: [
      'document_id autorizado',
      'chunks autorizados para contenido',
      'filas reales para estado e historial',
    ],
  },
  ['/visor-documento/[id]']
);

const createDocument = defineModule(
  {
    moduleKey: 'create_document',
    moduleName: 'Crear documento',
    scope: 'documents',
    purpose: 'Guiar el asistente de creación sin ejecutar ni guardar acciones.',
    entities: ['draft', 'templates', 'contacts', 'participants', 'workflow_rules'],
    dataSources: ['plantillas', 'contacts', 'tipo_documento', 'grupo_tipo_documento'],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'sanitized_ui_state',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué plantilla me conviene?',
      'Explícame los roles de participantes',
      'Revisa la configuración visible',
      '¿Cómo organizo este documento?',
    ],
    allowedReadActions: [
      'explicar el wizard',
      'consultar plantillas',
      'consultar contactos',
      'explicar reglas de flujo',
    ],
    disallowedActions: [...NEVER_WRITE, 'subir archivos', 'enviar el documento'],
    sensitiveFields: ['file_content', 'participant_phone', 'participant_email'],
    evidenceRequirements: ['estado visible sanitizado', 'plantillas o contactos autorizados'],
    assistantPlacement: 'floating',
  },
  ['/crear-documento']
);

const signing = defineModule(
  {
    moduleKey: 'signing',
    moduleName: 'Firma',
    scope: 'signing',
    purpose: 'Guiar el proceso de firma y explicar los campos y métodos permitidos.',
    entities: ['document', 'participant', 'signature_fields', 'signature_method'],
    dataSources: ['documentos', 'participation_responses', 'signature_field_values'],
    requiredContext: [
      'route_context',
      'document_id',
      'document_acl',
      'participant_scope',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué me falta para firmar?',
      'Explícame la e.firma SAT',
      '¿Cómo funciona la firma autógrafa?',
      '¿Para qué sirve el OTP?',
    ],
    allowedReadActions: [
      'explicar el flujo',
      'listar campos pendientes',
      'explicar métodos permitidos',
    ],
    disallowedActions: [
      ...NEVER_WRITE,
      'manipular OTP',
      'recibir contraseñas o archivos .key/.cer',
    ],
    sensitiveFields: [
      'otp',
      'efirma_password',
      'private_key',
      'certificate_bytes',
      'biometric_data',
    ],
    evidenceRequirements: ['document_id autorizado', 'participación vigente', 'campos reales'],
    luciaMode: 'limited',
    assistantPlacement: 'floating',
  },
  ['/firmar-documento/[id]']
);

const participations = defineModule(
  {
    moduleKey: 'participations',
    moduleName: 'Participaciones',
    scope: 'participations',
    purpose: 'Resumir participaciones, roles, vencimientos y pendientes del usuario.',
    entities: ['participations', 'documents', 'roles', 'deadlines'],
    dataSources: ['participation_responses', 'documentos'],
    requiredContext: ['route_context', 'user_id', 'allowed_document_ids', 'structured_context'],
    suggestedPrompts: [
      'Resume mis participaciones',
      '¿Qué tengo pendiente?',
      '¿Qué vence pronto?',
      'Explícame mi rol',
    ],
    allowedReadActions: [
      'listar participaciones',
      'priorizar pendientes',
      'consultar roles',
      'consultar vencimientos',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['participant_email', 'observaciones'],
    evidenceRequirements: ['participaciones del usuario', 'documentos autorizados'],
  },
  ['/mis-participaciones']
);

const requests = defineModule(
  {
    moduleKey: 'requests',
    moduleName: 'Solicitudes',
    scope: 'requests',
    purpose: 'Consultar solicitudes recibidas o enviadas y explicar sus fechas y estado.',
    entities: ['participation_requests', 'documents', 'participants'],
    dataSources: ['documentos', 'participation_responses'],
    requiredContext: ['route_context', 'user_id', 'allowed_document_ids', 'structured_context'],
    suggestedPrompts: [
      'Resume mis solicitudes',
      '¿Cuáles requieren atención?',
      '¿Qué solicitudes vencen pronto?',
      'Explícame el estado de una solicitud',
    ],
    allowedReadActions: ['listar solicitudes', 'consultar estado', 'consultar fechas límite'],
    disallowedActions: [...NEVER_WRITE, 'aceptar o rechazar solicitudes'],
    sensitiveFields: ['recipient_email', 'recipient_phone'],
    evidenceRequirements: ['solicitudes visibles', 'documentos autorizados'],
  },
  ['/mis-solicitudes']
);

const tasks = defineModule(
  {
    moduleKey: 'tasks',
    moduleName: 'Tareas',
    scope: 'tasks',
    purpose: 'Priorizar y explicar tareas reales, vencimientos y bloqueos.',
    entities: ['tasks', 'task_dependencies', 'participations', 'documents'],
    dataSources: ['tareas', 'task_dependencies', 'participation_responses', 'documentos'],
    requiredContext: ['route_context', 'user_id', 'allowed_document_ids', 'structured_context'],
    suggestedPrompts: [
      '¿Qué debo atender primero?',
      '¿Qué tareas están vencidas?',
      'Explícame los bloqueos',
      'Agrupa mis tareas por urgencia',
    ],
    allowedReadActions: [
      'listar tareas',
      'agrupar por urgencia',
      'consultar bloqueos',
      'consultar vencimientos',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['assignee_email', 'comments'],
    evidenceRequirements: ['tareas asignadas o visibles', 'documentos autorizados'],
  },
  ['/mis-tareas']
);

const contacts = defineModule(
  {
    moduleKey: 'contacts',
    moduleName: 'Contactos',
    scope: 'contacts',
    purpose: 'Consultar el directorio permitido y detectar coincidencias o etiquetas útiles.',
    entities: ['contacts', 'tags', 'workspace'],
    dataSources: ['contacts'],
    requiredContext: ['route_context', 'user_id', 'workspace_membership', 'structured_context'],
    suggestedPrompts: [
      'Busca un contacto',
      '¿Hay posibles duplicados?',
      'Sugiere etiquetas para organizar contactos',
      '¿Qué contactos uso con frecuencia?',
    ],
    allowedReadActions: [
      'buscar contactos',
      'detectar posibles duplicados',
      'sugerir etiquetas',
      'resumir uso',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['email', 'telefono', 'rfc', 'curp', 'notas'],
    evidenceRequirements: ['contactos propiedad del usuario o autorizados'],
  },
  ['/contactos']
);

const templates = defineModule(
  {
    moduleKey: 'templates',
    moduleName: 'Plantillas',
    scope: 'templates',
    purpose: 'Explicar plantillas, variables y estructura sin modificar el editor.',
    entities: ['templates', 'template_variables', 'editor_state'],
    dataSources: ['plantillas', 'ai_document_chunks'],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'sanitized_ui_state',
      'structured_context',
    ],
    suggestedPrompts: [
      'Sugiere variables para esta plantilla',
      'Detecta campos faltantes',
      'Clasifica esta plantilla',
    ],
    allowedReadActions: [
      'consultar plantillas',
      'explicar variables',
      'revisar estructura visible',
      'proponer estructura',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['template_content', 'storage_path'],
    evidenceRequirements: ['plantilla autorizada', 'estado visible o texto indexado'],
  },
  ['/plantillas', { routePattern: '/plantillas/nueva', assistantPlacement: 'floating' }]
);

const forms = defineModule(
  {
    moduleKey: 'forms',
    moduleName: 'Formularios',
    scope: 'forms',
    purpose: 'Explicar campos, validaciones y respuestas autorizadas de formularios.',
    entities: ['forms', 'fields', 'responses', 'validations'],
    dataSources: ['form_templates', 'form_responses', 'form_tokens', 'ai_document_chunks'],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_resource_ids',
      'sanitized_ui_state',
      'structured_context',
    ],
    suggestedPrompts: [
      'Extrae campos sugeridos',
      'Revisa si el formulario está completo',
      'Sugiere validaciones',
    ],
    allowedReadActions: [
      'consultar formularios',
      'explicar campos',
      'resumir respuestas',
      'validar estructura visible',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['response_payload', 'token_hash', 'signer_data'],
    evidenceRequirements: ['formulario autorizado', 'campos o respuestas reales'],
  },
  [
    '/formularios',
    { routePattern: '/formularios/builder', assistantPlacement: 'floating' },
    '/formularios/preview',
    '/formularios/respuestas',
  ]
);

const expedientes = defineModule(
  {
    moduleKey: 'expedientes',
    moduleName: 'Expedientes',
    scope: 'expedientes',
    purpose: 'Resumir expedientes, requisitos, documentos faltantes, auditoría y constancias.',
    entities: ['case_files', 'requirements', 'documents', 'audit', 'certificates'],
    dataSources: [
      'case_files',
      'case_file_documents',
      'case_file_requirements',
      'case_file_audit_events',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_resource_ids',
      'allowed_document_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué documentos faltan?',
      'Revisa completitud del expediente',
      'Agrupa evidencias por tipo',
      'Detecta vencimientos',
    ],
    allowedReadActions: [
      'resumir expediente',
      'listar faltantes',
      'consultar requisitos',
      'consultar auditoría',
      'generar checklist informativo',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['share_token_hash', 'storage_path'],
    evidenceRequirements: [
      'expediente autorizado',
      'documentos autorizados',
      'requisitos o eventos reales',
    ],
  },
  [
    '/expedientes',
    '/expedientes/[id]',
    { routePattern: '/expedientes/nuevo', assistantPlacement: 'floating' },
    '/expedientes/revision',
    '/expedientes/auditoria',
    '/expedientes/constancias',
    '/expedientes/plantillas',
  ]
);

const notifications = defineModule(
  {
    moduleKey: 'notifications',
    moduleName: 'Notificaciones',
    scope: 'notifications',
    purpose: 'Resumir notificaciones personales, urgencia, estado y constancias visibles.',
    entities: ['notifications', 'filters', 'certificates'],
    dataSources: ['notifications'],
    requiredContext: ['route_context', 'user_id', 'structured_context'],
    suggestedPrompts: [
      'Resume mis notificaciones',
      '¿Cuáles son urgentes?',
      '¿Qué notificaciones no he leído?',
      'Explícame el estado mostrado',
    ],
    allowedReadActions: [
      'listar notificaciones',
      'resumir',
      'agrupar por prioridad',
      'explicar estado',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['description', 'entity_id'],
    evidenceRequirements: ['notificaciones del usuario', 'filtros visibles sanitizados'],
  },
  ['/notificaciones']
);

const certifiedNotifications = defineModule(
  {
    moduleKey: 'certified_notifications',
    moduleName: 'Notificaciones certificadas',
    moduleStatus: 'in_development',
    dataAvailability: 'schema_unavailable',
    scope: 'certified_notifications',
    purpose:
      'Consultar destinatarios, entrega, acceso, evidencia y constancias de notificaciones certificadas.',
    entities: ['certified_notifications', 'recipients', 'evidence_events', 'certificates'],
    dataSources: [
      'certified_notifications',
      'notification_recipients',
      'notification_evidence_events',
      'notification_certificates',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_resource_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué destinatarios no han accedido?',
      'Explícame el estado de entrega',
      'Resume la evidencia disponible',
      '¿Qué constancias existen?',
      '¿Cómo debería funcionar este módulo?',
      '¿Qué tablas y permisos necesita?',
    ],
    allowedReadActions: [
      'consultar estado',
      'consultar destinatarios',
      'consultar evidencia',
      'consultar constancias',
    ],
    disallowedActions: [...NEVER_WRITE, 'inventar acuses o constancias'],
    sensitiveFields: ['access_token_hash', 'raw_token', 'recipient_email', 'recipient_phone'],
    evidenceRequirements: [
      'notificación autorizada',
      'destinatarios o eventos reales',
      'constancia existente',
    ],
  },
  [
    '/notificaciones-certificadas',
    '/notificaciones-certificadas/[id]',
    '/notificaciones-certificadas/auditoria',
    '/notificaciones-certificadas/constancias',
    { routePattern: '/notificaciones-certificadas/nueva', assistantPlacement: 'floating' },
  ]
);

const certifications = defineModule(
  {
    moduleKey: 'certifications',
    moduleName: 'Certificaciones',
    scope: 'certifications',
    purpose: 'Explicar estado, consumo, lotes y errores de certificación con evidencia real.',
    entities: ['certification_cases', 'batches', 'usage', 'verification'],
    dataSources: [
      'document_certifications',
      'certification_cases',
      'certification_batches',
      'certification_ledger_entries',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_document_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Por qué falló esta certificación?',
      'Explícame el estado',
      '¿Cuánto consumo llevo?',
      'Resume este lote',
    ],
    allowedReadActions: [
      'consultar estado',
      'explicar estándares en lenguaje simple',
      'consultar consumo',
      'consultar errores',
      'resumir lotes',
    ],
    disallowedActions: [...NEVER_WRITE, 'procesar material criptográfico'],
    sensitiveFields: ['private_key', 'certificate_secret', 'api_secret', 'tsa_credentials'],
    evidenceRequirements: ['certificación o lote autorizado', 'estado, consumo o error real'],
  },
  [
    '/certificaciones',
    '/certificaciones/[id]',
    '/certificaciones/configuracion',
    { routePattern: '/certificaciones/nueva', assistantPlacement: 'floating' },
    { routePattern: '/certificaciones/api', assistantPlacement: 'floating' },
    { routePattern: '/certificaciones/conservados', assistantPlacement: 'floating' },
    { routePattern: '/certificaciones/consumo', assistantPlacement: 'floating' },
    { routePattern: '/certificaciones/lotes', assistantPlacement: 'floating' },
    { routePattern: '/certificaciones/lotes/nuevo', assistantPlacement: 'floating' },
    { routePattern: '/certificaciones/verificaciones', assistantPlacement: 'floating' },
  ]
);

const batchSignatures = defineModule(
  {
    moduleKey: 'batch_signatures',
    moduleName: 'Firmas masivas',
    moduleStatus: 'in_development',
    dataAvailability: 'schema_unavailable',
    scope: 'batch_signatures',
    purpose: 'Resumir lotes, progreso, documentos fallidos y errores de importación sin firmar.',
    entities: ['signature_batches', 'batch_items', 'imports', 'errors'],
    dataSources: ['bulk_signature_campaigns', 'bulk_campaign_items', 'bulk_campaign_imports'],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_document_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué documentos fallaron?',
      'Resume el progreso del lote',
      'Explícame los errores de importación',
      '¿Qué falta para completar el lote?',
      'Diseña el flujo de firmas masivas',
      '¿Qué tablas y permisos necesita?',
    ],
    allowedReadActions: ['resumir lote', 'listar fallos', 'explicar errores', 'consultar progreso'],
    disallowedActions: [...NEVER_WRITE, 'ejecutar una firma masiva'],
    sensitiveFields: ['efirma_password', 'private_key', 'certificate_bytes'],
    evidenceRequirements: [
      'lote autorizado',
      'items asociados a documentos autorizados',
      'errores reales',
    ],
  },
  [
    '/firmas-masivas',
    '/firmas-masivas/[id]',
    '/firmas-masivas/nueva',
    {
      routePattern: '/firmas-masivas/firmar-lote',
      luciaMode: 'limited',
      assistantPlacement: 'floating',
    },
    { routePattern: '/firmas-masivas/importaciones', assistantPlacement: 'floating' },
    {
      routePattern: '/firmas-masivas/configuracion',
      luciaMode: 'limited',
      assistantPlacement: 'floating',
    },
    { routePattern: '/firmas-masivas/plantillas', assistantPlacement: 'floating' },
  ]
);

const creditTitles = defineModule(
  {
    moduleKey: 'credit_titles',
    moduleName: 'Títulos de crédito',
    moduleStatus: 'in_development',
    dataAvailability: 'schema_unavailable',
    scope: 'credit_titles',
    purpose: 'Consultar pagarés, operaciones, carteras, plantillas y evidencia autorizada.',
    entities: ['promissory_notes', 'operations', 'portfolios', 'templates', 'evidence'],
    dataSources: [
      'credit_titles',
      'promissory_notes',
      'title_events',
      'title_portfolios',
      'title_templates',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_resource_ids',
      'allowed_document_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      'Explícame el estado del pagaré',
      'Resume la cartera',
      '¿Qué operaciones están pendientes?',
      'Explícame la evidencia disponible',
      'Define el flujo de títulos de crédito',
      '¿Qué tablas y permisos necesita?',
    ],
    allowedReadActions: [
      'consultar pagarés',
      'resumir cartera',
      'consultar operaciones',
      'explicar evidencia',
      'guiar creación',
    ],
    disallowedActions: [...NEVER_WRITE, 'emitir juicio legal definitivo', 'ejecutar operaciones'],
    sensitiveFields: ['debtor_tax_id', 'beneficiary_data', 'private_evidence'],
    evidenceRequirements: [
      'recurso autorizado',
      'operación o pagaré real',
      'documento asociado autorizado cuando aplique',
    ],
  },
  [
    '/credit-titles',
    { routePattern: '/credit-titles/operations', assistantPlacement: 'floating' },
    { routePattern: '/credit-titles/portfolios', assistantPlacement: 'floating' },
    '/credit-titles/promissory-notes',
    '/credit-titles/promissory-notes/[id]',
    { routePattern: '/credit-titles/promissory-notes/new', assistantPlacement: 'floating' },
    {
      routePattern: '/credit-titles/settings',
      luciaMode: 'limited',
      assistantPlacement: 'floating',
    },
    { routePattern: '/credit-titles/templates', assistantPlacement: 'floating' },
  ]
);

const organization = defineModule(
  {
    moduleKey: 'organization',
    moduleName: 'Organización',
    scope: 'organization',
    purpose: 'Explicar miembros, directorio, roles y permisos efectivos de la organización.',
    entities: ['organization', 'members', 'directory', 'roles', 'permissions'],
    dataSources: [
      'workspace_members',
      'organization_directory_people',
      'organization_roles',
      'organization_permissions',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'rbac',
      'allowed_resource_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      'Explícame los permisos',
      'Resume los miembros',
      '¿Qué configuración está incompleta?',
      'Explícame el directorio',
    ],
    allowedReadActions: [
      'consultar miembros',
      'explicar roles',
      'consultar permisos efectivos',
      'detectar configuración incompleta',
    ],
    disallowedActions: [...NEVER_WRITE, 'modificar roles'],
    sensitiveFields: ['member_email', 'member_phone', 'invitation_token_hash'],
    evidenceRequirements: ['membresía activa', 'RBAC efectivo', 'miembros o permisos visibles'],
    assistantPlacement: 'floating',
  },
  [
    '/organizacion',
    '/organizacion/[section]',
    '/organizacion/directorio/[personId]',
    '/organizacion/miembros/[memberId]',
  ]
);

const collaboration = defineModule(
  {
    moduleKey: 'collaboration',
    moduleName: 'Colabora',
    scope: 'collaboration',
    purpose: 'Resumir espacios, solicitudes, revisiones, bloqueos y reportes visibles.',
    entities: ['collaboration_rooms', 'requests', 'reviews', 'reports', 'entitlements'],
    dataSources: [
      'collaboration_rooms',
      'collaboration_document_requests',
      'collaboration_reviews',
      'collaboration_usage_events',
    ],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'collaboration_entitlement',
      'rbac',
      'allowed_resource_ids',
      'structured_context',
    ],
    suggestedPrompts: [
      '¿Qué bloquea esta revisión?',
      'Resume las solicitudes',
      'Explícame los espacios',
      'Resume el reporte visible',
    ],
    allowedReadActions: [
      'consultar espacios',
      'resumir revisiones',
      'detectar bloqueos',
      'consultar solicitudes',
      'resumir reportes',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['access_token_hash', 'guest_token_hash', 'recipient_email'],
    evidenceRequirements: ['entitlement válido', 'RBAC efectivo', 'recursos visibles'],
    assistantPlacement: 'floating',
  },
  [
    '/colabora',
    '/colabora/[section]',
    '/colabora/[section]/[id]',
    '/colabora/configuracion-inicial',
    '/colabora/configuracion',
    '/colabora/reportes',
  ]
);

const configuration = defineModule(
  {
    moduleKey: 'configuration_security',
    moduleName: 'Configuración y seguridad',
    scope: 'configuration',
    purpose: 'Explicar configuración no secreta, postura de seguridad e identidad.',
    entities: ['workspace_settings', 'sessions', 'mfa', 'passkeys', 'identity_verification'],
    dataSources: ['workspace_members', 'user_security_settings', 'identity_verifications'],
    requiredContext: [
      'route_context',
      'user_id',
      'workspace_membership',
      'sanitized_security_context',
    ],
    suggestedPrompts: [
      'Revisa mi postura de seguridad',
      'Explícame MFA y TOTP',
      '¿Qué sesiones están activas?',
      'Explícame la verificación de identidad',
    ],
    allowedReadActions: [
      'explicar configuración',
      'resumir postura de seguridad',
      'explicar MFA y passkeys',
      'consultar sesiones sanitizadas',
    ],
    disallowedActions: [...NEVER_WRITE, 'mostrar o manipular secretos'],
    sensitiveFields: ['totp_secret', 'otp', 'passkey_challenge', 'biometric_data', 'session_token'],
    evidenceRequirements: ['configuración sanitizada del usuario', 'permisos efectivos'],
    luciaMode: 'limited',
  },
  [
    '/configuracion',
    '/configuracion/verificacion-identidad',
    { routePattern: '/configuracion/verificacion-identidad/[id]', assistantPlacement: 'floating' },
    { routePattern: '/configuracion/verificacion-identidad/nueva', assistantPlacement: 'floating' },
    '/settings/security',
  ]
);

const profile = defineModule(
  {
    moduleKey: 'profile',
    moduleName: 'Mi perfil',
    scope: 'profile',
    purpose:
      'Consultar el perfil propio y detectar datos faltantes con minimización por intención.',
    entities: ['profile', 'autograph_signature', 'linked_efirma'],
    dataSources: ['user_profiles'],
    requiredContext: ['route_context', 'user_id', 'minimal_user_context'],
    suggestedPrompts: [
      '¿Qué datos me faltan?',
      '¿Tengo e.firma vinculada?',
      'Explícame mi firma autógrafa',
      '¿Cuál es mi RFC registrado?',
    ],
    allowedReadActions: [
      'consultar datos propios',
      'detectar campos faltantes',
      'explicar firma vinculada',
    ],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['curp', 'rfc', 'telefono', 'domicilio', 'signature_image'],
    evidenceRequirements: [
      'perfil del usuario',
      'campo sensible solicitado explícitamente y respondido por backend',
    ],
  },
  ['/mi-perfil']
);

const billing = defineModule(
  {
    moduleKey: 'billing',
    moduleName: 'Facturación',
    scope: 'billing',
    purpose: 'Consultar plan, límites y consumo real del espacio de trabajo.',
    entities: ['subscription', 'plan', 'usage'],
    dataSources: ['subscriptions', 'subscription_plans', 'organization_usage_ledger'],
    requiredContext: ['route_context', 'workspace_membership', 'structured_context'],
    suggestedPrompts: [
      '¿Cuánto he consumido?',
      '¿Cuál es mi plan?',
      'Explícame mis límites',
      'Proyecta mi uso con los datos actuales',
    ],
    allowedReadActions: [
      'consultar plan',
      'consultar consumo',
      'explicar límites',
      'proyectar uso con evidencia',
    ],
    disallowedActions: [...NEVER_WRITE, 'prometer facturas sin fuente real'],
    sensitiveFields: ['payment_method', 'billing_address', 'tax_id'],
    evidenceRequirements: ['suscripción, plan o ledger real'],
  },
  ['/facturacion']
);

const reports = defineModule(
  {
    moduleKey: 'reports',
    moduleName: 'Reportes',
    scope: 'reports',
    purpose: 'Explicar métricas y preparar resúmenes a partir de agregados autorizados.',
    entities: ['metrics', 'activity_aggregates', 'filters'],
    dataSources: ['documentos', 'document_activity_log', 'participation_responses'],
    requiredContext: [
      'route_context',
      'workspace_membership',
      'allowed_document_ids',
      'sanitized_ui_state',
      'structured_context',
    ],
    suggestedPrompts: [
      'Resume la actividad',
      'Explícame estas métricas',
      'Sugiere filtros útiles',
      'Prepara un resumen ejecutivo',
    ],
    allowedReadActions: [
      'explicar métricas',
      'resumir agregados',
      'sugerir filtros',
      'preparar resumen',
    ],
    disallowedActions: [...NEVER_WRITE, 'devolver filas masivas'],
    sensitiveFields: ['actor_email', 'participant_email'],
    evidenceRequirements: ['agregados calculados sobre recursos autorizados'],
  },
  ['/reportes']
);

const integrations = defineModule(
  {
    moduleKey: 'integrations',
    moduleName: 'App Market',
    scope: 'integrations',
    purpose: 'Explicar catálogo, disponibilidad, activaciones y permisos de integraciones.',
    entities: ['integration_catalog', 'activations', 'plan', 'permissions'],
    dataSources: ['user_module_preferences', 'subscriptions'],
    requiredContext: ['route_context', 'workspace_membership', 'structured_context'],
    suggestedPrompts: [
      '¿Qué integraciones están disponibles?',
      '¿Qué apps tengo activas?',
      'Recomienda apps para mis módulos',
      'Explícame los permisos de una integración',
    ],
    allowedReadActions: [
      'consultar catálogo',
      'consultar activaciones',
      'explicar permisos',
      'recomendar según módulos activos',
    ],
    disallowedActions: [...NEVER_WRITE, 'instalar o desinstalar integraciones'],
    sensitiveFields: ['oauth_token', 'client_secret', 'webhook_secret'],
    evidenceRequirements: ['catálogo, plan y activaciones reales'],
  },
  ['/app-market']
);

const publicToken = defineModule(
  {
    moduleKey: 'public_token_help',
    moduleName: 'Ayuda del proceso',
    scope: 'public_token',
    purpose: 'Guiar únicamente el paso público asociado a una capacidad temporal válida.',
    entities: ['token_scoped_resource', 'visible_fields', 'process_status'],
    dataSources: ['resolved_public_capability'],
    requiredContext: [
      'route_context',
      'valid_token_grant',
      'token_scoped_resource',
      'sanitized_ui_state',
    ],
    suggestedPrompts: [
      '¿Qué debo hacer en este paso?',
      'Explícame los campos visibles',
      '¿Cuándo vence este acceso?',
      '¿Cuál es el estado del proceso?',
    ],
    allowedReadActions: [
      'explicar el paso actual',
      'explicar campos visibles',
      'consultar estado mínimo',
    ],
    disallowedActions: [
      ...NEVER_WRITE,
      'consultar el workspace completo',
      'revelar otros recursos',
    ],
    sensitiveFields: ['token', 'token_hash', 'otp', 'biometric_data', 'private_key'],
    evidenceRequirements: ['token resuelto por hash', 'grant vigente', 'recurso asociado'],
    accessMode: 'public_token',
    luciaMode: 'limited',
    assistantPlacement: 'floating',
  },
  [
    '/enrolamiento/[token]',
    '/captura-id-movil/[token]',
    '/subir-movil/[token]',
    '/firma-movil/[token]',
    '/portal-participante/[token]',
    '/registro-participante/[token]',
    '/form/[token]',
    '/expediente/[token]',
    '/sala/[publicToken]',
    '/solicitud/[publicToken]',
  ]
);

const deterministicVerification = defineModule(
  {
    moduleKey: 'public_verification',
    moduleName: 'Verificación pública',
    scope: 'public_verification',
    purpose: 'Explicar de forma determinista el resultado verificable mostrado en pantalla.',
    entities: ['verification_result', 'status', 'hash', 'certificate'],
    dataSources: ['public_verification_result'],
    requiredContext: ['route_context', 'sanitized_verification_result'],
    suggestedPrompts: [],
    allowedReadActions: ['explicar el resultado visible'],
    disallowedActions: [
      ...NEVER_WRITE,
      'invocar IA generativa',
      'inferir autenticidad sin evidencia',
    ],
    sensitiveFields: ['token', 'raw_hash_input', 'private_certificate_material'],
    evidenceRequirements: ['resultado determinista verificable'],
    accessMode: 'public_deterministic',
    luciaMode: 'deterministic_only',
    assistantPlacement: 'none',
  },
  [
    '/verificar-documento',
    '/verificar-documento/[identifier]',
    '/verificar-certificacion',
    '/verificar-certificacion/[verificationUuid]',
    '/verificar-certificacion/c/[token]',
    '/verify/promissory-note/[token]',
    '/verify/blockchain/[publicToken]',
    '/notificacion/[token]',
    '/validar-formulario/[id]',
    '/validar-expediente/[id]',
  ]
);

const signingHelp = defineModule(
  {
    moduleKey: 'signing_help',
    moduleName: 'Ayuda de firma',
    scope: 'signing',
    purpose: 'Explicar de forma general los métodos y pasos de firma.',
    entities: ['help_content'],
    dataSources: ['application_help'],
    requiredContext: ['route_context'],
    suggestedPrompts: [
      'Explícame la e.firma SAT',
      '¿Cómo funciona la firma autógrafa?',
      '¿Para qué sirve el OTP?',
    ],
    allowedReadActions: ['explicar métodos de firma'],
    disallowedActions: NEVER_WRITE,
    sensitiveFields: ['otp', 'efirma_password', 'private_key'],
    evidenceRequirements: ['contenido de ayuda aprobado'],
    assistantPlacement: 'floating',
  },
  ['/ayuda-firmado']
);

const redirectAliases = defineModule(
  {
    moduleKey: 'redirect_alias',
    moduleName: 'Redirección',
    scope: 'unsupported',
    purpose: 'Redirigir a la ruta canónica sin configurar un módulo independiente.',
    entities: [],
    dataSources: [],
    requiredContext: [],
    suggestedPrompts: [],
    allowedReadActions: [],
    disallowedActions: ['invocar LucIA en la ruta alias'],
    sensitiveFields: ['token'],
    evidenceRequirements: [],
    accessMode: 'redirect_alias',
    luciaMode: 'disabled',
    assistantPlacement: 'none',
  },
  [
    { routePattern: '/documents-dashboard', canonicalRoute: '/inicio' },
    { routePattern: '/pending-tasks', canonicalRoute: '/mis-tareas' },
    { routePattern: '/participation-requests', canonicalRoute: '/mis-solicitudes' },
    { routePattern: '/notifications', canonicalRoute: '/notificaciones' },
    { routePattern: '/notificationes', canonicalRoute: '/notificaciones' },
    { routePattern: '/sign-up-login-screen', canonicalRoute: '/login' },
    { routePattern: '/notificaciones/[id]', canonicalRoute: '/notificaciones-certificadas/[id]' },
    {
      routePattern: '/notificaciones/auditoria',
      canonicalRoute: '/notificaciones-certificadas/auditoria',
    },
    {
      routePattern: '/notificaciones/constancias',
      canonicalRoute: '/notificaciones-certificadas/constancias',
    },
    { routePattern: '/notificaciones/nueva', canonicalRoute: '/notificaciones-certificadas/nueva' },
    { routePattern: '/v/[token]', canonicalRoute: '/verificar-documento/[identifier]' },
    { routePattern: '/invitacion-organizacion/[token]', canonicalRoute: '/login' },
  ]
);

const admin = defineModule(
  {
    moduleKey: 'admin_control_plane',
    moduleName: 'Control administrativo',
    scope: 'admin',
    purpose: 'Mantener el plano de control privilegiado separado del copiloto tenant.',
    entities: [],
    dataSources: [],
    requiredContext: [],
    suggestedPrompts: [],
    allowedReadActions: [],
    disallowedActions: [
      'usar el copiloto tenant',
      'consultar operaciones administrativas o criptográficas',
    ],
    sensitiveFields: ['all_admin_and_crypto_fields'],
    evidenceRequirements: [],
    accessMode: 'privileged_admin',
    luciaMode: 'disabled',
    assistantPlacement: 'none',
  },
  [
    '/panel/[[...section]]',
    '/admin/[[...section]]',
    '/superadmin/[[...section]]',
    '/admin/security/crypto-e2e',
  ]
);

const disabledSystemPages = defineModule(
  {
    moduleKey: 'system_page',
    moduleName: 'Página del sistema',
    scope: 'authentication',
    purpose: 'Mantener LucIA fuera de autenticación, pruebas y utilidades públicas.',
    entities: [],
    dataSources: [],
    requiredContext: [],
    suggestedPrompts: [],
    allowedReadActions: [],
    disallowedActions: ['invocar LucIA'],
    sensitiveFields: ['password', 'otp', 'session_token'],
    evidenceRequirements: [],
    luciaMode: 'disabled',
    assistantPlacement: 'none',
  },
  [
    '/login',
    '/login/totp-verification',
    '/auth',
    '/auth/passkey-enrollment',
    '/auth/passkey-verification',
    '/auth/totp-enrollment',
    '/auth/totp-verification',
    '/registro',
    '/olvide-contrasena',
    '/verificar-correo',
    '/register-device',
    '/test-notifications',
  ]
);

const fallback: LuciaModuleCapability = {
  routePattern: '/*',
  canonicalRoute: '/*',
  moduleKey: 'unsupported',
  moduleName: 'Ruta no compatible',
  accessMode: 'authenticated',
  luciaMode: 'disabled',
  moduleStatus: 'available',
  dataAvailability: 'ready',
  scope: 'unsupported',
  purpose: 'Evitar que una ruta no inventariada invoque LucIA.',
  entities: [],
  dataSources: [],
  requiredContext: [],
  suggestedPrompts: [],
  allowedReadActions: [],
  disallowedActions: ['invocar LucIA'],
  sensitiveFields: [],
  evidenceRequirements: [],
  assistantPlacement: 'none',
};

export const MODULE_CAPABILITIES: LuciaModuleCapability[] = [
  ...home,
  ...documents,
  ...viewer,
  ...createDocument,
  ...signing,
  ...participations,
  ...requests,
  ...tasks,
  ...contacts,
  ...templates,
  ...forms,
  ...expedientes,
  ...notifications,
  ...certifiedNotifications,
  ...certifications,
  ...batchSignatures,
  ...creditTitles,
  ...organization,
  ...collaboration,
  ...configuration,
  ...profile,
  ...billing,
  ...reports,
  ...integrations,
  ...publicToken,
  ...deterministicVerification,
  ...signingHelp,
  ...redirectAliases,
  ...admin,
  ...disabledSystemPages,
];

function normalizeRoute(route: string) {
  const path = (route || '/').split('?')[0].split('#')[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function matchPattern(pattern: string, route: string): Record<string, string> | null {
  if (pattern === '/*') return {};
  const expected = normalizeRoute(pattern).split('/').filter(Boolean);
  const actual = normalizeRoute(route).split('/').filter(Boolean);
  const params: Record<string, string> = {};
  let actualIndex = 0;

  for (const segment of expected) {
    const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
    const dynamic = segment.match(/^\[(.+)\]$/);
    if (optionalCatchAll || catchAll) {
      const name = (optionalCatchAll || catchAll)![1];
      const rest = actual.slice(actualIndex).join('/');
      if (!rest && catchAll) return null;
      if (rest) params[name] = rest;
      actualIndex = actual.length;
      break;
    }
    if (actualIndex >= actual.length) return null;
    if (dynamic) params[dynamic[1]] = decodeURIComponent(actual[actualIndex]);
    else if (segment !== actual[actualIndex]) return null;
    actualIndex += 1;
  }
  return actualIndex === actual.length ? params : null;
}

export function resolveLuciaCapability(route: string): LuciaModuleCapability {
  const normalized = normalizeRoute(route);
  const matches = MODULE_CAPABILITIES.filter((capability) =>
    matchPattern(capability.routePattern, normalized)
  );
  matches.sort((left, right) => {
    const score = (pattern: string) =>
      pattern
        .split('/')
        .filter(Boolean)
        .reduce((total, segment) => total + (segment.startsWith('[') ? 1 : 10), 0);
    return score(right.routePattern) - score(left.routePattern);
  });
  return matches[0] || fallback;
}

export function extractLuciaRouteParams(route: string, capability = resolveLuciaCapability(route)) {
  return matchPattern(capability.routePattern, normalizeRoute(route)) || {};
}

export function getLuciaModuleConfig(scopeOrRoute: LuciaScope | string): LuciaModuleCapability {
  if (scopeOrRoute.startsWith('/')) return resolveLuciaCapability(scopeOrRoute);
  return (
    MODULE_CAPABILITIES.find(
      (capability) => capability.scope === scopeOrRoute && capability.luciaMode !== 'disabled'
    ) || fallback
  );
}

export function getQuickSuggestions(scopeOrRoute: LuciaScope | string): string[] {
  return getLuciaModuleConfig(scopeOrRoute).suggestedPrompts;
}

export function isPublicTokenScope(scopeOrRoute: LuciaScope | string): boolean {
  return getLuciaModuleConfig(scopeOrRoute).accessMode === 'public_token';
}

export function isLuciaAvailable(capability: LuciaModuleCapability) {
  return (
    capability.luciaMode === 'enabled' ||
    capability.luciaMode === 'limited' ||
    capability.luciaMode === 'deterministic_only'
  );
}

export default MODULE_CAPABILITIES;
