import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE,
  isDocumentIntelligenceEnabled,
} from './documentIntelligenceFeature';
import type { LuciaIntent, RouteContext } from './luciaIntentClassifier';
import type { LuciaAuthorizationContext } from './luciaAuthorization';
import type { LuciaDataAvailability, LuciaModuleStatus } from './moduleCapabilities';
import {
  EMBEDDING_MODEL,
  estimateAiCost,
  LUCIA_PROMPT_VERSION,
  redactSensitiveText,
} from './security';

const DOCUMENT_FIELDS =
  'id,nombre,estado,created_at,updated_at,fecha_vencimiento,es_urgente,owner_id,carpeta_id,tipo_documento_id';

function allowedIds(auth: LuciaAuthorizationContext, documentId?: string | null) {
  if (auth.denied_reason) return [];
  if (documentId) return auth.allowed_document_ids.includes(documentId) ? [documentId] : [];
  return [...new Set(auth.allowed_document_ids)].slice(0, 1_000);
}

function isAuthorizedWorkspace(
  auth: LuciaAuthorizationContext,
  workspaceId: string,
  userId?: string
) {
  if (auth.denied_reason || auth.workspace_id !== workspaceId) return false;
  if (auth.is_public_token_flow) return true;
  return Boolean(userId && auth.user_id === userId && auth.membership_status === 'active');
}

function isManager(auth: LuciaAuthorizationContext) {
  return auth.permissions.includes('read_workspace');
}

function withSource(source: string, value: unknown) {
  return { source, rows: Array.isArray(value) ? value : value ? [value] : [] };
}

function requestedSensitiveField(question: string) {
  const normalized = question.toLocaleLowerCase('es-MX');
  if (normalized.includes('curp')) return 'curp';
  if (normalized.includes('rfc')) return 'rfc';
  if (normalized.includes('teléfono') || normalized.includes('telefono')) return 'telefono';
  if (
    normalized.includes('domicilio') ||
    normalized.includes('dirección') ||
    normalized.includes('direccion')
  )
    return 'domicilio';
  return null;
}

export async function buildUserContext(
  userId: string,
  workspaceId: string,
  intent: LuciaIntent,
  authorization: LuciaAuthorizationContext,
  question = ''
) {
  if (!isAuthorizedWorkspace(authorization, workspaceId, userId)) return {};
  const supabase = createServiceClient();
  const context: Record<string, unknown> = {};

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id,name,workspace_type')
    .eq('id', workspaceId)
    .maybeSingle();
  if (workspace) context.workspace = { ...workspace, role: authorization.role };

  if (intent === 'user_profile') {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id,full_name,nombre,apellido_paterno,account_type')
      .eq('id', userId)
      .maybeSingle();
    if (profile) context.profile = profile;
  }

  if (intent === 'user_profile_sensitive') {
    const requestedField = requestedSensitiveField(question);
    if (!requestedField) return context;
    const fields =
      requestedField === 'domicilio'
        ? 'id,calle,num_exterior,num_interior,colonia,municipio,estado,codigo_postal'
        : `id,${requestedField}`;
    const { data: profile } = await supabase
      .from('user_profiles')
      .select(fields)
      .eq('id', userId)
      .maybeSingle();
    if (profile) {
      context.profile = {
        ...(profile as unknown as Record<string, unknown>),
        requested_field: requestedField,
      };
    }
  }

  if (['billing_usage', 'reports_summary', 'home_summary'].includes(intent)) {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select(
        'status,documents_used,documents_limit,current_period_start,current_period_end,plan:plan_id(name,slug,documents_included)'
      )
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('current_period_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    const documentIds = allowedIds(authorization);
    const { data: docs } = documentIds.length
      ? await supabase.from('documentos').select('id,estado,created_at').in('id', documentIds)
      : { data: [] as Array<{ id: string; estado: string; created_at: string }> };
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    context.usage = {
      source: 'subscriptions+documentos',
      subscription,
      documents_created_this_month: (docs || []).filter(
        (doc) => new Date(doc.created_at).getTime() >= monthStart
      ).length,
      documents_completed: (docs || []).filter((doc) => doc.estado === 'completado').length,
      documents_pending: (docs || []).filter((doc) => doc.estado !== 'completado').length,
      total_documents_visible: (docs || []).length,
    };
  }

  return context;
}

type StructuredOptions = {
  documentId?: string;
  versionId?: string;
  expedienteId?: string;
  extractedStatus?: string;
  extractedUserName?: string;
  mode?: string;
  accessToken?: string;
  routeContext?: RouteContext;
};

export type LuciaContextErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'TOKEN_EXPIRED'
  | 'WORKSPACE_ACCESS_DENIED'
  | 'ENTITLEMENT_REQUIRED'
  | 'RESOURCE_ACCESS_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_NOT_FOUND_OR_DENIED'
  | 'RESOURCE_NOT_INDEXED'
  | 'MODULE_NOT_SUPPORTED'
  | 'NO_DATA'
  | 'SCHEMA_UNAVAILABLE'
  | 'SUPABASE_RPC_ERROR'
  | 'AI_PROVIDER_ERROR';

export type LuciaSpecializedContext = {
  module: string;
  module_status?: LuciaModuleStatus;
  data_availability?: LuciaDataAvailability;
  message?: string;
  resource_id: string | null;
  workspace_id: string;
  permission: { can_view: boolean; role: string | null; reason: string };
  summary: Record<string, unknown>;
  items: unknown[];
  counts: Record<string, unknown>;
  statuses: Record<string, unknown>;
  pending_actions: unknown[];
  evidence_sources: Array<{ source: string; source_id: string }>;
  warnings: string[];
  error_code: LuciaContextErrorCode | null;
  row_count: number;
  _context_meta?: { rpc: string; latency_ms: number };
};

const SPECIALIZED_CONTEXT_MODULES = new Set([
  'organization',
  'collaboration',
  'expedientes',
  'certifications',
  'certified_notifications',
  'batch_signatures',
  'credit_titles',
  'forms',
  'reports',
  'billing',
]);

const DOCUMENT_INTELLIGENCE_INTENTS = new Set<LuciaIntent>([
  'document_intelligence_profile',
  'document_classification',
  'document_extracted_fields',
  'document_obligations',
  'document_completeness',
  'document_metadata_suggestions',
  'document_folder_suggestions',
  'document_tag_suggestions',
  'document_quality_score',
  'document_version_comparison',
  'document_evidence_sources',
]);

function intelligenceSchemaUnavailable(error: unknown) {
  const code = String((error as { code?: unknown })?.code || '');
  const message = String((error as { message?: unknown })?.message || '');
  return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(message);
}

async function documentIntelligenceContext(
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions
) {
  const startedAt = Date.now();
  const documentId = opts.documentId || opts.routeContext?.currentResourceIds.documentId || null;
  const ids = allowedIds(authorization, documentId);
  const empty = {
    module: 'document_intelligence',
    workspace_id: workspaceId,
    resource_id: documentId,
    permission: {
      can_view: ids.length > 0,
      role: authorization.role,
      reason: ids.length ? 'DOCUMENT_ACL' : 'NO_AUTHORIZED_DOCUMENT',
    },
    profile: null,
    fields: [],
    obligations: [],
    classifications: [],
    completeness_checks: [],
    evidence_sources: [],
    row_count: 0,
    error_code: null,
    _context_meta: { rpc: 'document_intelligence_read_model', latency_ms: Date.now() - startedAt },
  };
  if (!isDocumentIntelligenceEnabled()) {
    return {
      ...empty,
      permission: {
        can_view: false,
        role: authorization.role,
        reason: 'DOCUMENT_INTELLIGENCE_DISABLED',
      },
      error_code: 'DOCUMENT_INTELLIGENCE_DISABLED' as const,
      warnings: [DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE],
    };
  }
  if (!ids.length) return empty;

  const service = createServiceClient();

  let versionId: string | null | undefined = opts.versionId;
  if (documentId && versionId === undefined) {
    const latestVersion = await service
      .from('document_versions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('document_id', documentId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestVersion.error) {
      return {
        ...empty,
        error_code: 'SUPABASE_RPC_ERROR' as const,
        warnings: ['No fue posible resolver la version documental vigente.'],
      };
    }
    versionId = latestVersion.data?.id || null;
  }
  const scoped = (table: string, select: string) => {
    let query = (service as any)
      .from(table)
      .select(select)
      .eq('workspace_id', workspaceId)
      .in('document_id', ids);
    if (documentId && versionId !== undefined) {
      query = versionId
        ? query.eq('document_version_id', versionId)
        : query.is('document_version_id', null);
    }
    return query;
  };
  const [profiles, fields, obligations, classifications, checks] = await Promise.all([
    scoped(
      'ai_document_profiles',
      'id,document_id,document_version_id,detected_document_type,detected_document_category,title_suggestion,short_summary,executive_summary,language,confidence,quality_score,risk_score,completeness_score,status,extraction_status,source_chunk_ids,evidence,warnings,updated_at'
    )
      .order('updated_at', { ascending: false })
      .limit(documentId ? 1 : 50),
    scoped(
      'ai_document_extracted_fields',
      'id,document_id,document_version_id,field_key,field_label,field_value,normalized_value,value_type,confidence,page_number,chunk_id,evidence_text,status'
    )
      .not('value_type', 'in', '(rfc,curp,email,phone,address)')
      .limit(documentId ? 100 : 50),
    scoped(
      'ai_document_obligations',
      'id,document_id,document_version_id,obligation_type,description,due_date,recurrence_rule,priority,confidence,page_number,chunk_id,evidence_text,suggested_task,status'
    ).limit(documentId ? 100 : 50),
    scoped(
      'ai_document_classifications',
      'id,document_id,document_version_id,classification_type,classification_value,confidence,reason,evidence'
    ).limit(documentId ? 100 : 100),
    scoped(
      'ai_document_completeness_checks',
      'id,document_id,document_version_id,check_key,check_label,status,severity,description,recommendation,evidence'
    ).limit(documentId ? 50 : 50),
  ]);
  const results = [profiles, fields, obligations, classifications, checks];
  const schemaFailure = results.find((result) => intelligenceSchemaUnavailable(result.error));
  if (schemaFailure) {
    return {
      ...empty,
      error_code: 'SCHEMA_UNAVAILABLE' as const,
      warnings: ['La migracion de inteligencia documental aun no esta disponible en este entorno.'],
      _context_meta: {
        rpc: 'document_intelligence_read_model',
        latency_ms: Date.now() - startedAt,
      },
    };
  }
  if (results.some((result) => result.error)) {
    return {
      ...empty,
      error_code: 'SUPABASE_RPC_ERROR' as const,
      warnings: ['No fue posible consultar la inteligencia documental.'],
      _context_meta: {
        rpc: 'document_intelligence_read_model',
        latency_ms: Date.now() - startedAt,
      },
    };
  }
  const profileRows = profiles.data || [];
  const fieldRows = fields.data || [];
  const obligationRows = obligations.data || [];
  const classificationRows = classifications.data || [];
  const checkRows = checks.data || [];
  const evidenceSources = [
    ...profileRows.map((row: any) => ({
      source: 'ai_document_profiles',
      source_id: row.id,
      source_type: 'document_profile',
      document_id: row.document_id,
      document_version_id: row.document_version_id,
      chunk_id: null,
      page_number: null,
      confidence: row.confidence,
    })),
    ...fieldRows
      .filter((row: any) => row.chunk_id)
      .map((row: any) => ({
        source: 'ai_document_extracted_fields',
        source_id: row.id,
        source_type: 'extracted_field',
        document_id: row.document_id,
        document_version_id: row.document_version_id,
        chunk_id: row.chunk_id,
        page_number: row.page_number,
        confidence: row.confidence,
      })),
    ...obligationRows
      .filter((row: any) => row.chunk_id)
      .map((row: any) => ({
        source: 'ai_document_obligations',
        source_id: row.id,
        source_type: 'obligation',
        document_id: row.document_id,
        document_version_id: row.document_version_id,
        chunk_id: row.chunk_id,
        page_number: row.page_number,
        confidence: row.confidence,
      })),
    ...classificationRows.map((row: any) => ({
      source: 'ai_document_classifications',
      source_id: row.id,
      source_type: 'classification',
      document_id: row.document_id,
      document_version_id: row.document_version_id,
      chunk_id: row.evidence?.[0]?.chunk_id || null,
      page_number: row.evidence?.[0]?.page_number || null,
      confidence: row.confidence,
    })),
  ];
  return {
    ...empty,
    profile: profileRows[0] || null,
    profiles: documentId ? undefined : profileRows,
    fields: fieldRows,
    obligations: obligationRows,
    classifications: classificationRows,
    completeness_checks: checkRows,
    evidence_sources: evidenceSources,
    row_count:
      profileRows.length +
      fieldRows.length +
      obligationRows.length +
      classificationRows.length +
      checkRows.length,
    _context_meta: { rpc: 'document_intelligence_read_model', latency_ms: Date.now() - startedAt },
  };
}

const DEVELOPMENT_CONTEXT_MESSAGE = 'Módulo en construcción; datos operativos aún no disponibles.';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value?: string | null) {
  return value && UUID_PATTERN.test(value) ? value : null;
}

function routeSection(routeContext?: RouteContext) {
  return routeContext?.route.split('/').filter(Boolean)[1]?.slice(0, 80) || null;
}

function specializedContextError(
  moduleKey: string,
  workspaceId: string,
  errorCode: LuciaContextErrorCode,
  reason: string,
  rpc: string,
  latencyMs: number,
  routeContext?: RouteContext
): LuciaSpecializedContext {
  const developmentSchemaUnavailable =
    errorCode === 'SCHEMA_UNAVAILABLE' && routeContext?.moduleStatus === 'in_development';
  return {
    module: moduleKey,
    ...(developmentSchemaUnavailable
      ? {
          module_status: 'in_development' as const,
          data_availability: 'schema_unavailable' as const,
          message: DEVELOPMENT_CONTEXT_MESSAGE,
        }
      : {}),
    resource_id: null,
    workspace_id: workspaceId,
    permission: { can_view: false, role: null, reason },
    summary: {},
    items: [],
    counts: {},
    statuses: {},
    pending_actions: [],
    evidence_sources: [],
    warnings: [],
    error_code: errorCode,
    row_count: 0,
    _context_meta: { rpc, latency_ms: latencyMs },
  };
}

function mapRpcError(error: { code?: string; message?: string }) {
  if (error.code === '42501') return 'RESOURCE_ACCESS_DENIED' as const;
  if (['42883', '42P01', '42703', 'PGRST202'].includes(error.code || '')) {
    return 'SCHEMA_UNAVAILABLE' as const;
  }
  return 'SUPABASE_RPC_ERROR' as const;
}

async function specializedModuleContext(
  moduleKey: string,
  workspaceId: string,
  opts: StructuredOptions
): Promise<LuciaSpecializedContext> {
  const startedAt = Date.now();
  if (!opts.accessToken) {
    return specializedContextError(
      moduleKey,
      workspaceId,
      'TOKEN_EXPIRED',
      'authenticated_access_token_required',
      'none',
      0,
      opts.routeContext
    );
  }

  const resources = opts.routeContext?.currentResourceIds || {};
  const section = routeSection(opts.routeContext);
  const definitions: Record<string, { rpc: string; params: Record<string, unknown> }> = {
    organization: {
      rpc: 'get_lucia_organization_context',
      params: {
        p_workspace_id: workspaceId,
        p_section: section,
        p_resource_id: uuidOrNull(resources.personId || resources.memberId),
      },
    },
    collaboration: {
      rpc: 'get_lucia_collaboration_context',
      params: {
        p_workspace_id: workspaceId,
        p_section: section,
        p_resource_id: uuidOrNull(resources.resourceId),
      },
    },
    expedientes: {
      rpc: 'get_lucia_case_file_context',
      params: {
        p_workspace_id: workspaceId,
        p_case_file_id: uuidOrNull(opts.expedienteId || resources.expedienteId),
      },
    },
    certifications: {
      rpc: 'get_lucia_certification_context',
      params: {
        p_workspace_id: workspaceId,
        p_certification_id: uuidOrNull(resources.certificationId),
      },
    },
    certified_notifications: {
      rpc: 'get_lucia_certified_notification_context',
      params: {
        p_workspace_id: workspaceId,
        p_notification_id: uuidOrNull(resources.notificationId),
      },
    },
    batch_signatures: {
      rpc: 'get_lucia_batch_signature_context',
      params: {
        p_workspace_id: workspaceId,
        p_batch_id: uuidOrNull(resources.batchId),
      },
    },
    credit_titles: {
      rpc: 'get_lucia_credit_title_context',
      params: {
        p_workspace_id: workspaceId,
        p_credit_title_id: uuidOrNull(resources.creditTitleId),
      },
    },
    forms: {
      rpc: 'get_lucia_form_context',
      params: {
        p_workspace_id: workspaceId,
        p_form_id: uuidOrNull(resources.formId),
      },
    },
    reports: {
      rpc: 'get_lucia_report_context',
      params: {
        p_workspace_id: workspaceId,
        p_report_scope: opts.routeContext?.uiState.view === 'workspace' ? 'workspace' : 'personal',
        p_filters: {
          ...(opts.extractedStatus ? { status: opts.extractedStatus } : {}),
        },
      },
    },
    billing: {
      rpc: 'get_lucia_billing_context',
      params: { p_workspace_id: workspaceId },
    },
  };

  const definition = definitions[moduleKey];
  if (!definition) {
    return specializedContextError(
      moduleKey,
      workspaceId,
      'MODULE_NOT_SUPPORTED',
      'specialized_context_not_registered',
      'none',
      Date.now() - startedAt,
      opts.routeContext
    );
  }

  const scoped = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${opts.accessToken}` } } }
  );
  const { data, error } = await scoped.rpc(definition.rpc, definition.params);
  const latencyMs = Date.now() - startedAt;
  if (error) {
    return specializedContextError(
      moduleKey,
      workspaceId,
      mapRpcError(error),
      'specialized_context_rpc_failed',
      definition.rpc,
      latencyMs,
      opts.routeContext
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return specializedContextError(
      moduleKey,
      workspaceId,
      'SCHEMA_UNAVAILABLE',
      'invalid_specialized_context_contract',
      definition.rpc,
      latencyMs,
      opts.routeContext
    );
  }

  const specializedData = data as LuciaSpecializedContext;
  const developmentSchemaUnavailable =
    specializedData.error_code === 'SCHEMA_UNAVAILABLE' &&
    opts.routeContext?.moduleStatus === 'in_development';
  return {
    ...specializedData,
    ...(developmentSchemaUnavailable
      ? {
          module_status: 'in_development' as const,
          data_availability: 'schema_unavailable' as const,
          message: DEVELOPMENT_CONTEXT_MESSAGE,
        }
      : opts.routeContext?.moduleStatus === 'in_development'
        ? {
            module_status: opts.routeContext.moduleStatus,
            data_availability: opts.routeContext.dataAvailability,
          }
        : {}),
    _context_meta: { rpc: definition.rpc, latency_ms: latencyMs },
  };
}

export function getSpecializedContextError(context: unknown) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const errorCode = (context as Partial<LuciaSpecializedContext>).error_code;
  return errorCode || null;
}

async function documentContext(
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions,
  intent: LuciaIntent
) {
  const ids = allowedIds(
    authorization,
    opts.documentId || opts.routeContext?.currentResourceIds.documentId
  );
  if (!ids.length) return null;
  const supabase = createServiceClient();
  let documentsQuery = supabase
    .from('documentos')
    .select(DOCUMENT_FIELDS)
    .in('id', ids)
    .is('deleted_at', null);
  if (opts.extractedStatus) documentsQuery = documentsQuery.eq('estado', opts.extractedStatus);
  const { data: documents } = await documentsQuery
    .order('created_at', { ascending: false })
    .limit(30);

  const result: Record<string, unknown> = {
    module_key: opts.routeContext?.moduleKey,
    documents: withSource('documentos', documents),
  };
  if (
    ['signature_status', 'participations_summary', 'requests_summary', 'document_review'].includes(
      intent
    ) ||
    opts.routeContext?.moduleKey === 'document_viewer'
  ) {
    const { data } = await supabase
      .from('participation_responses')
      .select(
        'id,documento_id,participante_nombre,tipo_participacion,firma_completada,firma_completada_at,aprobacion_completada,aprobacion_completada_at,created_at'
      )
      .in('documento_id', ids)
      .limit(100);
    result.participations = withSource('participation_responses', data);
  }
  if (intent === 'document_versions' || opts.routeContext?.route.endsWith('/versiones')) {
    const { data } = await supabase
      .from('document_versions')
      .select('id,document_id,version_number,status,created_at,created_by')
      .in('document_id', ids)
      .order('version_number', { ascending: false })
      .limit(50);
    result.versions = withSource('document_versions', data);
  }
  if (
    ['document_review', 'document_metadata'].includes(intent) ||
    opts.routeContext?.moduleKey === 'document_viewer'
  ) {
    const { data } = await supabase
      .from('document_activity_log')
      .select('id,documento_id,actor_nombre,action,category,details,created_at')
      .in('documento_id', ids)
      .order('created_at', { ascending: false })
      .limit(40);
    result.activity = withSource('document_activity_log', data);
  }
  return result;
}

async function taskContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext
) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tareas')
    .select(
      'id,title,tipo,prioridad,estado,riesgo,due_date,document_id,expediente_id,is_overdue,is_blocked,is_critical,created_at'
    )
    .eq('workspace_id', workspaceId)
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(50);
  const allowed = new Set(authorization.allowed_document_ids);
  const rows = (data || []).filter((task) => !task.document_id || allowed.has(task.document_id));
  return { tasks: withSource('tareas', rows) };
}

async function formContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  includeResponses: boolean
) {
  const supabase = createServiceClient();
  let query = supabase
    .from('form_templates')
    .select('id,name,description,status,created_by,created_at,updated_at')
    .eq('workspace_id', workspaceId);
  if (!isManager(authorization)) query = query.eq('created_by', userId);
  const { data: forms } = await query.order('created_at', { ascending: false }).limit(30);
  const result: Record<string, unknown> = { forms: withSource('form_templates', forms) };
  if (includeResponses && forms?.length) {
    const formIds = forms.map((form) => form.id);
    const { data: responses } = await supabase
      .from('form_responses')
      .select('id,template_id,document_id,submitted_at')
      .in('template_id', formIds)
      .limit(100);
    const allowed = new Set(authorization.allowed_document_ids);
    const visible = (responses || []).filter(
      (response) => !response.document_id || allowed.has(response.document_id)
    );
    result.response_summary = {
      source: 'form_responses',
      total: visible.length,
      by_template: formIds.map((id) => ({
        template_id: id,
        count: visible.filter((response) => response.template_id === id).length,
      })),
    };
  }
  return result;
}

async function expedienteContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions
) {
  const supabase = createServiceClient();
  let caseIds: string[] = [];
  if (isManager(authorization)) {
    const { data } = await supabase
      .from('case_files')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(100);
    caseIds = (data || []).map((row) => row.id);
  } else {
    const [{ data: owned }, { data: participations }] = await Promise.all([
      supabase
        .from('case_files')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('owner_user_id', userId)
        .limit(100),
      supabase
        .from('case_file_participants')
        .select('case_file_id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(100),
    ]);
    caseIds = [
      ...new Set([
        ...(owned || []).map((row) => row.id),
        ...(participations || []).map((row) => row.case_file_id),
      ]),
    ];
  }
  const requestedId = opts.expedienteId || opts.routeContext?.currentResourceIds.expedienteId;
  if (requestedId) caseIds = caseIds.includes(requestedId) ? [requestedId] : [];
  if (!caseIds.length) return null;

  const [{ data: cases }, { data: requirements }, { data: links }, { data: events }] =
    await Promise.all([
      supabase
        .from('case_files')
        .select(
          'id,folio,title,case_type,status,priority,progress,target_close_at,closure_status,created_at,updated_at'
        )
        .in('id', caseIds)
        .limit(30),
      supabase
        .from('case_file_requirements')
        .select('id,case_file_id,title,category,is_required,sort_order')
        .in('case_file_id', caseIds)
        .limit(100),
      supabase
        .from('case_file_documents')
        .select('id,case_file_id,source_document_id,requirement_id,document_name,status,created_at')
        .in('case_file_id', caseIds)
        .limit(100),
      supabase
        .from('case_file_audit_events')
        .select('id,case_file_id,actor_label,action,affected_object_type,result,occurred_at')
        .in('case_file_id', caseIds)
        .order('occurred_at', { ascending: false })
        .limit(50),
    ]);
  const allowed = new Set(authorization.allowed_document_ids);
  return {
    case_files: withSource('case_files', cases),
    requirements: withSource('case_file_requirements', requirements),
    document_links: withSource(
      'case_file_documents',
      (links || []).filter((row) => !row.source_document_id || allowed.has(row.source_document_id))
    ),
    audit: withSource('case_file_audit_events', events),
  };
}

async function certifiedNotificationContext(
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions
) {
  const ids = allowedIds(authorization);
  if (!ids.length) return null;
  const supabase = createServiceClient();
  let query = supabase
    .from('certified_notifications')
    .select(
      'id,source_document_id,folio,subject,category,status,evidence_level,due_at,published_at,completed_at,last_event_label,created_at'
    )
    .in('source_document_id', ids);
  const notificationId = opts.routeContext?.currentResourceIds.notificationId;
  if (notificationId) query = query.eq('id', notificationId);
  const { data: notifications } = await query.order('created_at', { ascending: false }).limit(30);
  if (!notifications?.length) return null;
  const notificationIds = notifications.map((row) => row.id);
  const [{ data: recipients }, { data: events }, { data: certificates }] = await Promise.all([
    supabase
      .from('notification_recipients')
      .select('id,notification_id,name,role,status,authenticated_at,accessed_at,acknowledged_at')
      .in('notification_id', notificationIds)
      .limit(100),
    supabase
      .from('notification_evidence_events')
      .select('id,notification_id,event_type,label,actor_label,occurred_at')
      .in('notification_id', notificationIds)
      .order('occurred_at', { ascending: false })
      .limit(100),
    supabase
      .from('notification_certificates')
      .select('id,notification_id,certificate_type,status,created_at')
      .in('notification_id', notificationIds)
      .limit(50),
  ]);
  return {
    notifications: withSource('certified_notifications', notifications),
    recipients: withSource('notification_recipients', recipients),
    evidence_events: withSource('notification_evidence_events', events),
    certificates: withSource('notification_certificates', certificates),
  };
}

async function certificationContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions
) {
  const supabase = createServiceClient();
  const documentIds = allowedIds(authorization);
  let casesQuery = supabase
    .from('certification_cases')
    .select(
      'id,human_folio,source_type,source_document_id,title,service_key,purpose_key,status,provider_mode,file_classification,malware_status,warnings,error_code,created_at,updated_at'
    )
    .eq('workspace_id', workspaceId);
  if (!isManager(authorization)) casesQuery = casesQuery.eq('created_by', userId);
  const { data: cases } = await casesQuery.order('created_at', { ascending: false }).limit(30);
  const visibleCases = (cases || []).filter(
    (item) => !item.source_document_id || documentIds.includes(item.source_document_id)
  );
  const requested = opts.routeContext?.currentResourceIds.certificationId;
  const filteredCases = requested
    ? visibleCases.filter((item) => item.id === requested)
    : visibleCases;
  const { data: certifications } = documentIds.length
    ? await supabase
        .from('document_certifications')
        .select('id,document_id,status,document_version,created_at,completed_at,error_code')
        .in('document_id', documentIds)
        .order('created_at', { ascending: false })
        .limit(30)
    : { data: [] as unknown[] };
  return {
    cases: withSource('certification_cases', filteredCases),
    document_certifications: withSource('document_certifications', certifications),
  };
}

async function batchSignatureContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions
) {
  const supabase = createServiceClient();
  let query = supabase
    .from('bulk_signature_campaigns')
    .select(
      'id,name,campaign_type,status,priority,total_items,completed_items,pending_items,failed_items,participant_count,scheduled_at,expires_at,created_at,updated_at'
    )
    .eq('workspace_id', workspaceId);
  if (!isManager(authorization)) query = query.eq('owner_user_id', userId);
  const requested = opts.routeContext?.currentResourceIds.batchId;
  if (requested) query = query.eq('id', requested);
  const { data: campaigns } = await query.order('created_at', { ascending: false }).limit(30);
  if (!campaigns?.length) return { campaigns: withSource('bulk_signature_campaigns', []) };
  const campaignIds = campaigns.map((row) => row.id);
  const [{ data: items }, { data: imports }] = await Promise.all([
    supabase
      .from('bulk_campaign_items')
      .select(
        'id,campaign_id,document_id,status,progress,error_code,error_message,attempt_count,last_activity_at'
      )
      .in('campaign_id', campaignIds)
      .limit(200),
    supabase
      .from('bulk_campaign_imports')
      .select('id,campaign_id,file_name,status,total_rows,valid_rows,invalid_rows,created_at')
      .in('campaign_id', campaignIds)
      .limit(50),
  ]);
  const allowed = new Set(authorization.allowed_document_ids);
  return {
    campaigns: withSource('bulk_signature_campaigns', campaigns),
    items: withSource(
      'bulk_campaign_items',
      (items || []).filter((row) => !row.document_id || allowed.has(row.document_id))
    ),
    imports: withSource('bulk_campaign_imports', imports),
  };
}

async function creditTitleContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions
) {
  const supabase = createServiceClient();
  let query = supabase
    .from('credit_titles')
    .select(
      'id,folio,status,nominal_amount,outstanding_balance,currency,maturity_date,current_holder_name,source_document_id,representation_document_id,issued_at,created_at,updated_at'
    )
    .eq('workspace_id', workspaceId);
  if (!isManager(authorization)) query = query.eq('created_by', userId);
  const requested = opts.routeContext?.currentResourceIds.creditTitleId;
  if (requested) query = query.eq('id', requested);
  const { data: titles } = await query.order('created_at', { ascending: false }).limit(30);
  const allowed = new Set(authorization.allowed_document_ids);
  const visible = (titles || []).filter(
    (row) =>
      (!row.source_document_id || allowed.has(row.source_document_id)) &&
      (!row.representation_document_id || allowed.has(row.representation_document_id))
  );
  const titleIds = visible.map((row) => row.id);
  const [{ data: events }, { data: portfolios }] = titleIds.length
    ? await Promise.all([
        supabase
          .from('title_events')
          .select('id,title_id,event_type,sequence_no,occurred_at')
          .in('title_id', titleIds)
          .order('occurred_at', { ascending: false })
          .limit(100),
        supabase
          .from('portfolio_titles')
          .select('portfolio_id,title_id,added_at')
          .in('title_id', titleIds)
          .limit(100),
      ])
    : [{ data: [] }, { data: [] }];
  return {
    titles: withSource('credit_titles', visible),
    events: withSource('title_events', events),
    portfolio_links: withSource('portfolio_titles', portfolios),
  };
}

async function organizationContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext
) {
  const supabase = createServiceClient();
  if (!isManager(authorization)) {
    const { data } = await supabase
      .from('workspace_members')
      .select('id,user_id,role,status,joined_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .limit(1);
    return { current_membership: withSource('workspace_members', data) };
  }
  const [{ data: members }, { data: roles }, { data: units }] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('id,user_id,role,status,joined_at')
      .eq('workspace_id', workspaceId)
      .limit(100),
    supabase
      .from('organization_roles')
      .select('id,name,description,system_key,is_system')
      .eq('workspace_id', workspaceId)
      .limit(50),
    supabase
      .from('organization_units')
      .select('id,parent_id,name,status,leader_member_id')
      .eq('workspace_id', workspaceId)
      .limit(100),
  ]);
  return {
    members: withSource('workspace_members', members),
    roles: withSource('organization_roles', roles),
    units: withSource('organization_units', units),
  };
}

async function collaborationContext(
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext
) {
  const supabase = createServiceClient();
  let spaceIds: string[] = [];
  if (isManager(authorization)) {
    const { data } = await supabase
      .from('collaboration_spaces')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(100);
    spaceIds = (data || []).map((row) => row.id);
  } else {
    const { data } = await supabase
      .from('collaboration_space_members')
      .select('space_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(100);
    spaceIds = (data || []).map((row) => row.space_id);
  }
  if (!spaceIds.length) return { spaces: withSource('collaboration_spaces', []) };
  const [{ data: spaces }, { data: requests }, { data: events }] = await Promise.all([
    supabase
      .from('collaboration_spaces')
      .select('id,name,space_type,status,confidentiality,case_file_id,created_at,updated_at')
      .in('id', spaceIds)
      .limit(50),
    supabase
      .from('collaboration_document_requests')
      .select('id,space_id,case_file_id,folio,title,status,responsible_user_id,due_at,created_at')
      .in('space_id', spaceIds)
      .limit(100),
    supabase
      .from('collaboration_activity_events')
      .select('id,space_id,event_type,resource_type,summary,occurred_at')
      .in('space_id', spaceIds)
      .order('occurred_at', { ascending: false })
      .limit(100),
  ]);
  return {
    spaces: withSource('collaboration_spaces', spaces),
    requests: withSource('collaboration_document_requests', requests),
    activity: withSource('collaboration_activity_events', events),
  };
}

export async function buildStructuredContext(
  question: string,
  intent: LuciaIntent,
  userId: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  opts: StructuredOptions = {}
) {
  void question;
  const moduleKey = opts.routeContext?.moduleKey;
  if (intent === 'public_token_help') {
    if (!authorization.is_public_token_flow || authorization.denied_reason) return null;
    return {
      token_grant: {
        source: 'resolved_public_capability',
        grant_id: authorization.token_grant_id,
        permissions: authorization.permissions,
        resource_ids: authorization.allowed_resource_ids,
      },
    };
  }
  if (!isAuthorizedWorkspace(authorization, workspaceId, userId)) return null;

  if (intent === 'module_design_help' && opts.routeContext?.moduleStatus === 'in_development') {
    return {
      module: opts.routeContext.moduleKey,
      module_status: opts.routeContext.moduleStatus,
      data_availability: opts.routeContext.dataAvailability,
      message: DEVELOPMENT_CONTEXT_MESSAGE,
      purpose: opts.routeContext.purpose,
      entities: opts.routeContext.entities,
      planned_data_sources: opts.routeContext.dataSources,
      allowed_guidance: opts.routeContext.availableActions,
      security_constraints: opts.routeContext.sensitiveFields,
      operational_data: false,
    };
  }

  if (DOCUMENT_INTELLIGENCE_INTENTS.has(intent)) {
    return documentIntelligenceContext(workspaceId, authorization, opts);
  }

  if (moduleKey && SPECIALIZED_CONTEXT_MODULES.has(moduleKey)) {
    return specializedModuleContext(moduleKey, workspaceId, opts);
  }

  if (
    ['home_summary', 'reports_summary'].includes(intent) ||
    moduleKey === 'home' ||
    moduleKey === 'reports'
  ) {
    const docs = await documentContext(authorization, opts, 'document_search');
    const tasks = await taskContext(userId, workspaceId, authorization);
    return { documents: docs, ...tasks };
  }
  if (
    [
      'document_search',
      'document_metadata',
      'document_versions',
      'document_review',
      'signature_status',
      'participations_summary',
      'requests_summary',
    ].includes(intent) ||
    ['documents', 'document_viewer', 'signing', 'participations', 'requests'].includes(
      moduleKey || ''
    )
  )
    return documentContext(authorization, opts, intent);
  if (intent === 'tasks_summary' || moduleKey === 'tasks')
    return taskContext(userId, workspaceId, authorization);

  const supabase = createServiceClient();
  if (intent === 'contacts_search' || moduleKey === 'contacts') {
    const { data } = await supabase
      .from('contacts')
      .select('id,nombre,apellido_paterno,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    return { contacts: withSource('contacts', data) };
  }
  if (intent === 'templates_help' || moduleKey === 'templates' || moduleKey === 'create_document') {
    let query = supabase
      .from('plantillas')
      .select('id,name,description,category,status,created_by,created_at')
      .eq('workspace_id', workspaceId);
    if (!isManager(authorization)) query = query.eq('created_by', userId);
    const { data } = await query.order('created_at', { ascending: false }).limit(30);
    return { templates: withSource('plantillas', data) };
  }
  if (['forms_help', 'forms_responses_summary'].includes(intent) || moduleKey === 'forms') {
    return formContext(userId, workspaceId, authorization, intent === 'forms_responses_summary');
  }
  if (
    ['expediente_summary', 'expediente_requirements'].includes(intent) ||
    moduleKey === 'expedientes'
  ) {
    return expedienteContext(userId, workspaceId, authorization, opts);
  }
  if (intent === 'notifications_summary' || moduleKey === 'notifications') {
    const { data } = await supabase
      .from('notifications')
      .select('id,type,title,description,priority,read,created_at,entity_type,entity_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    const allowed = new Set(authorization.allowed_document_ids);
    return {
      notifications: withSource(
        'notifications',
        (data || []).filter(
          (row) => row.entity_type !== 'document' || !row.entity_id || allowed.has(row.entity_id)
        )
      ),
    };
  }
  if (intent === 'certified_notification_status' || moduleKey === 'certified_notifications') {
    return certifiedNotificationContext(authorization, opts);
  }
  if (intent === 'certification_status' || moduleKey === 'certifications') {
    return certificationContext(userId, workspaceId, authorization, opts);
  }
  if (intent === 'batch_signature_status' || moduleKey === 'batch_signatures') {
    return batchSignatureContext(userId, workspaceId, authorization, opts);
  }
  if (intent === 'credit_title_status' || moduleKey === 'credit_titles') {
    return creditTitleContext(userId, workspaceId, authorization, opts);
  }
  if (intent === 'organization_permissions' || moduleKey === 'organization') {
    return organizationContext(userId, workspaceId, authorization);
  }
  if (intent === 'collaboration_summary' || moduleKey === 'collaboration') {
    return collaborationContext(userId, workspaceId, authorization);
  }
  if (intent === 'configuration_security' || moduleKey === 'configuration_security') {
    return {
      security: {
        source: 'authorization_context',
        role: authorization.role,
        membership_status: authorization.membership_status,
        permissions: authorization.permissions,
      },
    };
  }
  if (intent === 'billing_usage' || moduleKey === 'billing') {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select(
        'id,status,documents_used,documents_limit,current_period_start,current_period_end,plan:plan_id(id,name,slug,documents_included)'
      )
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('current_period_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: ledger } = isManager(authorization)
      ? await supabase
          .from('organization_usage_ledger')
          .select('id,metric_key,quantity,unit,source_type,occurred_at')
          .eq('workspace_id', workspaceId)
          .order('occurred_at', { ascending: false })
          .limit(50)
      : { data: [] as unknown[] };
    return {
      subscription: withSource('subscriptions', subscription),
      usage: withSource('organization_usage_ledger', ledger),
    };
  }
  if (intent === 'integrations_help' || moduleKey === 'integrations') {
    const { data } = await supabase
      .from('user_module_preferences')
      .select('id,active_module_id,updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    return { activation: withSource('user_module_preferences', data) };
  }
  return null;
}

async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8_000) }),
  });
  if (!response.ok) return null;
  const json = await response.json();
  return json?.data?.[0]?.embedding || null;
}

const RAG_MODULES = new Set([
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

export async function buildRagContext(
  question: string,
  workspaceId: string,
  authorization: LuciaAuthorizationContext,
  options: {
    documentId?: string;
    versionId?: string;
    accessToken?: string;
    intent: LuciaIntent;
    routeContext?: RouteContext;
  }
) {
  if (DOCUMENT_INTELLIGENCE_INTENTS.has(options.intent) && !isDocumentIntelligenceEnabled()) {
    return [];
  }
  if (
    !['document_content_search', 'document_summary', ...DOCUMENT_INTELLIGENCE_INTENTS].includes(
      options.intent
    )
  )
    return [];
  if (options.routeContext && !RAG_MODULES.has(options.routeContext.moduleKey)) return [];
  const routeDocumentId = options.routeContext?.currentResourceIds.documentId;
  const ids = allowedIds(authorization, options.documentId);
  if (!ids.length && routeDocumentId) {
    ids.push(...allowedIds(authorization, routeDocumentId));
  }
  if (!ids.length || authorization.workspace_id !== workspaceId) return [];

  const select =
    'id,document_id,document_version_id,document_hash,workspace_id,content,page_number,chunk_index,metadata';
  if (authorization.is_public_token_flow) {
    const { data } = await createServiceClient()
      .from('ai_document_chunks')
      .select(select)
      .eq('workspace_id', workspaceId)
      .in('document_id', ids)
      .limit(8);
    return data || [];
  }
  if (!options.accessToken) return [];

  const scoped = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${options.accessToken}` } } }
  );
  let fallbackQuery = scoped
    .from('ai_document_chunks')
    .select(select)
    .eq('workspace_id', workspaceId)
    .in('document_id', ids);
  if (options.versionId) {
    fallbackQuery = fallbackQuery.eq('document_version_id', options.versionId);
  }
  const { data } = await fallbackQuery.limit(8);
  const authorizedChunks = data || [];
  if (
    !authorizedChunks.length ||
    options.intent === 'document_summary' ||
    DOCUMENT_INTELLIGENCE_INTENTS.has(options.intent) ||
    options.versionId
  ) {
    return authorizedChunks;
  }

  const embedding = await generateQueryEmbedding(question);
  if (!embedding) return authorizedChunks;
  const { data: matches, error } = await scoped.rpc('match_document_chunks', {
    query_embedding: embedding,
    p_workspace_id: workspaceId,
    p_document_id: options.documentId || routeDocumentId || null,
    p_allowed_document_ids: ids,
    match_threshold: 0.65,
    match_count: 8,
  });
  return !error && matches?.length ? matches : authorizedChunks;
}

export async function saveQueryLog(log: {
  workspaceId?: string | null;
  userId?: string | null;
  sessionId?: string;
  question: string;
  intent: string;
  scope: string;
  route?: string | null;
  documentIds?: string[];
  chunkIds?: string[];
  sourceIds?: string[];
  tokenGrantId?: string | null;
  contextUsed: Record<string, unknown>;
  responseText: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  errorCode?: string | null;
  hasEvidence: boolean;
}) {
  const inputTokens = log.inputTokens || null;
  const outputTokens = log.outputTokens || null;
  const estimatedCost = estimateAiCost(inputTokens, outputTokens);
  await createServiceClient()
    .from('ai_query_logs')
    .insert({
      workspace_id: log.workspaceId,
      user_id: log.userId || null,
      session_id: log.sessionId || null,
      question: redactSensitiveText(log.question, 1_000),
      intent: log.intent,
      scope: log.scope,
      route: log.route || null,
      document_id: log.documentIds?.[0] || null,
      document_ids: log.documentIds || [],
      chunk_ids: log.chunkIds || [],
      source_ids: log.sourceIds || [],
      token_grant_id: log.tokenGrantId || null,
      context_used: log.contextUsed,
      response_text: redactSensitiveText(log.responseText, 2_000),
      provider: 'OPEN_AI',
      model: 'gpt-4o-mini',
      prompt_version: LUCIA_PROMPT_VERSION,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      tokens_used: (inputTokens || 0) + (outputTokens || 0) || null,
      estimated_cost_usd: estimatedCost,
      duration_ms: log.durationMs || null,
      error_code: log.errorCode || null,
      has_evidence: log.hasEvidence,
    });
}
