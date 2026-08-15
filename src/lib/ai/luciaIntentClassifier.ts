export type LuciaIntent =
  | 'user_profile'
  | 'user_profile_sensitive'
  | 'user_usage'
  | 'billing_status'
  | 'user_created_documents'
  | 'user_assigned_documents'
  | 'user_participations'
  | 'document_types_assigned'
  | 'document_status_search'
  | 'signature_status'
  | 'pending_tasks'
  | 'notifications_search'
  | 'activity_history'
  | 'expediente_search'
  | 'contacts_search'
  | 'templates_help'
  | 'forms_help'
  | 'document_content_search'
  | 'document_summary'
  | 'legal_analysis'
  | 'compliance_analysis'
  | 'contract_generation'
  | 'signing_help'
  | 'external_participant_help'
  | 'configuration_security'
  | 'reports_analysis'
  | 'general_help';

export type QueryMode = 'structured' | 'rag' | 'both';

export interface IntentResult {
  intent: LuciaIntent;
  mode: QueryMode;
  extractedDocumentId?: string;
  extractedStatus?: string;
  extractedUserName?: string;
  extractedCarpetaId?: string;
}

// ── Route → scope mapping ──────────────────────────────────────────────────

export type LuciaScope =
  | 'auth'
  | 'registration'
  | 'email_verification'
  | 'password_recovery'
  | 'dashboard'
  | 'documents'
  | 'create_document'
  | 'document_viewer'
  | 'signing'
  | 'participations'
  | 'participation_requests'
  | 'contacts'
  | 'external_participant'
  | 'external_registration'
  | 'public_form'
  | 'forms'
  | 'form_builder'
  | 'templates'
  | 'reports'
  | 'billing'
  | 'profile'
  | 'settings'
  | 'mobile_enrollment'
  | 'mobile_upload'
  | 'mobile_id_capture'
  | 'notifications'
  | 'pending_tasks'
  | 'integrations'
  | 'signing_help_page'
  | 'workspace';

// ── RouteContext structured object ─────────────────────────────────────────

export interface RouteContext {
  route: string;
  screen_name: string;
  purpose: string;
  available_entities: string[];
  available_fields: string[];
  available_actions: string[];
  current_resource_ids: Record<string, string | null>;
  ui_state: Record<string, any>;
}

export function getScopeFromRoute(route: string): LuciaScope {
  if (!route) return 'workspace';
  const r = route.split('?')[0]; // strip query params
  if (r === '/login' || r === '/auth' || r === '/sign-up-login-screen') return 'auth';
  if (r === '/registro') return 'registration';
  if (r === '/verificar-correo') return 'email_verification';
  if (r === '/olvide-contrasena') return 'password_recovery';
  if (r === '/inicio' || r === '/documents-dashboard') return 'dashboard';
  if (r === '/mis-documentos') return 'documents';
  if (r === '/crear-documento') return 'create_document';
  if (r.startsWith('/visor-documento/')) return 'document_viewer';
  if (r.startsWith('/firmar-documento/')) return 'signing';
  if (r === '/mis-participaciones') return 'participations';
  if (r === '/mis-solicitudes' || r === '/participation-requests') return 'participation_requests';
  if (r === '/contactos') return 'contacts';
  if (r.startsWith('/portal-participante/')) return 'external_participant';
  if (r.startsWith('/registro-participante/')) return 'external_registration';
  if (r.startsWith('/form/')) return 'public_form';
  if (r === '/formularios/builder') return 'form_builder';
  if (r === '/formularios') return 'forms';
  if (r === '/plantillas') return 'templates';
  if (r === '/reportes') return 'reports';
  if (r === '/facturacion') return 'billing';
  if (r === '/mi-perfil') return 'profile';
  if (r === '/configuracion') return 'settings';
  if (r.startsWith('/enrolamiento/')) return 'mobile_enrollment';
  if (r.startsWith('/subir-movil/')) return 'mobile_upload';
  if (r.startsWith('/captura-id-movil/')) return 'mobile_id_capture';
  if (r === '/notifications') return 'notifications';
  if (r === '/mis-tareas' || r === '/pending-tasks') return 'pending_tasks';
  if (r === '/app-market') return 'integrations';
  if (r === '/ayuda-firmado') return 'signing_help_page';
  return 'workspace';
}

export function buildRouteContext(
  route: string,
  scope: LuciaScope,
  documentId?: string,
  token?: string,
  params?: Record<string, string>
): RouteContext {
  const r = route.split('?')[0];

  const routeMap: Record<
    LuciaScope,
    Omit<RouteContext, 'route' | 'current_resource_ids' | 'ui_state'>
  > = {
    auth: {
      screen_name: 'Autenticación',
      purpose: 'Inicio de sesión y registro de usuario',
      available_entities: ['auth', 'user_registration'],
      available_fields: ['email', 'password', 'nombre', 'apellido'],
      available_actions: ['iniciar sesión', 'registrar usuario', 'recuperar contraseña'],
    },
    registration: {
      screen_name: 'Registro de usuario',
      purpose: 'Registro con verificación de correo electrónico',
      available_entities: ['user_registration', 'email_verification'],
      available_fields: ['nombre_completo', 'email', 'telefono', 'contraseña'],
      available_actions: ['registrar', 'verificar correo', 'reenviar código'],
    },
    email_verification: {
      screen_name: 'Verificación de correo',
      purpose: 'Confirmar email del usuario mediante código',
      available_entities: ['verification_token'],
      available_fields: ['codigo_verificacion'],
      available_actions: ['verificar correo', 'reenviar código'],
    },
    password_recovery: {
      screen_name: 'Recuperación de contraseña',
      purpose: 'Restablecimiento de contraseña vía OTP/email',
      available_entities: ['password_reset', 'otp'],
      available_fields: ['email', 'otp', 'nueva_contraseña'],
      available_actions: ['enviar código', 'validar OTP', 'actualizar contraseña'],
    },
    dashboard: {
      screen_name: 'Dashboard principal',
      purpose: 'Vista general con métricas, actividad reciente y estado de documentos',
      available_entities: ['documents', 'participations', 'activity', 'metrics'],
      available_fields: [
        'total_documents',
        'pending_documents',
        'signed_documents',
        'rejected_documents',
        'activity_feed',
        'expiring_soon',
      ],
      available_actions: [
        'abrir documento',
        'revisar actividad',
        'generar reporte',
        'ver documentos pendientes',
        'ver documentos vencidos',
      ],
    },
    documents: {
      screen_name: 'Mis documentos',
      purpose: 'Listado y gestión documental del usuario con filtros avanzados',
      available_entities: ['documents', 'folders', 'tags', 'participants'],
      available_fields: [
        'nombre',
        'estado',
        'fecha',
        'participantes',
        'etiquetas',
        'carpeta',
        'tipo_documento',
      ],
      available_actions: [
        'ver',
        'descargar',
        'cancelar',
        'reenviar recordatorio',
        'filtrar por estado',
        'filtrar por carpeta',
        'personalizar vista',
      ],
    },
    create_document: {
      screen_name: 'Crear documento',
      purpose: 'Flujo de 6 pasos para crear y enviar un documento a firmar',
      available_entities: ['document_draft', 'participants', 'workflow', 'folders', 'tags'],
      available_fields: [
        'nombre_documento',
        'tipo_documento',
        'participantes',
        'rol_participante',
        'orden_firma',
        'fecha_limite',
        'recordatorios',
        'carpeta',
        'etiquetas',
      ],
      available_actions: [
        'subir archivo',
        'agregar participante',
        'configurar flujo',
        'establecer fecha límite',
        'enviar documento',
        'guardar borrador',
      ],
    },
    document_viewer: {
      screen_name: 'Visor documento',
      purpose: 'Visualización y análisis documental con historial, notas y chat IA',
      available_entities: ['document', 'participants', 'audit_log', 'notes', 'ai_chat'],
      available_fields: [
        'estado',
        'participantes',
        'fechas',
        'notas',
        'historial',
        'contenido_pdf',
      ],
      available_actions: [
        'resumir documento',
        'detectar riesgos',
        'mostrar historial',
        'revisar participantes',
        'agregar nota',
        'descargar documento',
        'ver auditoría',
      ],
    },
    signing: {
      screen_name: 'Firmar documento',
      purpose: 'Flujo de firma con múltiples métodos de autenticación biométrica y e.firma',
      available_entities: ['document', 'signature_fields', 'biometric_data', 'otp', 'efirma'],
      available_fields: [
        'estado_firma',
        'campos_firma',
        'metodo_firma',
        'similitud_biometrica',
        'otp_sms',
      ],
      available_actions: [
        'firmar con autógrafa',
        'firmar con e.firma',
        'validar OTP',
        'capturar selfie',
        'ver documento',
      ],
    },
    participations: {
      screen_name: 'Mis participaciones',
      purpose: 'Documentos en los que el usuario participa como firmante, revisor o aprobador',
      available_entities: ['participations', 'documents', 'roles'],
      available_fields: ['documento', 'remitente', 'rol', 'estado', 'fecha_limite', 'firmado_at'],
      available_actions: ['ir a firmar', 'ver documento', 'filtrar por estado', 'filtrar por rol'],
    },
    participation_requests: {
      screen_name: 'Solicitudes de participación',
      purpose: 'Gestión de solicitudes entrantes para participar en documentos',
      available_entities: ['participation_requests', 'documents'],
      available_fields: ['documento', 'solicitante', 'fecha', 'tipo_participacion', 'estado'],
      available_actions: ['aceptar solicitud', 'rechazar solicitud', 'ver documento'],
    },
    contacts: {
      screen_name: 'Contactos',
      purpose: 'Directorio de contactos del workspace para invitar a documentos',
      available_entities: ['contacts', 'tags', 'roles'],
      available_fields: ['nombre', 'email', 'telefono', 'empresa', 'rol', 'etiqueta'],
      available_actions: [
        'buscar contacto',
        'agregar contacto',
        'editar contacto',
        'eliminar contacto',
        'invitar a documento',
      ],
    },
    external_participant: {
      screen_name: 'Portal del participante',
      purpose: 'Portal externo para participantes no registrados que deben firmar un documento',
      available_entities: ['document', 'participant_data'],
      available_fields: ['nombre_documento', 'remitente', 'tipo_participacion', 'estado'],
      available_actions: ['ver documento', 'iniciar firma', 'registrarse'],
    },
    external_registration: {
      screen_name: 'Registro de participante',
      purpose: 'Registro rápido para participantes invitados a un documento',
      available_entities: ['participant_registration'],
      available_fields: ['nombre', 'email', 'telefono', 'contrasena'],
      available_actions: ['registrarse', 'aceptar términos'],
    },
    public_form: {
      screen_name: 'Formulario público',
      purpose: 'Formulario accesible por token para participantes externos',
      available_entities: ['form', 'form_fields', 'signature'],
      available_fields: ['campos_dinamicos', 'firma_digital'],
      available_actions: ['llenar formulario', 'firmar', 'enviar formulario'],
    },
    forms: {
      screen_name: 'Formularios',
      purpose: 'Constructor de formularios personalizados con campos dinámicos',
      available_entities: ['form_templates', 'form_fields'],
      available_fields: ['nombre_formulario', 'campos', 'tipo_campo', 'validaciones'],
      available_actions: [
        'crear formulario',
        'editar formulario',
        'previsualizar',
        'publicar formulario',
      ],
    },
    form_builder: {
      screen_name: 'Constructor de formularios',
      purpose: 'Editor drag-and-drop para construir formularios con campos personalizados',
      available_entities: ['form_fields', 'field_library'],
      available_fields: ['etiqueta', 'placeholder', 'requerido', 'tipo_campo', 'validaciones'],
      available_actions: [
        'agregar campo',
        'reordenar campos',
        'configurar propiedades',
        'previsualizar',
        'guardar formulario',
      ],
    },
    templates: {
      screen_name: 'Plantillas',
      purpose: 'Constructor de plantillas de documentos con variables dinámicas',
      available_entities: ['templates', 'template_variables'],
      available_fields: ['nombre_plantilla', 'descripcion', 'categoria', 'variables', 'contenido'],
      available_actions: [
        'crear plantilla',
        'editar plantilla',
        'insertar variable',
        'previsualizar',
        'usar plantilla',
      ],
    },
    reports: {
      screen_name: 'Reportes',
      purpose: 'Generación de reportes de actividad y uso del sistema',
      available_entities: ['reports', 'activity', 'documents', 'users'],
      available_fields: ['rango_fechas', 'tipo_documento', 'usuario', 'estado', 'metricas'],
      available_actions: [
        'generar reporte',
        'exportar CSV',
        'exportar PDF',
        'filtrar por fecha',
        'filtrar por usuario',
      ],
    },
    billing: {
      screen_name: 'Facturación',
      purpose: 'Gestión del plan de suscripción, consumo y facturación',
      available_entities: ['subscription', 'invoices', 'plans'],
      available_fields: [
        'plan_actual',
        'documentos_usados',
        'documentos_limite',
        'historial_pagos',
        'fecha_renovacion',
      ],
      available_actions: [
        'ver plan actual',
        'cambiar plan',
        'ver historial de pagos',
        'descargar factura',
      ],
    },
    profile: {
      screen_name: 'Mi perfil',
      purpose: 'Gestión de perfil y datos personales del usuario',
      available_entities: ['profile', 'efirma', 'biometric_data'],
      available_fields: [
        'nombre',
        'email',
        'telefono',
        'RFC',
        'CURP',
        'firma_autografa',
        'domicilio_fiscal',
        'regimen_fiscal',
      ],
      available_actions: [
        'actualizar perfil',
        'cambiar contraseña',
        'revisar eFirma',
        'actualizar firma autógrafa',
        'ver datos fiscales',
      ],
    },
    settings: {
      screen_name: 'Configuración',
      purpose: 'Ajustes generales del workspace, seguridad y notificaciones',
      available_entities: ['workspace_settings', 'security', 'notifications_config', 'team_roles'],
      available_fields: [
        'nombre_workspace',
        'logo',
        'zona_horaria',
        '2fa',
        'sesiones_activas',
        'notificaciones',
      ],
      available_actions: [
        'actualizar workspace',
        'activar 2FA',
        'gestionar sesiones',
        'configurar notificaciones',
        'gestionar roles',
      ],
    },
    mobile_enrollment: {
      screen_name: 'Enrolamiento biométrico',
      purpose: 'Proceso de captura biométrica para registro facial del usuario',
      available_entities: ['enrollment', 'biometric_capture', 'id_document'],
      available_fields: ['selfie', 'identificacion_oficial', 'curp', 'resultado_ocr'],
      available_actions: [
        'capturar selfie',
        'capturar identificación',
        'validar CURP',
        'completar enrolamiento',
      ],
    },
    mobile_upload: {
      screen_name: 'Subida móvil',
      purpose: 'Pantalla móvil para subir documentos desde el teléfono',
      available_entities: ['mobile_upload_session', 'file'],
      available_fields: ['archivo', 'tipo_archivo', 'vista_previa'],
      available_actions: ['seleccionar archivo', 'subir archivo', 'confirmar envío'],
    },
    mobile_id_capture: {
      screen_name: 'Captura de ID móvil',
      purpose: 'Flujo móvil para capturar identificación oficial con cámara trasera',
      available_entities: ['id_capture', 'ocr_result'],
      available_fields: ['frente_id', 'reverso_id', 'datos_ocr'],
      available_actions: ['capturar frente', 'capturar reverso', 'validar identificación'],
    },
    notifications: {
      screen_name: 'Notificaciones',
      purpose: 'Centro de notificaciones del usuario con alertas y avisos',
      available_entities: ['notifications'],
      available_fields: ['tipo', 'mensaje', 'fecha', 'leida', 'documento_relacionado'],
      available_actions: [
        'marcar como leída',
        'eliminar notificación',
        'filtrar por tipo',
        'marcar todas como leídas',
      ],
    },
    pending_tasks: {
      screen_name: 'Tareas pendientes',
      purpose: 'Vista consolidada de acciones pendientes del usuario',
      available_entities: ['pending_tasks', 'documents', 'participations'],
      available_fields: ['documento', 'tipo_tarea', 'prioridad', 'fecha_limite', 'remitente'],
      available_actions: [
        'ir a firmar',
        'ir a revisar',
        'ir a aprobar',
        'filtrar por prioridad',
        'ver documento',
      ],
    },
    integrations: {
      screen_name: 'App Market',
      purpose: 'Catálogo de integraciones y extensiones disponibles para el workspace',
      available_entities: ['integrations', 'apps'],
      available_fields: ['nombre_app', 'descripcion', 'categoria', 'estado_instalacion'],
      available_actions: [
        'instalar integración',
        'desinstalar integración',
        'ver detalles',
        'configurar integración',
      ],
    },
    signing_help_page: {
      screen_name: 'Ayuda para firmado',
      purpose: 'Guía de ayuda para el proceso de firma de documentos',
      available_entities: ['help_articles', 'faq'],
      available_fields: ['preguntas_frecuentes', 'pasos_firma', 'soporte'],
      available_actions: ['explicar proceso de firma', 'resolver duda', 'contactar soporte'],
    },
    workspace: {
      screen_name: 'Workspace',
      purpose: 'Área general del workspace de Docubox',
      available_entities: ['workspace', 'documents', 'users'],
      available_fields: ['nombre_workspace', 'miembros', 'documentos'],
      available_actions: ['navegar a sección', 'buscar documento', 'ver actividad'],
    },
  };

  const base = routeMap[scope] ?? routeMap.workspace;

  const current_resource_ids: Record<string, string | null> = {
    document_id: documentId ?? null,
    token: token ?? null,
  };

  // Extract dynamic IDs from route params
  if (params) {
    Object.assign(current_resource_ids, params);
  }

  const ui_state: Record<string, any> = {
    scope,
    is_document_context: !!documentId,
    is_token_context: !!token,
  };

  return {
    route: r,
    ...base,
    current_resource_ids,
    ui_state,
  };
}

// ── Route-context action → intent mapping ─────────────────────────────────

export interface ActionIntent {
  intent: LuciaIntent;
  mode: QueryMode;
  /** Pre-built question to send to the API when this action is triggered */
  question: string;
}

/**
 * Maps available_actions from route_context to callable LucIA intents.
 * Used by the chat UI to render action buttons and by the classifier to
 * boost intent detection when the user types an action keyword.
 */
export const ROUTE_ACTION_INTENTS: Partial<Record<LuciaScope, Record<string, ActionIntent>>> = {
  document_viewer: {
    'resumir documento': {
      intent: 'document_summary',
      mode: 'rag',
      question: 'Resume el contenido de este documento de forma clara y concisa.',
    },
    'detectar riesgos': {
      intent: 'legal_analysis',
      mode: 'rag',
      question:
        'Detecta y lista los riesgos legales, cláusulas problemáticas u obligaciones importantes de este documento.',
    },
    'revisar participantes': {
      intent: 'user_participations',
      mode: 'structured',
      question:
        'Muéstrame el estado actual de todos los participantes de este documento: quién ha firmado, quién está pendiente y quién ha rechazado.',
    },
    'mostrar historial': {
      intent: 'activity_history',
      mode: 'structured',
      question: 'Muéstrame el historial completo de actividad y auditoría de este documento.',
    },
    'ver auditoría': {
      intent: 'activity_history',
      mode: 'structured',
      question:
        'Muéstrame el registro de auditoría de este documento con todos los eventos registrados.',
    },
    'agregar nota': {
      intent: 'general_help',
      mode: 'structured',
      question: '¿Cómo puedo agregar una nota interna a este documento?',
    },
    'descargar documento': {
      intent: 'general_help',
      mode: 'structured',
      question: '¿Cómo puedo descargar este documento?',
    },
  },
  documents: {
    ver: {
      intent: 'user_created_documents',
      mode: 'structured',
      question: 'Muéstrame mis documentos con su estado actual.',
    },
    descargar: {
      intent: 'general_help',
      mode: 'structured',
      question: '¿Cómo descargo un documento desde Mis documentos?',
    },
    cancelar: {
      intent: 'document_status_search',
      mode: 'structured',
      question: '¿Cuáles de mis documentos puedo cancelar?',
    },
    'reenviar recordatorio': {
      intent: 'user_created_documents',
      mode: 'structured',
      question: '¿A qué participantes puedo reenviar un recordatorio de firma?',
    },
  },
  dashboard: {
    'ver documentos pendientes': {
      intent: 'pending_tasks',
      mode: 'structured',
      question: '¿Cuáles son mis documentos pendientes de firma o revisión?',
    },
    'revisar actividad': {
      intent: 'activity_history',
      mode: 'structured',
      question: 'Muéstrame la actividad reciente de mis documentos.',
    },
    'generar reporte': {
      intent: 'general_help',
      mode: 'structured',
      question: '¿Cómo genero un reporte de actividad en Docubox?',
    },
    'ver documentos vencidos': {
      intent: 'pending_tasks',
      mode: 'structured',
      question: '¿Cuáles de mis documentos están vencidos o próximos a vencer?',
    },
  },
  participations: {
    'ir a firmar': {
      intent: 'user_participations',
      mode: 'structured',
      question: '¿Qué documentos tengo pendientes de firma?',
    },
    'filtrar por estado': {
      intent: 'user_participations',
      mode: 'structured',
      question: 'Muéstrame mis participaciones agrupadas por estado.',
    },
  },
};

/**
 * Given a user question and the current scope, check if the question
 * matches a known route action and return the pre-mapped ActionIntent.
 * Returns null if no match found.
 */
export function matchRouteAction(question: string, scope: LuciaScope): ActionIntent | null {
  const scopeActions = ROUTE_ACTION_INTENTS[scope];
  if (!scopeActions) return null;

  const q = question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  for (const [actionKey, actionIntent] of Object.entries(scopeActions)) {
    const normalizedKey = actionKey
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    // Check if the question contains the action keyword or vice versa
    if (q.includes(normalizedKey) || normalizedKey.includes(q)) {
      return actionIntent;
    }
  }

  // Fuzzy matching for common phrasings
  if (scope === 'document_viewer') {
    if (q.includes('resum') || q.includes('sintetiz') || q.includes('de que trata')) {
      return scopeActions['resumir documento'];
    }
    if (
      q.includes('riesgo') ||
      q.includes('problema') ||
      q.includes('peligro') ||
      q.includes('clausula') ||
      q.includes('legal')
    ) {
      return scopeActions['detectar riesgos'];
    }
    if (
      q.includes('participante') ||
      q.includes('firmante') ||
      q.includes('quien firmo') ||
      q.includes('quien ha firmado') ||
      q.includes('estado de firma') ||
      q.includes('falta firmar')
    ) {
      return scopeActions['revisar participantes'];
    }
    if (
      q.includes('historial') ||
      q.includes('actividad') ||
      q.includes('auditoria') ||
      q.includes('log') ||
      q.includes('eventos')
    ) {
      return scopeActions['mostrar historial'];
    }
  }

  return null;
}

// ── Keyword groups ─────────────────────────────────────────────────────────

const SENSITIVE_PROFILE_KEYWORDS = [
  'mi curp',
  'curp',
  'mi rfc',
  'rfc',
  'mi teléfono',
  'mi telefono',
  'mi número de teléfono',
  'mi numero de telefono',
  'mi domicilio',
  'mi dirección fiscal',
  'mi direccion fiscal',
  'mi domicilio fiscal',
  'datos fiscales',
  'datos personales',
  'mi código postal',
  'mi codigo postal',
  'mi colonia',
  'mi municipio',
  'mi estado',
  'mi calle',
  'datos de mi perfil',
  'información personal',
  'informacion personal',
];

const ACTIVITY_HISTORY_KEYWORDS = [
  'historial',
  'actividad',
  'actividades',
  'cambios',
  'movimientos',
  'bitácora',
  'bitacora',
  'auditoría',
  'auditoria',
  'quién creó',
  'quien creo',
  'quién modificó',
  'quien modifico',
  'eventos del documento',
  'timeline',
  'registro de cambios',
  'qué pasó',
  'que paso',
  'qué ocurrió',
  'que ocurrio',
  'acciones realizadas',
  'log',
  'logs',
];

const USER_PROFILE_KEYWORDS = [
  'quién soy',
  'quien soy',
  'mi perfil',
  'mi cuenta',
  'mi plan',
  'mi nombre',
  'mi email',
  'mi correo',
  'mi rol',
  'mi usuario',
  'datos de mi cuenta',
  'información de mi perfil',
  'info de mi cuenta',
  'mi suscripción',
  'mi suscripcion',
  'plan activo',
  'plan contratado',
];

const USER_USAGE_KEYWORDS = [
  'mis consumos',
  'mi consumo',
  'cuántos documentos he',
  'cuantos documentos he',
  'cuántos documentos creé',
  'cuantos documentos cree',
  'límite',
  'limite',
  'cuánto he usado',
  'cuanto he usado',
  'documentos disponibles',
  'documentos restantes',
  'almacenamiento',
  'créditos',
  'creditos',
  'uso de ia',
  'uso de ai',
  'cuántos documentos tengo',
  'cuantos documentos tengo',
  'documentos este mes',
  'documentos del mes',
];

const BILLING_KEYWORDS = [
  'facturación',
  'facturacion',
  'mi factura',
  'mis facturas',
  'cuánto he consumido',
  'cuanto he consumido',
  'consumo este mes',
  'mi suscripción',
  'mi suscripcion',
  'renovación',
  'renovacion',
  'costo',
  'precio',
  'pago',
  'cobro',
  'cargo',
  'plan activo',
  'cambiar plan',
  'cancelar plan',
];

const USER_CREATED_DOCUMENTS_KEYWORDS = [
  'documentos que creé',
  'documentos que cree',
  'documentos que he creado',
  'mis documentos creados',
  'documentos creados por mí',
  'documentos creados por mi',
  'qué documentos creé',
  'que documentos cree',
  'qué he creado',
  'que he creado',
  'documentos míos',
  'documentos mios',
  'mis documentos',
];

const USER_ASSIGNED_DOCUMENTS_KEYWORDS = [
  'documentos asignados',
  'documentos asignados a mí',
  'documentos asignados a mi',
  'qué tengo asignado',
  'que tengo asignado',
  'me han asignado',
  'documentos donde participo',
  'documentos en los que participo',
  'documentos compartidos conmigo',
  'documentos que me enviaron',
  'documentos para firmar',
  'documentos para revisar',
  'documentos para aprobar',
];

const USER_PARTICIPATIONS_KEYWORDS = [
  'mi participación',
  'mi participacion',
  'mis participaciones',
  'dónde participo',
  'donde participo',
  'en qué documentos participo',
  'en que documentos participo',
  'qué falta que firme',
  'que falta que firme',
  'qué he firmado',
  'que he firmado',
  'qué he aprobado',
  'que he aprobado',
  'estado de mi participación',
  'estado de mi participacion',
  'como firmante',
  'como revisor',
  'como aprobador',
  'como observador',
];

const DOCUMENT_TYPES_ASSIGNED_KEYWORDS = [
  'tipos de documentos',
  'qué tipos de documentos',
  'que tipos de documentos',
  'tipos de documentos asignados',
  'tipos de documentos que tengo',
  'contratos asignados',
  'nda asignados',
  'convenios asignados',
  'qué tipos tengo',
  'que tipos tengo',
];

const PENDING_TASKS_KEYWORDS = [
  'qué tengo pendiente',
  'que tengo pendiente',
  'mis pendientes',
  'acciones pendientes',
  'tareas pendientes',
  'qué debo hacer',
  'que debo hacer',
  'pendiente de firma',
  'pendiente de revisión',
  'pendiente de revision',
  'pendiente de aprobación',
  'pendiente de aprobacion',
  'qué me falta',
  'que me falta',
  'qué está vencido',
  'que esta vencido',
  'acciones vencidas',
  'documentos vencidos',
  'urgente',
];

const NOTIFICATIONS_KEYWORDS = [
  'notificaciones',
  'mis notificaciones',
  'notificación',
  'notificacion',
  'alertas',
  'avisos',
  'mensajes recibidos',
  'qué notificaciones tengo',
  'notificaciones sin leer',
  'notificaciones pendientes',
];

const CONTACTS_KEYWORDS = [
  'mis contactos',
  'contacto',
  'contactos',
  'directorio',
  'buscar contacto',
  'agregar contacto',
  'lista de contactos',
  'quién está en mis contactos',
  'quien esta en mis contactos',
];

const TEMPLATES_KEYWORDS = [
  'plantilla',
  'plantillas',
  'template',
  'templates',
  'mis plantillas',
  'crear plantilla',
  'usar plantilla',
  'variables de plantilla',
  'campos de plantilla',
];

const FORMS_KEYWORDS = [
  'formulario',
  'formularios',
  'form',
  'forms',
  'mis formularios',
  'crear formulario',
  'llenar formulario',
  'campos del formulario',
  'constructor de formularios',
];

const SIGNING_HELP_KEYWORDS = [
  'cómo firmar',
  'como firmar',
  'proceso de firma',
  'firma electrónica',
  'e.firma',
  'efirma',
  'firma autógrafa',
  'firma otp',
  'otp de firma',
  'iniciar firma',
  'completar firma',
  'método de firma',
  'metodo de firma',
  'ayuda para firmar',
  'no puedo firmar',
  'error al firmar',
];

const EXTERNAL_PARTICIPANT_KEYWORDS = [
  'soy participante externo',
  'me invitaron a firmar',
  'recibí un link',
  'recibi un link',
  'portal de participante',
  'acceso por token',
  'cómo accedo',
  'como accedo',
  'no tengo cuenta',
];

const STRUCTURED_KEYWORDS = [
  'quién',
  'quien',
  'creó',
  'creo',
  'creado',
  'autor',
  'estado',
  'estados',
  'pendiente',
  'pendientes',
  'firmado',
  'firmados',
  'firmante',
  'firmantes',
  'firma',
  'firmar',
  'firmas',
  'vence',
  'vencen',
  'vencimiento',
  'vencido',
  'vencidos',
  'vencer',
  'revisión',
  'revision',
  'revisar',
  'en revisión',
  'participante',
  'participantes',
  'participación',
  'expediente',
  'carpeta',
  'carpetas',
  'tarea',
  'tareas',
  'pendiente de',
  'muéstrame',
  'muestrame',
  'lista',
  'listar',
  'mostrar',
  'cuántos',
  'cuantos',
  'cuándo',
  'cuando',
  'fecha',
  'responsable',
  'asignado',
  'creador',
  'cancelado',
  'cancelados',
  'borrador',
  'completado',
];

const RAG_KEYWORDS = [
  'cláusula',
  'clausula',
  'cláusulas',
  'clausulas',
  'resumen',
  'resume',
  'resumir',
  'resumé',
  'riesgo',
  'riesgos',
  'legal',
  'legales',
  'obligación',
  'obligaciones',
  'obligacion',
  'vigencia',
  'vigente',
  'duración',
  'duracion',
  'penalización',
  'penalizacion',
  'penalidad',
  'contenido',
  'dice',
  'establece',
  'estipula',
  'contrato',
  'acuerdo',
  'convenio',
  'checklist',
  'cumplimiento',
  'compliance',
  'análisis',
  'analisis',
  'analiza',
  'analizar',
  'extrae',
  'extraer',
  'extracción',
  'qué dice',
  'que dice',
  'qué establece',
];

const CONFIGURATION_SECURITY_KEYWORDS = [
  'configuración',
  'configuracion',
  'seguridad',
  'workspace',
  'ajustes',
  '2fa',
  'mfa',
  'autenticación de dos factores',
  'autenticacion de dos factores',
  'sesiones activas',
  'dispositivos',
  'permisos',
  'roles del workspace',
  'notificaciones de workspace',
  'logo del workspace',
  'nombre del workspace',
];

const REPORTS_ANALYSIS_KEYWORDS = [
  'reporte',
  'reportes',
  'informe',
  'informes',
  'estadísticas',
  'estadisticas',
  'métricas',
  'metricas',
  'exportar reporte',
  'generar reporte',
  'actividad del workspace',
  'uso del sistema',
  'análisis de uso',
  'analisis de uso',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function classifyIntent(question: string, currentRoute?: string): IntentResult {
  const q = normalize(question);
  const scope = currentRoute ? getScopeFromRoute(currentRoute) : 'workspace';

  // ── Route-action fast path: check if question matches a known callable action ──
  const routeActionMatch = matchRouteAction(question, scope);
  if (routeActionMatch) {
    return {
      intent: routeActionMatch.intent,
      mode: routeActionMatch.mode,
      extractedStatus: undefined,
    };
  }

  const hasStructured = STRUCTURED_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasRAG = RAG_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasActivityHistory = ACTIVITY_HISTORY_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasSensitiveProfile = SENSITIVE_PROFILE_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasUserProfile = USER_PROFILE_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasUserUsage = USER_USAGE_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasBilling = BILLING_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasUserCreatedDocs = USER_CREATED_DOCUMENTS_KEYWORDS.some((kw) =>
    q.includes(normalize(kw))
  );
  const hasUserAssignedDocs = USER_ASSIGNED_DOCUMENTS_KEYWORDS.some((kw) =>
    q.includes(normalize(kw))
  );
  const hasUserParticipations = USER_PARTICIPATIONS_KEYWORDS.some((kw) =>
    q.includes(normalize(kw))
  );
  const hasDocTypesAssigned = DOCUMENT_TYPES_ASSIGNED_KEYWORDS.some((kw) =>
    q.includes(normalize(kw))
  );
  const hasPendingTasks = PENDING_TASKS_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasNotifications = NOTIFICATIONS_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasContacts = CONTACTS_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasTemplates = TEMPLATES_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasForms = FORMS_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasSigningHelp = SIGNING_HELP_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasExternalParticipant = EXTERNAL_PARTICIPANT_KEYWORDS.some((kw) =>
    q.includes(normalize(kw))
  );
  const hasConfigSecurity = CONFIGURATION_SECURITY_KEYWORDS.some((kw) => q.includes(normalize(kw)));
  const hasReportsAnalysis = REPORTS_ANALYSIS_KEYWORDS.some((kw) => q.includes(normalize(kw)));

  let mode: QueryMode = 'structured';
  if (hasStructured && hasRAG) mode = 'both';
  else if (hasRAG) mode = 'rag';
  else mode = 'structured';

  let intent: LuciaIntent = 'general_help';

  // ── Route-boosted classification ─────────────────────────────────────────
  if (
    scope === 'auth' ||
    scope === 'registration' ||
    scope === 'email_verification' ||
    scope === 'password_recovery'
  ) {
    intent = 'general_help';
    return { intent, mode: 'structured' };
  }
  if (scope === 'profile' && (hasSensitiveProfile || hasUserProfile)) {
    intent = hasSensitiveProfile ? 'user_profile_sensitive' : 'user_profile';
    return { intent, mode: 'structured', extractedStatus: undefined };
  }
  if (scope === 'billing' && (hasBilling || hasUserUsage)) {
    intent = 'billing_status';
    return { intent, mode: 'structured' };
  }
  if (scope === 'pending_tasks' && hasPendingTasks) {
    intent = 'pending_tasks';
    return { intent, mode: 'structured' };
  }
  if (scope === 'notifications' && hasNotifications) {
    intent = 'notifications_search';
    return { intent, mode: 'structured' };
  }
  if (scope === 'contacts' && hasContacts) {
    intent = 'contacts_search';
    return { intent, mode: 'structured' };
  }
  if (scope === 'templates') {
    intent = 'templates_help';
    return { intent, mode: 'structured' };
  }
  if (scope === 'forms' || scope === 'form_builder') {
    intent = 'forms_help';
    return { intent, mode: 'structured' };
  }
  if (scope === 'settings') {
    intent = 'configuration_security';
    return { intent, mode: 'structured' };
  }
  if (scope === 'reports') {
    intent = 'reports_analysis';
    return { intent, mode: 'structured' };
  }
  if (scope === 'signing_help_page') {
    intent = 'signing_help';
    return { intent, mode: 'structured' };
  }
  if ((scope === 'signing' || scope === 'external_participant') && hasSigningHelp) {
    intent = 'signing_help';
    return { intent, mode: 'structured' };
  }
  if (scope === 'external_participant' || scope === 'external_registration') {
    intent = 'external_participant_help';
    return { intent, mode: 'structured' };
  }
  if ((scope === 'document_viewer' || scope === 'signing') && hasRAG) {
    intent = 'document_summary';
    return { intent, mode: 'rag' };
  }

  // ── Priority order: sensitive > profile > usage > billing > documents > tasks ──
  if (hasSensitiveProfile) {
    intent = 'user_profile_sensitive';
    mode = 'structured';
  } else if (hasActivityHistory) {
    intent = 'activity_history';
    mode = 'structured';
  } else if (hasUserProfile) {
    intent = 'user_profile';
    mode = 'structured';
  } else if (hasBilling) {
    intent = 'billing_status';
    mode = 'structured';
  } else if (hasUserUsage) {
    intent = 'user_usage';
    mode = 'structured';
  } else if (hasUserCreatedDocs) {
    intent = 'user_created_documents';
    mode = 'structured';
  } else if (hasUserAssignedDocs) {
    intent = 'user_assigned_documents';
    mode = 'structured';
  } else if (hasUserParticipations) {
    intent = 'user_participations';
    mode = 'structured';
  } else if (hasDocTypesAssigned) {
    intent = 'document_types_assigned';
    mode = 'structured';
  } else if (hasPendingTasks) {
    intent = 'pending_tasks';
    mode = 'structured';
  } else if (hasNotifications) {
    intent = 'notifications_search';
    mode = 'structured';
  } else if (hasContacts) {
    intent = 'contacts_search';
    mode = 'structured';
  } else if (hasTemplates) {
    intent = 'templates_help';
    mode = 'structured';
  } else if (hasForms) {
    intent = 'forms_help';
    mode = 'structured';
  } else if (hasConfigSecurity) {
    intent = 'configuration_security';
    mode = 'structured';
  } else if (hasReportsAnalysis) {
    intent = 'reports_analysis';
    mode = 'structured';
  } else if (hasSigningHelp) {
    intent = 'signing_help';
    mode = 'structured';
  } else if (hasExternalParticipant) {
    intent = 'external_participant_help';
    mode = 'structured';
  } else if (q.includes('resumen') || q.includes('resume') || q.includes('resumir')) {
    intent = 'document_summary';
  } else if (
    q.includes('riesgo') ||
    q.includes('analiz') ||
    q.includes('legal') ||
    q.includes('clausula') ||
    q.includes('obligacion') ||
    q.includes('penaliz')
  ) {
    intent = 'legal_analysis';
  } else if (q.includes('cumplimiento') || q.includes('compliance') || q.includes('checklist')) {
    intent = 'compliance_analysis';
  } else if (
    q.includes('generar') ||
    q.includes('genera') ||
    q.includes('redactar') ||
    q.includes('crear contrato')
  ) {
    intent = 'contract_generation';
  } else if (
    q.includes('firma') ||
    q.includes('firmar') ||
    q.includes('firmante') ||
    q.includes('firmo')
  ) {
    intent = 'signature_status';
  } else if (q.includes('expediente') || q.includes('carpeta')) {
    intent = 'expediente_search';
  } else if (
    q.includes('estado') ||
    q.includes('borrador') ||
    q.includes('completado') ||
    q.includes('cancelado') ||
    q.includes('revision') ||
    q.includes('vencido')
  ) {
    intent = 'document_status_search';
  } else if (
    q.includes('quien') ||
    q.includes('autor') ||
    q.includes('creo') ||
    q.includes('creado') ||
    q.includes('participante')
  ) {
    intent = 'document_status_search';
  } else if (hasRAG) {
    intent = 'document_content_search';
  } else if (hasStructured) {
    intent = 'document_status_search';
  }

  // Extract status hints
  let extractedStatus: string | undefined;
  if (q.includes('borrador')) extractedStatus = 'borrador';
  else if (q.includes('firmado') || q.includes('completado')) extractedStatus = 'completado';
  else if (q.includes('cancelado')) extractedStatus = 'cancelado';
  else if (q.includes('revision') || q.includes('revisión')) extractedStatus = 'en_revision';
  else if (q.includes('pendiente') && q.includes('firma')) extractedStatus = 'pendiente_firma';
  else if (q.includes('vencido')) extractedStatus = 'vencido';

  return { intent, mode, extractedStatus };
}
