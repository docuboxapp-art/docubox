import { createHash } from 'node:crypto';
import { completion } from '@rocketnew/llm-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { assertAuthorizedDocument, type LuciaAuthorizationContext } from './luciaAuthorization';
import { saveQueryLog } from './luciaQueries';
import { LUCIA_MODEL, redactSensitiveText } from './security';
import {
  CLASSIFICATION_JSON_SCHEMA,
  COMPLETENESS_JSON_SCHEMA,
  FIELDS_JSON_SCHEMA,
  OBLIGATIONS_JSON_SCHEMA,
  PROFILE_JSON_SCHEMA,
  SENSITIVE_FIELD_TYPES,
  VERSION_COMPARISON_JSON_SCHEMA,
  documentClassificationSchema,
  documentCompletenessSchema,
  documentFieldsSchema,
  documentObligationsSchema,
  documentProfileSchema,
  documentVersionComparisonSchema,
  isPossibleIsoDate,
  validateEvidenceReferences,
  type DocumentClassification,
  type DocumentCompleteness,
  type DocumentFields,
  type DocumentObligations,
  type DocumentVersionComparison,
} from './documentIntelligenceSchemas';
import { createServiceClient } from '@/lib/supabase/server';
import { isDocumentIntelligenceEnabled } from './documentIntelligenceFeature';
import {
  CONTRACTUAL_ANALYSIS_JSON_SCHEMA,
  contractualAnalysisSchema,
  type ContractualAnalysis,
} from './contractIntelligenceSchemas';
import { isPhaseEFeatureEnabled, PHASE_E_FEATURES } from '@/lib/phase-e/feature-flags';

export const DOCUMENT_INTELLIGENCE_ANALYSIS_TYPES = [
  'profile',
  'classification',
  'fields',
  'obligations',
  'completeness',
  'metadata_suggestions',
  'contractual',
] as const;

export type DocumentIntelligenceAnalysisType =
  (typeof DOCUMENT_INTELLIGENCE_ANALYSIS_TYPES)[number];

type IntelligenceContext = {
  authorization: LuciaAuthorizationContext;
  service?: SupabaseClient;
  documentVersionId?: string | null;
};

type SourceChunk = {
  id: string;
  document_id: string;
  document_version_id: string | null;
  content: string;
  page_number: number | null;
  chunk_index: number;
  document_hash: string | null;
};

type DocumentSource = {
  document: {
    id: string;
    nombre: string | null;
    workspace_id: string;
    estado: string | null;
    file_hash_sha256: string | null;
    updated_at: string | null;
  };
  version: {
    id: string;
    version_number: number;
    sha256: string;
    page_count: number | null;
    created_at: string;
  } | null;
  chunks: SourceChunk[];
};

type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export class DocumentIntelligenceError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'DOCUMENT_NOT_FOUND'
      | 'DOCUMENT_NOT_INDEXED'
      | 'VERSION_NOT_FOUND'
      | 'SCHEMA_UNAVAILABLE'
      | 'DOCUMENT_INTELLIGENCE_DISABLED'
      | 'DOCUMENT_NOT_COMPLETED'
      | 'INSUFFICIENT_EVIDENCE'
      | 'INVALID_MODEL_OUTPUT'
      | 'AI_PROVIDER_ERROR',
    public readonly status: number,
    message: string = code
  ) {
    super(message);
  }
}

function serviceFor(context: IntelligenceContext) {
  return context.service || createServiceClient();
}

function assertContext(
  documentId: string,
  workspaceId: string,
  userId: string,
  context?: IntelligenceContext
) {
  if (!isDocumentIntelligenceEnabled()) {
    throw new DocumentIntelligenceError('DOCUMENT_INTELLIGENCE_DISABLED', 503);
  }
  if (
    !context ||
    context.authorization.user_id !== userId ||
    context.authorization.workspace_id !== workspaceId ||
    context.authorization.is_public_token_flow ||
    !assertAuthorizedDocument(context.authorization, documentId)
  ) {
    throw new DocumentIntelligenceError('FORBIDDEN', 403);
  }
  return context;
}

function schemaError(error: unknown) {
  const code = String((error as { code?: unknown })?.code || '');
  const message = String((error as { message?: unknown })?.message || '');
  return code === '42P01' || code === 'PGRST205' || /does not exist|schema cache/i.test(message);
}

async function loadDocumentSource(
  documentId: string,
  workspaceId: string,
  context: IntelligenceContext,
  options: { exactVersion?: boolean; allowUnindexed?: boolean } = {}
): Promise<DocumentSource> {
  const service = serviceFor(context);
  const { data: document, error: documentError } = await service
    .from('documentos')
    .select('id,nombre,workspace_id,estado,file_hash_sha256,updated_at')
    .eq('id', documentId)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (documentError) throw documentError;
  if (!document) throw new DocumentIntelligenceError('DOCUMENT_NOT_FOUND', 404);

  let versionQuery = service
    .from('document_versions')
    .select('id,version_number,sha256,page_count,created_at')
    .eq('document_id', documentId)
    .eq('workspace_id', workspaceId);
  if (context.documentVersionId) versionQuery = versionQuery.eq('id', context.documentVersionId);
  const { data: versions, error: versionError } = await versionQuery
    .order('version_number', { ascending: false })
    .limit(1);
  if (versionError && !schemaError(versionError)) throw versionError;
  const version = versions?.[0] || null;
  let resolvedVersion = version;
  if (context.documentVersionId && !version) {
    throw new DocumentIntelligenceError('VERSION_NOT_FOUND', 404);
  }

  let chunksQuery = service
    .from('ai_document_chunks')
    .select('id,document_id,document_version_id,content,page_number,chunk_index,document_hash')
    .eq('workspace_id', workspaceId)
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true })
    .limit(24);
  if (context.documentVersionId || version) {
    chunksQuery = chunksQuery.eq('document_version_id', context.documentVersionId || version!.id);
  }
  let { data: chunks, error: chunksError } = await chunksQuery;
  if (schemaError(chunksError)) {
    throw new DocumentIntelligenceError('SCHEMA_UNAVAILABLE', 503);
  }
  if (chunksError) throw chunksError;

  // Legacy chunks remain readable until each document is reindexed by version.
  if (!chunks?.length && version && !context.documentVersionId && !options.exactVersion) {
    const legacy = await service
      .from('ai_document_chunks')
      .select('id,document_id,content,page_number,chunk_index,metadata')
      .eq('workspace_id', workspaceId)
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true })
      .limit(24);
    if (legacy.error) throw legacy.error;
    chunks = (legacy.data || []).map((chunk) => ({
      ...chunk,
      document_version_id: null,
      document_hash: null,
    }));
    resolvedVersion = null;
  }

  if (!chunks?.length && !options.allowUnindexed) {
    throw new DocumentIntelligenceError('DOCUMENT_NOT_INDEXED', 409);
  }
  return { document, version: resolvedVersion, chunks: chunks as SourceChunk[] };
}

function sourceMaterial(source: DocumentSource) {
  return source.chunks.map((chunk) => ({
    chunk_id: chunk.id,
    page_number: chunk.page_number,
    chunk_index: chunk.chunk_index,
    content: redactSensitiveText(chunk.content, 2_000),
  }));
}

async function strictJson<T>(input: {
  name: string;
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
  instruction: string;
  material: unknown;
}): Promise<{ data: T; usage: ModelUsage }> {
  let response: Awaited<ReturnType<typeof completion>>;
  try {
    response = await completion({
      model: LUCIA_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Eres LucIA Document Intelligence. Analiza solo las fuentes recibidas. No emitas dictamen legal o fiscal definitivo. No inventes datos. Toda afirmacion debe citar un chunk_id entregado. Devuelve exclusivamente JSON valido.',
        },
        {
          role: 'user',
          content: `${input.instruction}\n\nFUENTES AUTORIZADAS:\n${JSON.stringify(input.material)}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: input.name, schema: input.schema, strict: true },
      },
      temperature: 0,
      max_tokens: 3_000,
      stream: false,
      api_key: process.env.OPENAI_API_KEY!,
    });
  } catch {
    throw new DocumentIntelligenceError('AI_PROVIDER_ERROR', 502);
  }
  const raw = (response as any)?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new DocumentIntelligenceError('INVALID_MODEL_OUTPUT', 502);
  try {
    const parsed = JSON.parse(raw);
    return {
      data: input.validator.parse(parsed),
      usage: {
        inputTokens: (response as any)?.usage?.prompt_tokens || null,
        outputTokens: (response as any)?.usage?.completion_tokens || null,
      },
    };
  } catch {
    throw new DocumentIntelligenceError('INVALID_MODEL_OUTPUT', 502);
  }
}

function evidenceIds(source: DocumentSource) {
  return new Set(source.chunks.map((chunk) => chunk.id));
}

function profileKey(source: DocumentSource) {
  return source.version?.id || null;
}

async function createJob(
  service: SupabaseClient,
  source: DocumentSource,
  workspaceId: string,
  userId: string,
  jobType: string,
  options: {
    runKey?: string | null;
    configurationHash?: string | null;
    requestedEventId?: string | null;
  } = {}
) {
  const { data, error } = await service
    .from('ai_document_processing_jobs')
    .insert({
      workspace_id: workspaceId,
      document_id: source.document.id,
      document_version_id: profileKey(source),
      job_type: jobType,
      run_key: options.runKey || null,
      configuration_hash: options.configurationHash || null,
      requested_by_event_id: options.requestedEventId || null,
      provider_metadata: { model: LUCIA_MODEL, schema_version: 1 },
      status: 'processing',
      started_at: new Date().toISOString(),
      created_by: userId,
    })
    .select('id')
    .single();
  if (schemaError(error)) throw new DocumentIntelligenceError('SCHEMA_UNAVAILABLE', 503);
  if (error) throw error;
  return data.id as string;
}

async function finishJob(
  service: SupabaseClient,
  jobId: string,
  status: 'completed' | 'failed',
  errorCode?: string
) {
  await service
    .from('ai_document_processing_jobs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      error_code: errorCode || null,
      error_message: errorCode ? 'El procesamiento no pudo completarse.' : null,
    })
    .eq('id', jobId);
}

async function replaceRows(
  service: SupabaseClient,
  table: string,
  source: DocumentSource,
  rows: Record<string, unknown>[]
) {
  let deletion = service.from(table).delete().eq('document_id', source.document.id);
  deletion = source.version
    ? deletion.eq('document_version_id', source.version.id)
    : deletion.is('document_version_id', null);
  const deleted = await deletion;
  if (schemaError(deleted.error)) throw new DocumentIntelligenceError('SCHEMA_UNAVAILABLE', 503);
  if (deleted.error) throw deleted.error;
  if (!rows.length) return;
  const { error } = await service.from(table).insert(rows);
  if (error) throw error;
}

async function runJob<T>(input: {
  source: DocumentSource;
  workspaceId: string;
  userId: string;
  context: IntelligenceContext;
  jobType: string;
  intent: string;
  execute: () => Promise<{
    data: T;
    usage: ModelUsage;
    count?: number;
    confidence?: number | null;
  }>;
}) {
  const service = serviceFor(input.context);
  const startedAt = Date.now();
  const jobId = await createJob(
    service,
    input.source,
    input.workspaceId,
    input.userId,
    input.jobType
  );
  try {
    const result = await input.execute();
    await finishJob(service, jobId, 'completed');
    await saveQueryLog({
      workspaceId: input.workspaceId,
      userId: input.userId,
      question: `[document intelligence: ${input.intent}]`,
      intent: input.intent,
      scope: 'document_intelligence',
      route: '/api/ai/document-intelligence/analyze',
      documentIds: [input.source.document.id],
      chunkIds: input.source.chunks.map((chunk) => chunk.id),
      sourceIds: input.source.chunks.map((chunk) => chunk.id),
      contextUsed: {
        analysis_type: input.intent,
        document_version_id: profileKey(input.source),
        moduleKey: 'document_viewer',
        model: LUCIA_MODEL,
        chunks_used: input.source.chunks.length,
        records_produced: result.count || 0,
        fields_extracted_count:
          input.intent === 'document_extracted_fields' ? result.count || 0 : null,
        obligations_detected_count:
          input.intent === 'document_obligations' ? result.count || 0 : null,
        confidence: result.confidence ?? null,
        status: 'completed',
        evidence_status: 'verified',
      },
      responseText: '[structured document intelligence omitted]',
      inputTokens: result.usage.inputTokens || undefined,
      outputTokens: result.usage.outputTokens || undefined,
      durationMs: Date.now() - startedAt,
      hasEvidence: true,
    });
    return result.data;
  } catch (error) {
    const code = error instanceof DocumentIntelligenceError ? error.code : 'PROCESSING_FAILED';
    await finishJob(service, jobId, 'failed', code);
    await saveQueryLog({
      workspaceId: input.workspaceId,
      userId: input.userId,
      question: `[document intelligence: ${input.intent}]`,
      intent: input.intent,
      scope: 'document_intelligence',
      route: '/api/ai/document-intelligence/analyze',
      documentIds: [input.source.document.id],
      chunkIds: input.source.chunks.map((chunk) => chunk.id),
      sourceIds: input.source.chunks.map((chunk) => chunk.id),
      contextUsed: {
        analysis_type: input.intent,
        document_version_id: profileKey(input.source),
        moduleKey: 'document_viewer',
        model: LUCIA_MODEL,
        chunks_used: input.source.chunks.length,
        status: 'failed',
        error_code: code,
        evidence_status: 'error',
      },
      responseText: '[document intelligence failed; no document content logged]',
      durationMs: Date.now() - startedAt,
      errorCode: code,
      hasEvidence: false,
    });
    throw error;
  }
}

function commonRow(source: DocumentSource, workspaceId: string) {
  return {
    workspace_id: workspaceId,
    document_id: source.document.id,
    document_version_id: profileKey(source),
  };
}

export async function classifyDocument(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
): Promise<DocumentClassification> {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const source = await loadDocumentSource(documentId, workspaceId, context);
  return runJob({
    source,
    workspaceId,
    userId,
    context,
    jobType: 'classify_document',
    intent: 'document_classification',
    execute: async () => {
      const generated = await strictJson({
        name: 'document_classification',
        schema: CLASSIFICATION_JSON_SCHEMA,
        validator: documentClassificationSchema,
        instruction:
          'Clasifica el documento con la taxonomia proporcionada por el esquema. Las sugerencias no modifican el documento.',
        material: sourceMaterial(source),
      });
      const data = validateEvidenceReferences(
        generated.data,
        evidenceIds(source),
        (value) => value.evidence
      );
      const rows = [
        ['document_type', data.detected_document_type],
        ['category', data.detected_document_category],
        ['folder_suggestion', data.suggested_folder],
        ['sensitivity', data.sensitivity],
        ['retention_category', data.retention_category],
        ...data.suggested_tags.map((tag) => ['tag_suggestion', tag]),
      ].map(([classification_type, classification_value]) => ({
        ...commonRow(source, workspaceId),
        classification_type,
        classification_value,
        confidence: data.confidence,
        reason: data.reason,
        evidence: data.evidence,
      }));
      await replaceRows(serviceFor(context), 'ai_document_classifications', source, rows);
      return { data, usage: generated.usage, count: rows.length, confidence: data.confidence };
    },
  });
}

export async function extractStructuredFields(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
): Promise<DocumentFields> {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const source = await loadDocumentSource(documentId, workspaceId, context);
  return runJob({
    source,
    workspaceId,
    userId,
    context,
    jobType: 'extract_fields',
    intent: 'document_extracted_fields',
    execute: async () => {
      const generated = await strictJson({
        name: 'document_fields',
        schema: FIELDS_JSON_SCHEMA,
        validator: documentFieldsSchema,
        instruction:
          'Extrae solo datos verificables. No extraigas RFC, CURP, email, telefono ni domicilio en este flujo general. Normaliza fechas como YYYY-MM-DD y montos como numero decimal mas moneda.',
        material: sourceMaterial(source),
      });
      const fields = generated.data.fields.filter((field) => {
        if (SENSITIVE_FIELD_TYPES.has(field.value_type)) return false;
        if (field.value_type === 'date' && !isPossibleIsoDate(field.normalized_value)) return false;
        return evidenceIds(source).has(field.chunk_id);
      });
      if (generated.data.fields.length > 0 && fields.length === 0) {
        throw new DocumentIntelligenceError('INSUFFICIENT_EVIDENCE', 422);
      }
      await replaceRows(
        serviceFor(context),
        'ai_document_extracted_fields',
        source,
        fields.map((field) => ({
          ...commonRow(source, workspaceId),
          ...field,
          extraction_method: 'llm_json_schema',
          status: 'extracted',
        }))
      );
      const entityTypes = new Set(['person', 'company', 'money', 'date']);
      const entities = fields
        .filter((field) => entityTypes.has(field.value_type))
        .map((field) => ({
          ...commonRow(source, workspaceId),
          entity_type: field.value_type,
          entity_value: field.field_value,
          normalized_value: field.normalized_value,
          confidence: field.confidence,
          page_number: field.page_number,
          chunk_id: field.chunk_id,
        }));
      await replaceRows(serviceFor(context), 'ai_document_entities', source, entities);
      return { data: { fields }, usage: generated.usage, count: fields.length };
    },
  });
}

export async function detectDocumentObligations(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
): Promise<DocumentObligations> {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const source = await loadDocumentSource(documentId, workspaceId, context);
  return runJob({
    source,
    workspaceId,
    userId,
    context,
    jobType: 'detect_obligations',
    intent: 'document_obligations',
    execute: async () => {
      const generated = await strictJson({
        name: 'document_obligations',
        schema: OBLIGATIONS_JSON_SCHEMA,
        validator: documentObligationsSchema,
        instruction:
          'Detecta compromisos expresos. suggested_task es solo propuesta informativa y nunca una accion. Usa due_date null cuando no exista una fecha cierta.',
        material: sourceMaterial(source),
      });
      const obligations = generated.data.obligations.filter(
        (item) =>
          evidenceIds(source).has(item.chunk_id) &&
          (!item.due_date || isPossibleIsoDate(item.due_date))
      );
      await replaceRows(
        serviceFor(context),
        'ai_document_obligations',
        source,
        obligations.map((item) => ({
          ...commonRow(source, workspaceId),
          ...item,
          status: 'detected',
        }))
      );
      return { data: { obligations }, usage: generated.usage, count: obligations.length };
    },
  });
}

const CONTRACTUAL_SCHEMA_VERSION = 'docubox-contractual-v1';

export async function analyzeContractualDocument(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext,
  options: { requestedEventId?: string | null } = {}
): Promise<ContractualAnalysis & { analysis_run_id: string; reused: boolean }> {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const service = serviceFor(context);
  if (!(await isPhaseEFeatureEnabled(service, PHASE_E_FEATURES.contractualIntelligence))) {
    throw new DocumentIntelligenceError('DOCUMENT_INTELLIGENCE_DISABLED', 503);
  }
  const source = await loadDocumentSource(documentId, workspaceId, context);
  if (!['completado', 'completed'].includes(String(source.document.estado || '').toLowerCase())) {
    throw new DocumentIntelligenceError(
      'DOCUMENT_NOT_COMPLETED',
      409,
      'CONTRACTUAL_ANALYSIS_REQUIRES_COMPLETED_DOCUMENT'
    );
  }
  const configurationHash = createHash('sha256').update(CONTRACTUAL_SCHEMA_VERSION).digest('hex');
  const runKey = `contractual:${documentId}:${profileKey(source) || 'legacy'}:${configurationHash}`;
  const existing = await service
    .from('ai_document_processing_jobs')
    .select('id,status,provider_metadata')
    .eq('workspace_id', workspaceId)
    .eq('run_key', runKey)
    .maybeSingle();
  if (existing.error && !schemaError(existing.error)) throw existing.error;
  if (existing.data?.status === 'completed') {
    const [fields, obligations] = await Promise.all([
      service
        .from('ai_document_extracted_fields')
        .select('*')
        .eq('analysis_run_id', existing.data.id)
        .order('created_at'),
      service
        .from('ai_document_obligations')
        .select('*')
        .eq('analysis_run_id', existing.data.id)
        .order('created_at'),
    ]);
    if (fields.error || obligations.error) throw fields.error || obligations.error;
    const facts = (fields.data || [])
      .filter((row) => !String(row.field_key).startsWith('contract_risk_'))
      .map((row) => ({
        category: String(row.field_key).split('_')[1] || 'clause',
        field_key: String(row.field_key).replace(/^contract_/, ''),
        field_label: row.field_label,
        field_value: row.field_value,
        normalized_value: row.normalized_value,
        value_type: row.value_type,
        source_kind:
          row.extraction_method === 'llm_contractual_inference' ? 'inference' : 'explicit',
        confidence: Number(row.confidence),
        chunk_id: row.chunk_id,
        page_number: row.page_number,
        evidence_text: row.evidence_text,
      }));
    const risks = (fields.data || [])
      .filter((row) => String(row.field_key).startsWith('contract_risk_'))
      .map((row) => ({
        risk_key: String(row.field_key).replace(/^contract_risk_/, ''),
        title: row.field_label,
        description: row.field_value,
        severity: row.normalized_value,
        source_kind:
          row.extraction_method === 'llm_contractual_inference' ? 'inference' : 'explicit',
        confidence: Number(row.confidence),
        chunk_id: row.chunk_id,
        page_number: row.page_number,
        evidence_text: row.evidence_text,
      }));
    const metadata = existing.data.provider_metadata as Record<string, unknown> | null;
    const restored = contractualAnalysisSchema.parse({
      applicability: metadata?.applicability || {
        is_contract: true,
        confidence: 1,
        reason: 'Analisis contractual persistido.',
        evidence: [],
      },
      facts,
      obligations: (obligations.data || []).map((row) => ({
        obligation_type: row.obligation_type,
        obligated_party: row.obligated_party || '',
        beneficiary_party: row.beneficiary_party || '',
        description: row.description,
        due_date: row.due_date,
        recurrence_rule: row.recurrence_rule,
        priority: row.priority,
        confidence: Number(row.confidence),
        chunk_id: row.chunk_id,
        page_number: row.page_number,
        evidence_text: row.evidence_text,
        suggested_task: row.suggested_task,
      })),
      risks,
      not_found: Array.isArray(metadata?.not_found) ? metadata.not_found : [],
    });
    return { ...restored, analysis_run_id: existing.data.id, reused: true };
  }
  if (existing.data?.status === 'processing') {
    throw new DocumentIntelligenceError(
      'AI_PROVIDER_ERROR',
      409,
      'CONTRACTUAL_ANALYSIS_IN_PROGRESS'
    );
  }

  const jobId = await createJob(service, source, workspaceId, userId, 'contractual_analysis', {
    runKey,
    configurationHash,
    requestedEventId: options.requestedEventId,
  });
  try {
    const generated = await strictJson({
      name: 'contractual_analysis',
      schema: CONTRACTUAL_ANALYSIS_JSON_SCHEMA,
      validator: contractualAnalysisSchema,
      instruction:
        'Determina primero si el documento es contractual. Extrae solo hechos, obligaciones y riesgos respaldados por una fuente. Distingue explicit de inference. No emitas consejo legal, no inventes datos y enumera en not_found los datos contractuales importantes ausentes.',
      material: sourceMaterial(source),
    });
    const ids = evidenceIds(source);
    const data: ContractualAnalysis = {
      ...generated.data,
      facts: generated.data.facts.filter((item) => ids.has(item.chunk_id)),
      obligations: generated.data.obligations.filter((item) => ids.has(item.chunk_id)),
      risks: generated.data.risks.filter((item) => ids.has(item.chunk_id)),
    };
    const factRows = data.facts.map((fact) => ({
      ...commonRow(source, workspaceId),
      field_key: `contract_${fact.category}_${fact.field_key}`.slice(0, 120),
      field_label: fact.field_label,
      field_value: fact.field_value,
      normalized_value: fact.normalized_value,
      value_type: fact.value_type,
      confidence: fact.confidence,
      page_number: fact.page_number,
      chunk_id: fact.chunk_id,
      evidence_text: fact.evidence_text,
      extraction_method:
        fact.source_kind === 'inference' ? 'llm_contractual_inference' : 'llm_contractual_explicit',
      status: 'extracted',
      analysis_run_id: jobId,
    }));
    const riskRows = data.risks.map((risk, index) => ({
      ...commonRow(source, workspaceId),
      field_key: `contract_risk_${risk.risk_key}_${index + 1}`.slice(0, 120),
      field_label: risk.title,
      field_value: risk.description,
      normalized_value: risk.severity,
      value_type: 'text',
      confidence: risk.confidence,
      page_number: risk.page_number,
      chunk_id: risk.chunk_id,
      evidence_text: risk.evidence_text,
      extraction_method:
        risk.source_kind === 'inference' ? 'llm_contractual_inference' : 'llm_contractual_explicit',
      status: 'extracted',
      analysis_run_id: jobId,
    }));
    if (factRows.length || riskRows.length) {
      const inserted = await service
        .from('ai_document_extracted_fields')
        .insert([...factRows, ...riskRows]);
      if (inserted.error) throw inserted.error;
    }
    if (data.obligations.length) {
      const inserted = await service.from('ai_document_obligations').insert(
        data.obligations.map((item) => ({
          ...commonRow(source, workspaceId),
          ...item,
          status: 'detected',
          analysis_run_id: jobId,
        }))
      );
      if (inserted.error) throw inserted.error;
    }
    await service
      .from('ai_document_processing_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        provider_metadata: {
          model: LUCIA_MODEL,
          schema_version: CONTRACTUAL_SCHEMA_VERSION,
          applicability: data.applicability,
          not_found: data.not_found,
          input_tokens: generated.usage.inputTokens,
          output_tokens: generated.usage.outputTokens,
        },
      })
      .eq('id', jobId);
    return { ...data, analysis_run_id: jobId, reused: false };
  } catch (error) {
    await finishJob(
      service,
      jobId,
      'failed',
      error instanceof DocumentIntelligenceError ? error.code : 'PROCESSING_FAILED'
    );
    throw error;
  }
}

export async function checkDocumentCompleteness(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
): Promise<DocumentCompleteness> {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const source = await loadDocumentSource(documentId, workspaceId, context);
  return runJob({
    source,
    workspaceId,
    userId,
    context,
    jobType: 'completeness_check',
    intent: 'document_completeness',
    execute: async () => {
      const generated = await strictJson({
        name: 'document_completeness',
        schema: COMPLETENESS_JSON_SCHEMA,
        validator: documentCompletenessSchema,
        instruction:
          'Evalua completitud documental de forma orientativa. No concluyas validez legal o fiscal. Los checks not_applicable pueden omitir evidencia; los demas deben citar fuentes.',
        material: sourceMaterial(source),
      });
      const ids = evidenceIds(source);
      const checks = generated.data.checks.filter(
        (check) =>
          check.status === 'not_applicable' ||
          (check.evidence.length > 0 && check.evidence.every((item) => ids.has(item.chunk_id)))
      );
      await replaceRows(
        serviceFor(context),
        'ai_document_completeness_checks',
        source,
        checks.map((check) => ({ ...commonRow(source, workspaceId), ...check }))
      );
      return { data: { checks }, usage: generated.usage, count: checks.length };
    },
  });
}

function calculateScores(input: {
  source: DocumentSource;
  classification?: DocumentClassification | null;
  fields?: DocumentFields | null;
  obligations?: DocumentObligations | null;
  completeness?: DocumentCompleteness | null;
}) {
  const checks = input.completeness?.checks || [];
  const applicable = checks.filter((check) => check.status !== 'not_applicable');
  const passed = applicable.filter((check) => check.status === 'passed').length;
  const failed = applicable.filter((check) => check.status === 'failed').length;
  const highRisk = applicable.filter(
    (check) => ['high', 'critical'].includes(check.severity) && check.status !== 'passed'
  ).length;
  const completeness = applicable.length ? Math.round((passed / applicable.length) * 100) : 50;
  const qualitySignals = [
    input.source.chunks.length > 0,
    input.source.chunks.some((chunk) => chunk.page_number !== null),
    Boolean(input.classification),
    Boolean(input.fields?.fields.length),
    Boolean(input.source.version?.sha256 || input.source.document.file_hash_sha256),
    failed === 0,
  ];
  return {
    quality_score: Math.round(
      (qualitySignals.filter(Boolean).length / qualitySignals.length) * 100
    ),
    completeness_score: completeness,
    risk_score: Math.min(
      100,
      highRisk * 25 +
        failed * 10 +
        (input.obligations?.obligations.some((item) => item.priority === 'critical') ? 20 : 0)
    ),
  };
}

async function readExistingAnalysis(service: SupabaseClient, source: DocumentSource) {
  const db = service as any;
  const filter = (query: any) =>
    source.version
      ? query.eq('document_version_id', source.version.id)
      : query.is('document_version_id', null);
  const [classificationResult, fieldsResult, obligationsResult, checksResult] = await Promise.all([
    filter(
      db.from('ai_document_classifications').select('*').eq('document_id', source.document.id)
    ),
    filter(
      db.from('ai_document_extracted_fields').select('*').eq('document_id', source.document.id)
    ),
    filter(db.from('ai_document_obligations').select('*').eq('document_id', source.document.id)),
    filter(
      db.from('ai_document_completeness_checks').select('*').eq('document_id', source.document.id)
    ),
  ]);
  for (const result of [classificationResult, fieldsResult, obligationsResult, checksResult]) {
    if (schemaError(result.error)) throw new DocumentIntelligenceError('SCHEMA_UNAVAILABLE', 503);
    if (result.error) throw result.error;
  }
  const classifications = classificationResult.data || [];
  const classification = classifications.length
    ? ({
        detected_document_type: classifications.find(
          (row: any) => row.classification_type === 'document_type'
        )?.classification_value,
        detected_document_category: classifications.find(
          (row: any) => row.classification_type === 'category'
        )?.classification_value,
        language: 'es',
        confidence: classifications[0]?.confidence,
        reason: classifications[0]?.reason,
        suggested_tags: classifications
          .filter((row: any) => row.classification_type === 'tag_suggestion')
          .map((row: any) => row.classification_value),
        suggested_folder: classifications.find(
          (row: any) => row.classification_type === 'folder_suggestion'
        )?.classification_value,
        sensitivity: classifications.find((row: any) => row.classification_type === 'sensitivity')
          ?.classification_value,
        retention_category: classifications.find(
          (row: any) => row.classification_type === 'retention_category'
        )?.classification_value,
        evidence: classifications[0]?.evidence || [],
      } as DocumentClassification)
    : null;
  return {
    classification,
    fields: { fields: fieldsResult.data || [] } as DocumentFields,
    obligations: { obligations: obligationsResult.data || [] } as DocumentObligations,
    completeness: { checks: checksResult.data || [] } as DocumentCompleteness,
  };
}

export async function buildDocumentIntelligenceProfile(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
) {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const source = await loadDocumentSource(documentId, workspaceId, context);
  return runJob({
    source,
    workspaceId,
    userId,
    context,
    jobType: 'build_profile',
    intent: 'document_intelligence_profile',
    execute: async () => {
      const service = serviceFor(context);
      const existing = await readExistingAnalysis(service, source);
      const generated = await strictJson({
        name: 'document_profile',
        schema: PROFILE_JSON_SCHEMA,
        validator: documentProfileSchema,
        instruction:
          'Genera una ficha y resumen orientativos. No incluyas PII ni afirmaciones sin respaldo en las fuentes.',
        material: sourceMaterial(source),
      });
      const scores = calculateScores({ source, ...existing });
      const documentHash = source.version?.sha256 || source.document.file_hash_sha256 || null;
      const row = {
        ...commonRow(source, workspaceId),
        document_hash: documentHash,
        detected_document_type: existing.classification?.detected_document_type || null,
        detected_document_category: existing.classification?.detected_document_category || null,
        title_suggestion: generated.data.title_suggestion,
        short_summary: generated.data.short_summary,
        executive_summary: generated.data.executive_summary,
        language: existing.classification?.language || null,
        confidence: existing.classification?.confidence || null,
        ...scores,
        status: 'ready',
        extraction_status: 'ready',
        source_chunk_ids: source.chunks.map((chunk) => chunk.id),
        evidence: source.chunks.map((chunk) => ({
          chunk_id: chunk.id,
          page_number: chunk.page_number,
        })),
        warnings: [
          ...generated.data.warnings,
          'Los scores son orientativos y no constituyen dictamen legal o fiscal.',
        ],
        created_by: userId,
      };
      let lookup = service.from('ai_document_profiles').select('id').eq('document_id', documentId);
      lookup = source.version
        ? lookup.eq('document_version_id', source.version.id)
        : lookup.is('document_version_id', null);
      const current = await lookup.maybeSingle();
      if (schemaError(current.error))
        throw new DocumentIntelligenceError('SCHEMA_UNAVAILABLE', 503);
      if (current.error) throw current.error;
      const persisted = current.data
        ? await service.from('ai_document_profiles').update(row).eq('id', current.data.id)
        : await service.from('ai_document_profiles').insert(row);
      if (persisted.error) throw persisted.error;
      return {
        data: { ...row, profile: generated.data },
        usage: generated.usage,
        count: 1,
        confidence: row.confidence,
      };
    },
  });
}

export async function suggestDocumentMetadata(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
) {
  const classification = await classifyDocument(documentId, workspaceId, userId, unsafeContext);
  return {
    title: null,
    document_type: classification.detected_document_type,
    category: classification.detected_document_category,
    folder: classification.suggested_folder,
    tags: classification.suggested_tags,
    sensitivity: classification.sensitivity,
    retention_category: classification.retention_category,
    applied: false,
  };
}

export async function getDocumentIntelligenceSummary(
  documentId: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
) {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const service = serviceFor(context);
  const db = service as any;
  const source = await loadDocumentSource(documentId, workspaceId, context, {
    allowUnindexed: true,
  });
  const versionId = profileKey(source);
  const scoped = (table: string, select = '*') => {
    let query = db
      .from(table)
      .select(select)
      .eq('workspace_id', workspaceId)
      .eq('document_id', documentId);
    query = versionId
      ? query.eq('document_version_id', versionId)
      : query.is('document_version_id', null);
    return query;
  };
  const contractualEnabled = await isPhaseEFeatureEnabled(
    service,
    PHASE_E_FEATURES.contractualIntelligence
  );
  const reviewsQuery = contractualEnabled
    ? scoped('ai_document_fact_reviews').order('reviewed_at', { ascending: false }).limit(200)
    : Promise.resolve({ data: [], error: null });
  const [profile, fields, entities, obligations, classifications, completeness, jobs, reviews] =
    await Promise.all([
      scoped('ai_document_profiles').maybeSingle(),
      scoped('ai_document_extracted_fields'),
      scoped('ai_document_entities'),
      scoped('ai_document_obligations'),
      scoped('ai_document_classifications'),
      scoped('ai_document_completeness_checks'),
      scoped('ai_document_processing_jobs', 'id,job_type,status,error_code,created_at,completed_at')
        .order('created_at', { ascending: false })
        .limit(20),
      reviewsQuery,
    ]);
  for (const result of [
    profile,
    fields,
    entities,
    obligations,
    classifications,
    completeness,
    jobs,
    reviews,
  ]) {
    if (schemaError(result.error)) throw new DocumentIntelligenceError('SCHEMA_UNAVAILABLE', 503);
    if (result.error) throw result.error;
  }
  const stale = Boolean(
    profile.data &&
    (profile.data.document_hash !== (source.version?.sha256 || source.document.file_hash_sha256) ||
      new Date(profile.data.updated_at).getTime() <
        new Date(source.document.updated_at || 0).getTime())
  );
  const latestContractualRun =
    (jobs.data || []).find(
      (job: any) => job.job_type === 'contractual_analysis' && job.status === 'completed'
    ) || null;
  return {
    document_id: documentId,
    document_version_id: versionId,
    features: {
      contractual: contractualEnabled,
    },
    status: profile.data ? (stale ? 'stale' : profile.data.status) : 'not_analyzed',
    profile: profile.data,
    fields: (fields.data || []).filter(
      (field: any) => !SENSITIVE_FIELD_TYPES.has(field.value_type)
    ),
    entities: (entities.data || []).filter(
      (entity: any) => !SENSITIVE_FIELD_TYPES.has(entity.entity_type)
    ),
    obligations: obligations.data || [],
    classifications: classifications.data || [],
    completeness_checks: completeness.data || [],
    jobs: jobs.data || [],
    reviews: reviews.data || [],
    contractual: {
      fields: (fields.data || []).filter(
        (field: any) =>
          String(field.field_key).startsWith('contract_') &&
          field.analysis_run_id === latestContractualRun?.id
      ),
      obligations: (obligations.data || []).filter(
        (item: any) => item.analysis_run_id === latestContractualRun?.id
      ),
      latest_run: latestContractualRun,
    },
    evidence_sources: source.chunks.map((chunk) => ({
      claim: 'Fuente documental disponible',
      source_type: 'document_chunk',
      document_id: documentId,
      document_version_id: versionId,
      chunk_id: chunk.id,
      page_number: chunk.page_number,
      confidence: null,
    })),
  };
}

export async function compareDocumentVersions(
  documentId: string,
  versionA: string,
  versionB: string,
  workspaceId: string,
  userId: string,
  unsafeContext?: IntelligenceContext
): Promise<DocumentVersionComparison & { hashes_differ: boolean }> {
  const context = assertContext(documentId, workspaceId, userId, unsafeContext);
  const [sourceA, sourceB] = await Promise.all([
    loadDocumentSource(
      documentId,
      workspaceId,
      { ...context, documentVersionId: versionA },
      { exactVersion: true }
    ),
    loadDocumentSource(
      documentId,
      workspaceId,
      { ...context, documentVersionId: versionB },
      { exactVersion: true }
    ),
  ]);
  const combinedIds = new Set([...sourceA.chunks, ...sourceB.chunks].map((chunk) => chunk.id));
  return runJob({
    source: sourceB,
    workspaceId,
    userId,
    context,
    jobType: 'compare_versions',
    intent: 'document_version_comparison',
    execute: async () => {
      const generated = await strictJson({
        name: 'document_version_comparison',
        schema: VERSION_COMPARISON_JSON_SCHEMA,
        validator: documentVersionComparisonSchema,
        instruction:
          'Compara ambas versiones. No afirmes cambios que no tengan evidencia en A y B.',
        material: {
          version_a: { id: versionA, sources: sourceMaterial(sourceA) },
          version_b: { id: versionB, sources: sourceMaterial(sourceB) },
        },
      });
      const changes = generated.data.changes.filter(
        (change) =>
          change.version_a_evidence.length > 0 &&
          change.version_b_evidence.length > 0 &&
          [...change.version_a_evidence, ...change.version_b_evidence].every((item) =>
            combinedIds.has(item.chunk_id)
          )
      );
      if (generated.data.changes.length > 0 && changes.length === 0) {
        throw new DocumentIntelligenceError('INSUFFICIENT_EVIDENCE', 422);
      }
      return {
        data: {
          ...generated.data,
          changes,
          hashes_differ: sourceA.version?.sha256 !== sourceB.version?.sha256,
        },
        usage: generated.usage,
        count: changes.length,
      };
    },
  });
}

export function computeChunkContentHash(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
