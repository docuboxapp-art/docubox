import {
  extractLuciaRouteParams,
  resolveLuciaCapability,
  type LuciaModuleCapability,
  type LuciaScope,
} from './moduleCapabilities';

export type { LuciaScope } from './moduleCapabilities';

export type LuciaIntent =
  | 'home_summary'
  | 'document_search'
  | 'document_metadata'
  | 'document_versions'
  | 'document_review'
  | 'document_summary'
  | 'document_content_search'
  | 'document_intelligence_profile'
  | 'document_classification'
  | 'document_extracted_fields'
  | 'document_obligations'
  | 'document_completeness'
  | 'document_metadata_suggestions'
  | 'document_folder_suggestions'
  | 'document_tag_suggestions'
  | 'document_quality_score'
  | 'document_version_comparison'
  | 'document_evidence_sources'
  | 'signature_status'
  | 'signing_help'
  | 'participations_summary'
  | 'requests_summary'
  | 'tasks_summary'
  | 'contacts_search'
  | 'templates_help'
  | 'forms_help'
  | 'forms_responses_summary'
  | 'expediente_summary'
  | 'expediente_requirements'
  | 'notifications_summary'
  | 'certified_notification_status'
  | 'certification_status'
  | 'batch_signature_status'
  | 'credit_title_status'
  | 'organization_permissions'
  | 'collaboration_summary'
  | 'configuration_security'
  | 'user_profile'
  | 'user_profile_sensitive'
  | 'billing_usage'
  | 'reports_summary'
  | 'integrations_help'
  | 'public_token_help'
  | 'deterministic_verification_help'
  | 'module_design_help'
  | 'general_help';

export type QueryMode = 'structured' | 'rag' | 'both' | 'deterministic';

export interface IntentResult {
  intent: LuciaIntent;
  mode: QueryMode;
  extractedDocumentId?: string;
  extractedStatus?: string;
  extractedUserName?: string;
  extractedCarpetaId?: string;
}

export interface RouteContext {
  route: string;
  canonicalRoute: string;
  moduleKey: string;
  moduleName: string;
  scope: LuciaScope;
  accessMode: LuciaModuleCapability['accessMode'];
  luciaMode: LuciaModuleCapability['luciaMode'];
  moduleStatus: LuciaModuleCapability['moduleStatus'];
  dataAvailability: LuciaModuleCapability['dataAvailability'];
  purpose: string;
  entities: string[];
  dataSources: string[];
  availableActions: string[];
  requiredContext: string[];
  sensitiveFields: string[];
  evidenceRequirements: string[];
  currentResourceIds: Record<string, string>;
  uiState: Record<string, string | number | boolean>;
}

const SAFE_PARAM = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const UI_STATE_KEYS = new Set([
  'step',
  'view',
  'filter',
  'status',
  'selectedTab',
  'sort',
  'hasDraft',
  'hasSelection',
  'itemCount',
  'page',
]);

function cleanRoute(route: string) {
  const pathname = (route || '/').split('?')[0].split('#')[0] || '/';
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

function safeId(value: unknown) {
  if (typeof value !== 'string') return null;
  const decoded = value.trim();
  return SAFE_PARAM.test(decoded) ? decoded : null;
}

function sanitizeUiState(uiState: Record<string, unknown> = {}) {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(uiState)) {
    if (!UI_STATE_KEYS.has(key)) continue;
    if (typeof value === 'boolean' || typeof value === 'number') sanitized[key] = value;
    else if (typeof value === 'string') sanitized[key] = value.slice(0, 80);
  }
  return sanitized;
}

function resourceIdsForRoute(
  capability: LuciaModuleCapability,
  routeParams: Record<string, string>,
  explicitDocumentId?: string,
  explicitParams: Record<string, string> = {}
) {
  const params = { ...routeParams, ...explicitParams };
  const result: Record<string, string> = {};
  const documentId = safeId(explicitDocumentId);
  if (documentId) result.documentId = documentId;

  for (const [key, rawValue] of Object.entries(params)) {
    if (/token/i.test(key) || key === 'section') continue;
    const value = safeId(rawValue);
    if (!value) continue;
    if (key === 'documentId') result.documentId = value;
    else if (key === 'personId' || key === 'memberId') result[key] = value;
    else if (key === 'id') {
      const resourceKey: Record<string, string> = {
        document_viewer: 'documentId',
        signing: 'documentId',
        expedientes: 'expedienteId',
        certified_notifications: 'notificationId',
        certifications: 'certificationId',
        batch_signatures: 'batchId',
        credit_titles: 'creditTitleId',
        forms: 'formId',
      };
      result[resourceKey[capability.moduleKey] || 'resourceId'] = value;
    }
  }
  return result;
}

export function getScopeFromRoute(route: string): LuciaScope {
  return resolveLuciaCapability(route).scope;
}

export function buildRouteContext(
  route: string,
  _scope?: LuciaScope,
  documentId?: string,
  _token?: string,
  params: Record<string, string> = {},
  uiState: Record<string, unknown> = {}
): RouteContext {
  const pathname = cleanRoute(route);
  const capability = resolveLuciaCapability(pathname);
  const routeParams = extractLuciaRouteParams(pathname, capability);
  const sanitizedPathname = Object.entries(routeParams).reduce(
    (current, [key, value]) => (/token/i.test(key) ? current.replace(value, ':token') : current),
    pathname
  );

  return {
    route: sanitizedPathname,
    canonicalRoute: capability.canonicalRoute,
    moduleKey: capability.moduleKey,
    moduleName: capability.moduleName,
    scope: capability.scope,
    accessMode: capability.accessMode,
    luciaMode: capability.luciaMode,
    moduleStatus: capability.moduleStatus,
    dataAvailability: capability.dataAvailability,
    purpose: capability.purpose,
    entities: [...capability.entities],
    dataSources: [...capability.dataSources],
    availableActions: [...capability.allowedReadActions],
    requiredContext: [...capability.requiredContext],
    sensitiveFields: [...capability.sensitiveFields],
    evidenceRequirements: [...capability.evidenceRequirements],
    currentResourceIds: resourceIdsForRoute(capability, routeParams, documentId, params),
    uiState: sanitizeUiState(uiState),
  };
}

function normalize(text: string) {
  return text
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function containsAny(question: string, terms: string[]) {
  return terms.some((term) => question.includes(normalize(term)));
}

function routeContextFrom(input?: string | RouteContext) {
  if (!input) return buildRouteContext('/');
  return typeof input === 'string' ? buildRouteContext(input) : input;
}

export function classifyIntent(
  question: string,
  contextInput?: string | RouteContext
): IntentResult {
  const context = routeContextFrom(contextInput);
  const q = normalize(question);
  const sensitiveProfile = containsAny(q, ['curp', 'rfc', 'telefono', 'domicilio', 'direccion']);
  const contentQuestion = containsAny(q, [
    'resume este documento',
    'resumen del documento',
    'que dice',
    'clausula',
    'contenido',
    'establece',
    'obligacion',
    'buscar en el documento',
  ]);
  const extractedStatus = containsAny(q, ['vencido', 'vencida'])
    ? 'vencido'
    : containsAny(q, ['cancelado', 'cancelada'])
      ? 'cancelado'
      : containsAny(q, ['completado', 'firmado', 'completada'])
        ? 'completado'
        : containsAny(q, ['borrador'])
          ? 'borrador'
          : undefined;

  if (context.luciaMode === 'deterministic_only') {
    return { intent: 'deterministic_verification_help', mode: 'deterministic' };
  }

  const moduleDesignQuestion = containsAny(q, [
    'como debe funcionar',
    'como deberia funcionar',
    'que tablas necesita',
    'que tablas requiere',
    'que permisos necesita',
    'que permisos requiere',
    'que flujo recomiendas',
    'ayudame a construir',
    'construir este modulo',
    'construir el modulo',
    'disena el flujo',
    'disena este modulo',
    'disena',
    'define el flujo',
    'define este modulo',
    'define',
    'arquitectura del modulo',
    'modelo de datos',
    'esquema de produccion',
    'implementar este modulo',
    'desarrollar este modulo',
  ]);
  if (context.moduleStatus === 'in_development' && moduleDesignQuestion) {
    return { intent: 'module_design_help', mode: 'structured' };
  }

  const documentIntelligenceModules = new Set([
    'documents',
    'document_viewer',
    'expedientes',
    'templates',
    'forms',
  ]);
  if (documentIntelligenceModules.has(context.moduleKey)) {
    const intelligenceIntent = containsAny(q, ['fuentes de la respuesta', 'muestra las fuentes'])
      ? 'document_evidence_sources'
      : containsAny(q, ['compara esta version', 'compara versiones', 'version anterior'])
        ? 'document_version_comparison'
        : containsAny(q, ['calidad documental', 'baja calidad', 'score de calidad'])
          ? 'document_quality_score'
          : containsAny(q, [
                'esta completo',
                'documento incompleto',
                'documentos incompletos',
                'campos faltantes',
                'revisa completitud',
                'que documentos faltan',
              ])
            ? 'document_completeness'
            : containsAny(q, ['que carpeta', 'sugiere carpeta', 'carpeta recomiendas'])
              ? 'document_folder_suggestions'
              : containsAny(q, ['que etiquetas', 'sugiere etiquetas', 'etiquetas deberia'])
                ? 'document_tag_suggestions'
                : containsAny(q, ['que metadatos', 'sugiere metadatos'])
                  ? 'document_metadata_suggestions'
                  : containsAny(q, [
                        'que obligaciones',
                        'detecta obligaciones',
                        'fechas importantes',
                        'fechas relevantes',
                        'vencimientos',
                      ])
                    ? 'document_obligations'
                    : containsAny(q, [
                          'extrae los datos',
                          'extrae datos clave',
                          'extrae campos',
                          'datos importantes',
                          'campos extraidos',
                        ])
                      ? 'document_extracted_fields'
                      : containsAny(q, [
                            'que tipo de documento',
                            'clasifica este documento',
                            'clasifica documentos',
                            'agrupa por tipo documental',
                            'clasifica esta plantilla',
                          ])
                        ? 'document_classification'
                        : containsAny(q, ['ficha inteligente', 'ficha documental'])
                          ? 'document_intelligence_profile'
                          : null;
    if (intelligenceIntent) {
      return {
        intent: intelligenceIntent,
        mode: 'both',
        extractedDocumentId: context.currentResourceIds.documentId,
        extractedCarpetaId: context.currentResourceIds.expedienteId,
      };
    }
  }

  const ragModules = new Set([
    'documents',
    'document_viewer',
    'expedientes',
    'templates',
    'forms',
    'certifications',
    'certified_notifications',
    'batch_signatures',
    'credit_titles',
  ]);
  if (contentQuestion && ragModules.has(context.moduleKey)) {
    return {
      intent: containsAny(q, ['resume', 'resumen'])
        ? 'document_summary'
        : 'document_content_search',
      mode: 'rag',
      extractedDocumentId: context.currentResourceIds.documentId,
      extractedCarpetaId: context.currentResourceIds.expedienteId,
      extractedStatus,
    };
  }

  let intent: LuciaIntent;
  let mode: QueryMode = 'structured';
  switch (context.moduleKey) {
    case 'home':
      intent = 'home_summary';
      break;
    case 'documents':
      if (context.route.endsWith('/versiones')) intent = 'document_versions';
      else if (context.route.endsWith('/revision')) intent = 'document_review';
      else if (containsAny(q, ['metadata', 'metadatos', 'fecha', 'tipo', 'estado']))
        intent = 'document_metadata';
      else intent = 'document_search';
      break;
    case 'document_viewer':
      if (containsAny(q, ['firma', 'firmante', 'participante'])) intent = 'signature_status';
      else intent = 'document_metadata';
      break;
    case 'create_document':
    case 'templates':
      intent = 'templates_help';
      break;
    case 'signing':
    case 'signing_help':
      intent = containsAny(q, ['estado', 'pendiente', 'campo'])
        ? 'signature_status'
        : 'signing_help';
      break;
    case 'participations':
      intent = 'participations_summary';
      break;
    case 'requests':
      intent = 'requests_summary';
      break;
    case 'tasks':
      intent = 'tasks_summary';
      break;
    case 'contacts':
      intent = 'contacts_search';
      break;
    case 'forms':
      intent =
        context.route.includes('/respuestas') || containsAny(q, ['respuesta', 'resultado'])
          ? 'forms_responses_summary'
          : 'forms_help';
      break;
    case 'expedientes':
      intent = containsAny(q, ['falta', 'requisito', 'checklist'])
        ? 'expediente_requirements'
        : 'expediente_summary';
      break;
    case 'notifications':
      intent = 'notifications_summary';
      break;
    case 'certified_notifications':
      intent = 'certified_notification_status';
      break;
    case 'certifications':
      intent = 'certification_status';
      break;
    case 'batch_signatures':
      intent = 'batch_signature_status';
      break;
    case 'credit_titles':
      intent = 'credit_title_status';
      break;
    case 'organization':
      intent = 'organization_permissions';
      break;
    case 'collaboration':
      intent = 'collaboration_summary';
      break;
    case 'configuration_security':
      intent = 'configuration_security';
      break;
    case 'profile':
      intent = sensitiveProfile ? 'user_profile_sensitive' : 'user_profile';
      break;
    case 'billing':
      intent = 'billing_usage';
      break;
    case 'reports':
      intent = 'reports_summary';
      break;
    case 'integrations':
      intent = 'integrations_help';
      break;
    case 'public_token_help':
      intent = 'public_token_help';
      break;
    case 'public_verification':
      intent = 'deterministic_verification_help';
      mode = 'deterministic';
      break;
    default:
      intent = 'general_help';
  }

  return {
    intent,
    mode,
    extractedStatus,
    extractedDocumentId: context.currentResourceIds.documentId,
    extractedCarpetaId: context.currentResourceIds.expedienteId,
  };
}
