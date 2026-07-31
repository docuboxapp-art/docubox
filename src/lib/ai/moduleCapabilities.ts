/**
 * moduleCapabilities.ts
 *
 * Defines per-module configuration for LucIA:
 * - module name and description
 * - quick suggestion chips shown in the chat UI
 * - available actions for the module
 * - required context type
 * - entities visible in the current screen
 *
 * Used by LucIAChat.tsx to render contextual suggestions and by the
 * backend to understand what data to fetch for each module.
 */

import type { LuciaScope } from './luciaIntentClassifier';

export interface ModuleCapability {
  /** Human-readable module name */
  name: string;
  /** Short description of what LucIA can help with here */
  description: string;
  /** Quick suggestion chips shown in the chat welcome screen */
  quickSuggestions: string[];
  /** Available actions LucIA can perform in this module */
  availableActions: string[];
  /** Context type required: workspace (authenticated), token (public), or both */
  contextType: 'workspace' | 'token' | 'both';
  /** Entities visible in the current screen */
  entities: string[];
  /** Scope identifier */
  scope: LuciaScope;
}

const MODULE_CAPABILITIES: Record<LuciaScope, ModuleCapability> = {
  auth: {
    name: 'Autenticación',
    description: 'Ayuda con inicio de sesión y registro',
    quickSuggestions: [
      '¿Cómo me registro en Docubox?',
      '¿Cómo recupero mi contraseña?',
      '¿Qué métodos de autenticación hay?',
    ],
    availableActions: ['iniciar sesión', 'registrar usuario', 'recuperar contraseña'],
    contextType: 'workspace',
    entities: ['auth', 'user_registration'],
    scope: 'auth',
  },
  registration: {
    name: 'Registro',
    description: 'Asistencia en el proceso de registro',
    quickSuggestions: [
      '¿Qué datos necesito para registrarme?',
      '¿Cómo verifico mi correo?',
      '¿Puedo reenviar el código de verificación?',
    ],
    availableActions: ['registrar', 'verificar correo', 'reenviar código'],
    contextType: 'workspace',
    entities: ['user_registration', 'email_verification'],
    scope: 'registration',
  },
  email_verification: {
    name: 'Verificación de correo',
    description: 'Ayuda para confirmar tu email',
    quickSuggestions: [
      '¿Cómo verifico mi correo?',
      '¿Puedo reenviar el código?',
      '¿Cuánto tiempo tiene validez el código?',
    ],
    availableActions: ['verificar correo', 'reenviar código'],
    contextType: 'workspace',
    entities: ['verification_token'],
    scope: 'email_verification',
  },
  password_recovery: {
    name: 'Recuperación de contraseña',
    description: 'Asistencia para restablecer tu contraseña',
    quickSuggestions: [
      '¿Cómo restablezco mi contraseña?',
      '¿Cuánto tiempo tiene validez el OTP?',
      '¿Qué hago si no recibo el código?',
    ],
    availableActions: ['enviar código', 'validar OTP', 'actualizar contraseña'],
    contextType: 'workspace',
    entities: ['password_reset', 'otp'],
    scope: 'password_recovery',
  },
  dashboard: {
    name: 'Dashboard',
    description: 'Resumen ejecutivo de tu actividad en Docubox',
    quickSuggestions: [
      '¿Qué requiere atención urgente?',
      '¿Cuántos documentos tengo pendientes?',
      '¿Qué documentos vencen esta semana?',
      'Muéstrame la actividad reciente',
    ],
    availableActions: ['ver métricas', 'revisar pendientes', 'abrir documento', 'ver documentos vencidos'],
    contextType: 'workspace',
    entities: ['documents', 'metrics', 'activity', 'participations'],
    scope: 'dashboard',
  },
  documents: {
    name: 'Mis documentos',
    description: 'Gestión y consulta de tus documentos',
    quickSuggestions: [
      '¿Qué documentos tengo pendientes?',
      '¿Qué documentos están firmados?',
      '¿Qué documentos vencen esta semana?',
      '¿Cuántos documentos he creado?',
    ],
    availableActions: ['ver', 'descargar', 'cancelar', 'reenviar recordatorio', 'filtrar por estado'],
    contextType: 'workspace',
    entities: ['documents', 'folders', 'tags', 'participants'],
    scope: 'documents',
  },
  create_document: {
    name: 'Crear documento',
    description: 'Asistencia para crear y enviar documentos',
    quickSuggestions: [
      '¿Qué plantilla me recomiendas?',
      '¿Cómo agrego participantes?',
      '¿Qué es el orden de firma?',
      '¿Cómo configuro recordatorios?',
    ],
    availableActions: ['subir archivo', 'agregar participante', 'configurar flujo', 'enviar documento'],
    contextType: 'workspace',
    entities: ['document_draft', 'participants', 'workflow', 'folders', 'tags'],
    scope: 'create_document',
  },
  document_viewer: {
    name: 'Visor de documento',
    description: 'Análisis, historial y estado del documento actual',
    quickSuggestions: [
      'Resume este documento',
      '¿Quién falta por firmar?',
      'Detecta riesgos legales',
      'Muéstrame el historial',
    ],
    availableActions: ['resumir documento', 'detectar riesgos', 'mostrar historial', 'revisar participantes', 'ver auditoría'],
    contextType: 'workspace',
    entities: ['document', 'participants', 'audit_log', 'notes', 'ai_chat'],
    scope: 'document_viewer',
  },
  signing: {
    name: 'Firma de documento',
    description: 'Guía para el proceso de firma',
    quickSuggestions: [
      '¿Cómo firmo con e.firma?',
      '¿Qué es el OTP de firma?',
      '¿Qué campos me faltan por firmar?',
      '¿Cómo funciona la firma autógrafa?',
    ],
    availableActions: ['firmar con autógrafa', 'firmar con e.firma', 'validar OTP', 'capturar selfie'],
    contextType: 'workspace',
    entities: ['document', 'signature_fields', 'biometric_data', 'otp', 'efirma'],
    scope: 'signing',
  },
  participations: {
    name: 'Mis participaciones',
    description: 'Documentos donde participas como firmante o revisor',
    quickSuggestions: [
      '¿Qué documentos tengo pendientes de firma?',
      '¿Qué he firmado recientemente?',
      '¿Qué documentos están vencidos?',
      'Muéstrame mis participaciones por estado',
    ],
    availableActions: ['ir a firmar', 'ver documento', 'filtrar por estado', 'filtrar por rol'],
    contextType: 'workspace',
    entities: ['participations', 'documents', 'roles'],
    scope: 'participations',
  },
  participation_requests: {
    name: 'Solicitudes de participación',
    description: 'Gestión de solicitudes para participar en documentos',
    quickSuggestions: [
      '¿Qué solicitudes tengo pendientes?',
      '¿Cómo acepto una solicitud?',
      '¿Qué documentos me han invitado a revisar?',
    ],
    availableActions: ['aceptar solicitud', 'rechazar solicitud', 'ver documento'],
    contextType: 'workspace',
    entities: ['participation_requests', 'documents'],
    scope: 'participation_requests',
  },
  contacts: {
    name: 'Contactos',
    description: 'Directorio de contactos del workspace',
    quickSuggestions: [
      '¿Cuántos contactos tengo?',
      '¿Cómo agrego un contacto?',
      '¿Cómo invito a un contacto a un documento?',
    ],
    availableActions: ['buscar contacto', 'agregar contacto', 'editar contacto', 'invitar a documento'],
    contextType: 'workspace',
    entities: ['contacts', 'tags', 'roles'],
    scope: 'contacts',
  },
  external_participant: {
    name: 'Portal del participante',
    description: 'Asistencia para participantes externos',
    quickSuggestions: [
      '¿Cómo firmo este documento?',
      '¿Qué información necesito para firmar?',
      '¿Cuál es el estado de mi participación?',
    ],
    availableActions: ['ver documento', 'iniciar firma', 'registrarse'],
    contextType: 'token',
    entities: ['document', 'participant_data'],
    scope: 'external_participant',
  },
  external_registration: {
    name: 'Registro de participante',
    description: 'Ayuda para registrarte como participante',
    quickSuggestions: [
      '¿Qué datos necesito para registrarme?',
      '¿Qué es Docubox?',
      '¿Cómo funciona la firma electrónica?',
    ],
    availableActions: ['registrarse', 'aceptar términos'],
    contextType: 'token',
    entities: ['participant_registration'],
    scope: 'external_registration',
  },
  public_form: {
    name: 'Formulario público',
    description: 'Asistencia para llenar el formulario',
    quickSuggestions: [
      '¿Cómo lleno este formulario?',
      '¿Qué campos son obligatorios?',
      '¿Cómo envío el formulario?',
    ],
    availableActions: ['llenar formulario', 'firmar', 'enviar formulario'],
    contextType: 'token',
    entities: ['form', 'form_fields', 'signature'],
    scope: 'public_form',
  },
  forms: {
    name: 'Formularios',
    description: 'Constructor y gestión de formularios',
    quickSuggestions: [
      '¿Cómo creo un formulario?',
      '¿Qué tipos de campos puedo agregar?',
      '¿Cómo publico un formulario?',
    ],
    availableActions: ['crear formulario', 'editar formulario', 'previsualizar', 'publicar formulario'],
    contextType: 'workspace',
    entities: ['form_templates', 'form_fields'],
    scope: 'forms',
  },
  form_builder: {
    name: 'Constructor de formularios',
    description: 'Editor de campos y configuración del formulario',
    quickSuggestions: [
      '¿Cómo agrego un campo de firma?',
      '¿Cómo hago un campo obligatorio?',
      '¿Cómo reordeno los campos?',
    ],
    availableActions: ['agregar campo', 'reordenar campos', 'configurar propiedades', 'guardar formulario'],
    contextType: 'workspace',
    entities: ['form_fields', 'field_library'],
    scope: 'form_builder',
  },
  templates: {
    name: 'Plantillas',
    description: 'Constructor de plantillas con variables dinámicas',
    quickSuggestions: [
      '¿Cómo creo una plantilla?',
      '¿Cómo inserto una variable?',
      '¿Qué plantillas tengo disponibles?',
    ],
    availableActions: ['crear plantilla', 'editar plantilla', 'insertar variable', 'usar plantilla'],
    contextType: 'workspace',
    entities: ['templates', 'template_variables'],
    scope: 'templates',
  },
  reports: {
    name: 'Reportes',
    description: 'Análisis y exportación de reportes de actividad',
    quickSuggestions: [
      '¿Cómo genero un reporte?',
      '¿Qué métricas puedo ver?',
      '¿Cómo exporto el reporte a CSV?',
    ],
    availableActions: ['generar reporte', 'exportar CSV', 'exportar PDF', 'filtrar por fecha'],
    contextType: 'workspace',
    entities: ['reports', 'activity', 'documents', 'users'],
    scope: 'reports',
  },
  billing: {
    name: 'Facturación',
    description: 'Plan, consumo y facturación de tu cuenta',
    quickSuggestions: [
      '¿Cuánto he consumido este mes?',
      '¿Cuál es mi plan actual?',
      '¿Cuántos documentos me quedan?',
      '¿Cómo cambio de plan?',
    ],
    availableActions: ['ver plan actual', 'cambiar plan', 'ver historial de pagos', 'descargar factura'],
    contextType: 'workspace',
    entities: ['subscription', 'invoices', 'plans'],
    scope: 'billing',
  },
  profile: {
    name: 'Mi perfil',
    description: 'Datos personales, fiscales y configuración de tu cuenta',
    quickSuggestions: [
      '¿Cuál es mi CURP?',
      '¿Cuál es mi RFC?',
      '¿Tengo e.firma vinculada?',
      '¿Cómo actualizo mi perfil?',
    ],
    availableActions: ['actualizar perfil', 'cambiar contraseña', 'revisar eFirma', 'ver datos fiscales'],
    contextType: 'workspace',
    entities: ['profile', 'efirma', 'biometric_data'],
    scope: 'profile',
  },
  settings: {
    name: 'Configuración',
    description: 'Ajustes del workspace, seguridad y permisos',
    quickSuggestions: [
      '¿Cómo activo el 2FA?',
      '¿Cómo gestiono las sesiones activas?',
      '¿Cómo configuro los roles del workspace?',
    ],
    availableActions: ['actualizar workspace', 'activar 2FA', 'gestionar sesiones', 'configurar notificaciones'],
    contextType: 'workspace',
    entities: ['workspace_settings', 'security', 'notifications_config', 'team_roles'],
    scope: 'settings',
  },
  mobile_enrollment: {
    name: 'Enrolamiento biométrico',
    description: 'Guía para captura biométrica y validación de identidad',
    quickSuggestions: [
      '¿Cómo capturo mi selfie?',
      '¿Qué documentos necesito?',
      '¿Por qué fue rechazado mi enrolamiento?',
    ],
    availableActions: ['capturar selfie', 'capturar identificación', 'validar CURP', 'completar enrolamiento'],
    contextType: 'token',
    entities: ['enrollment', 'biometric_capture', 'id_document'],
    scope: 'mobile_enrollment',
  },
  mobile_upload: {
    name: 'Subida móvil',
    description: 'Ayuda para subir documentos desde tu teléfono',
    quickSuggestions: [
      '¿Qué formatos de archivo puedo subir?',
      '¿Cuál es el tamaño máximo?',
      '¿Cómo confirmo el envío?',
    ],
    availableActions: ['seleccionar archivo', 'subir archivo', 'confirmar envío'],
    contextType: 'token',
    entities: ['mobile_upload_session', 'file'],
    scope: 'mobile_upload',
  },
  mobile_id_capture: {
    name: 'Captura de ID móvil',
    description: 'Guía para capturar tu identificación oficial',
    quickSuggestions: [
      '¿Cómo capturo el frente de mi ID?',
      '¿Qué identificaciones son válidas?',
      '¿Por qué falló el OCR?',
    ],
    availableActions: ['capturar frente', 'capturar reverso', 'validar identificación'],
    contextType: 'token',
    entities: ['id_capture', 'ocr_result'],
    scope: 'mobile_id_capture',
  },
  notifications: {
    name: 'Notificaciones',
    description: 'Centro de notificaciones y alertas',
    quickSuggestions: [
      '¿Qué notificaciones tengo sin leer?',
      '¿Qué alertas son urgentes?',
      'Resume mis notificaciones recientes',
    ],
    availableActions: ['marcar como leída', 'eliminar notificación', 'filtrar por tipo'],
    contextType: 'workspace',
    entities: ['notifications'],
    scope: 'notifications',
  },
  pending_tasks: {
    name: 'Tareas pendientes',
    description: 'Vista consolidada de tus acciones pendientes',
    quickSuggestions: [
      '¿Qué debo hacer primero?',
      '¿Qué tareas están vencidas?',
      '¿Qué documentos requieren mi firma?',
      '¿Qué aprobaciones tengo pendientes?',
    ],
    availableActions: ['ir a firmar', 'ir a revisar', 'ir a aprobar', 'filtrar por prioridad'],
    contextType: 'workspace',
    entities: ['pending_tasks', 'documents', 'participations'],
    scope: 'pending_tasks',
  },
  integrations: {
    name: 'App Market',
    description: 'Integraciones y extensiones disponibles',
    quickSuggestions: [
      '¿Qué integraciones están disponibles?',
      '¿Cómo instalo una integración?',
      '¿Qué integraciones tengo activas?',
    ],
    availableActions: ['instalar integración', 'desinstalar integración', 'configurar integración'],
    contextType: 'workspace',
    entities: ['integrations', 'apps'],
    scope: 'integrations',
  },
  signing_help_page: {
    name: 'Ayuda para firmado',
    description: 'Guía completa del proceso de firma',
    quickSuggestions: [
      '¿Cómo funciona la e.firma SAT?',
      '¿Qué es la firma autógrafa?',
      '¿Cómo funciona el OTP?',
    ],
    availableActions: ['explicar proceso de firma', 'resolver duda', 'contactar soporte'],
    contextType: 'workspace',
    entities: ['help_articles', 'faq'],
    scope: 'signing_help_page',
  },
  workspace: {
    name: 'Docubox',
    description: 'Copiloto inteligente de Docubox',
    quickSuggestions: [
      '¿Qué tengo pendiente hoy?',
      '¿Cuántos documentos he creado?',
      '¿Cómo funciona Docubox?',
    ],
    availableActions: ['navegar a sección', 'buscar documento', 'ver actividad'],
    contextType: 'workspace',
    entities: ['workspace', 'documents', 'users'],
    scope: 'workspace',
  },
};

/**
 * Returns the module capability config for the given scope/pathname.
 * Falls back to 'workspace' if not found.
 */
export function getLuciaModuleConfig(scope: LuciaScope): ModuleCapability {
  return MODULE_CAPABILITIES[scope] ?? MODULE_CAPABILITIES.workspace;
}

/**
 * Returns quick suggestions for the given scope.
 * Used by LucIAChat.tsx to render suggestion chips.
 */
export function getQuickSuggestions(scope: LuciaScope): string[] {
  return getLuciaModuleConfig(scope).quickSuggestions;
}

/**
 * Returns whether the given scope requires token context (public routes)
 * vs workspace context (authenticated routes).
 */
export function isPublicTokenScope(scope: LuciaScope): boolean {
  const config = getLuciaModuleConfig(scope);
  return config.contextType === 'token';
}

export default MODULE_CAPABILITIES;
