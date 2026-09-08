import type { LuciaIntent } from './luciaIntentClassifier';
import { redactSensitiveText } from './security';

export const NO_EVIDENCE_RESPONSE =
  'No encontré información verificable en Docubox para responder eso.';
export const NO_DOCUMENT_CONTENT_RESPONSE =
  'No encontré contenido documental indexado y autorizado para responder eso.';

export const DOCUMENT_RAG_INTENTS = new Set<LuciaIntent>([
  'document_content_search',
  'document_summary',
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

export type DocumentEvidenceClaim = {
  claim: string;
  source_type:
    'document_chunk' | 'document_profile' | 'extracted_field' | 'obligation' | 'classification';
  document_id: string;
  document_version_id: string | null;
  chunk_id: string | null;
  page_number: number | null;
  confidence: number | null;
};

export type EvidenceSummary = {
  source_ids: string[];
  document_ids: string[];
  chunk_ids: string[];
  document_titles: string[];
  dates: string[];
  statuses: string[];
  signer_names: string[];
  quantities: number[];
  permitted_sensitive_values: string[];
  claims: DocumentEvidenceClaim[];
};

function rows(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (value && typeof value === 'object') return [value as Record<string, any>];
  return [];
}

function hasRowsDeep(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some(hasRowsDeep);
}

const SPECIALIZED_EVIDENCE_MODULES = new Set([
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

function hasAuthorizedSpecializedEvidence(value: unknown, moduleKey?: string) {
  if (!moduleKey || !SPECIALIZED_EVIDENCE_MODULES.has(moduleKey)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, any>;
  return Boolean(
    context.module === moduleKey &&
    context.workspace_id &&
    context.permission?.can_view === true &&
    !context.error_code &&
    Number(context.row_count) > 0 &&
    Array.isArray(context.evidence_sources) &&
    context.evidence_sources.some(
      (source: unknown) =>
        source &&
        typeof source === 'object' &&
        typeof (source as Record<string, unknown>).source === 'string' &&
        typeof (source as Record<string, unknown>).source_id === 'string'
    )
  );
}

function collect(value: unknown, keys: string[]) {
  const result: string[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== 'object') return;
    for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
      if (keys.includes(key) && (typeof nested === 'string' || typeof nested === 'number')) {
        result.push(String(nested));
      } else if (typeof nested === 'object') visit(nested);
    }
  };
  visit(value);
  return [...new Set(result.filter(Boolean))];
}

function intelligenceRows(structured: any, key: string) {
  return Array.isArray(structured?.[key]) ? structured[key] : [];
}

export function checkEvidenceForIntent(intent: LuciaIntent, finalContext: Record<string, any>) {
  const user = finalContext.user_context || {};
  const structured = finalContext.structured_context;
  const rag = rows(finalContext.rag_context);
  const structuredRows = rows(structured);
  const hasStructured = hasRowsDeep(structured);
  const specializedEvidence = hasAuthorizedSpecializedEvidence(
    structured,
    finalContext.route_context?.moduleKey
  );

  switch (intent) {
    case 'module_design_help':
      return Boolean(
        finalContext.route_context?.moduleStatus === 'in_development' &&
        structured?.module_status === 'in_development' &&
        ['schema_unavailable', 'partial', 'ready'].includes(structured?.data_availability) &&
        structured?.operational_data === false
      );
    case 'general_help':
    case 'signing_help':
      return true;
    case 'deterministic_verification_help':
      return finalContext.route_context?.luciaMode === 'deterministic_only';
    case 'public_token_help':
      return Boolean(
        finalContext.authorization?.is_public_token_flow &&
        finalContext.authorization?.token_grant_id &&
        structured?.token_grant?.grant_id
      );
    case 'user_profile':
      return Boolean(user.profile?.id);
    case 'user_profile_sensitive':
      if (!user.profile?.id || !user.profile?.requested_field) return false;
      if (user.profile.requested_field === 'domicilio') {
        return Boolean(user.profile.calle || user.profile.codigo_postal || user.profile.municipio);
      }
      return Boolean(user.profile[user.profile.requested_field]);
    case 'billing_usage':
      return specializedEvidence ?? Boolean(user.usage || hasStructured);
    case 'home_summary':
      return Boolean(user.usage || hasStructured);
    case 'reports_summary':
      return specializedEvidence ?? Boolean(user.usage || hasStructured);
    case 'tasks_summary':
    case 'participations_summary':
    case 'requests_summary':
    case 'notifications_summary':
    case 'contacts_search':
    case 'templates_help':
    case 'forms_help':
    case 'forms_responses_summary':
    case 'expediente_summary':
    case 'expediente_requirements':
    case 'certified_notification_status':
    case 'certification_status':
    case 'batch_signature_status':
    case 'credit_title_status':
    case 'organization_permissions':
    case 'collaboration_summary':
      return specializedEvidence ?? hasStructured;
    case 'integrations_help':
      return hasStructured;
    case 'signature_status':
    case 'document_search':
    case 'document_metadata':
    case 'document_versions':
    case 'document_review':
      return hasStructured;
    case 'document_summary':
    case 'document_content_search':
      return rag.length > 0;
    case 'document_intelligence_profile':
    case 'document_classification':
    case 'document_metadata_suggestions':
    case 'document_folder_suggestions':
    case 'document_tag_suggestions':
    case 'document_quality_score':
      return Boolean(
        structured?.profile || intelligenceRows(structured, 'classifications').length || rag.length
      );
    case 'document_extracted_fields':
      return intelligenceRows(structured, 'fields').some(
        (field: any) => field.chunk_id && field.evidence_text
      );
    case 'document_obligations':
      return intelligenceRows(structured, 'obligations').some(
        (obligation: any) => obligation.chunk_id && obligation.evidence_text
      );
    case 'document_completeness':
      return intelligenceRows(structured, 'completeness_checks').length > 0;
    case 'document_version_comparison':
      return Boolean(structured?.version_comparison?.changes?.length);
    case 'document_evidence_sources':
      return intelligenceRows(structured, 'evidence_sources').length > 0 || rag.length > 0;
    case 'configuration_security':
      return Boolean(user.workspace && structured?.security);
    default:
      return hasStructured || structuredRows.length > 0 || rag.length > 0;
  }
}

export function buildEvidenceSummary(finalContext: Record<string, any>): EvidenceSummary {
  const material = {
    user: finalContext.user_context,
    structured: finalContext.structured_context,
    rag: finalContext.rag_context,
  };
  const quantities = collect(material, [
    'count',
    'total',
    'documents_created_this_month',
    'documents_completed',
    'documents_pending',
  ])
    .map(Number)
    .filter(Number.isFinite);
  const collectArrayLengths = (value: unknown, result: number[] = []): number[] => {
    if (Array.isArray(value)) {
      result.push(value.length);
      value.forEach((item) => collectArrayLengths(item, result));
    } else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach((item) =>
        collectArrayLengths(item, result)
      );
    }
    return result;
  };

  const structuredSources = rows(finalContext.structured_context?.evidence_sources)
    .filter((source) => source.document_id && source.source_type)
    .map((source): DocumentEvidenceClaim => ({
      claim: String(source.claim || 'Fuente de inteligencia documental'),
      source_type: source.source_type,
      document_id: String(source.document_id),
      document_version_id: source.document_version_id ? String(source.document_version_id) : null,
      chunk_id: source.chunk_id ? String(source.chunk_id) : null,
      page_number: Number.isInteger(source.page_number) ? Number(source.page_number) : null,
      confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null,
    }));
  const ragSources = rows(finalContext.rag_context).map((source): DocumentEvidenceClaim => ({
    claim: 'Contenido documental autorizado',
    source_type: 'document_chunk',
    document_id: String(source.document_id),
    document_version_id: source.document_version_id ? String(source.document_version_id) : null,
    chunk_id: String(source.id || source.chunk_id),
    page_number: Number.isInteger(source.page_number) ? Number(source.page_number) : null,
    confidence: Number.isFinite(Number(source.similarity)) ? Number(source.similarity) : null,
  }));

  return {
    source_ids: collect(material, ['source_id', 'id']),
    document_ids: collect(material, ['document_id', 'documento_id']),
    chunk_ids: collect(finalContext.rag_context, ['chunk_id', 'id']),
    document_titles: collect(material, ['nombre', 'title', 'titulo', 'document_title']),
    dates: collect(material, ['created_at', 'updated_at', 'fecha_vencimiento', 'signed_at']),
    statuses: collect(material, ['estado', 'status']),
    signer_names: collect(material, ['participante_nombre', 'signer_name']),
    quantities: [...new Set([...quantities, ...collectArrayLengths(material)])],
    permitted_sensitive_values: [],
    claims: [...structuredSources, ...ragSources].filter(
      (claim) => claim.document_id && claim.chunk_id !== 'undefined'
    ),
  };
}

function unsupported(values: string[], allowed: string[]) {
  const normalized = new Set(allowed.map((value) => value.toLocaleLowerCase('es-MX')));
  return values.some((value) => !normalized.has(value.toLocaleLowerCase('es-MX')));
}

export function postValidateAnswerAgainstEvidence(answer: string, evidence: EvidenceSummary) {
  const curps =
    answer.match(
      /\b[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0\d|1[0-2])(?:[0-2]\d|3[01])[HM][A-Z]{5}[A-Z0-9]\d\b/gi
    ) || [];
  const rfcs = answer.match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/gi) || [];
  if (unsupported([...curps, ...rfcs], evidence.permitted_sensitive_values))
    return NO_EVIDENCE_RESPONSE;

  const claimedDates = answer.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const allowedDates = evidence.dates.flatMap((date) => [date, date.slice(0, 10)]);
  if (unsupported(claimedDates, allowedDates)) return NO_EVIDENCE_RESPONSE;

  const claimedQuantities = [
    ...answer.matchAll(
      /\b(\d+)\s+(?:documentos?|tareas?|firmantes?|participantes?|registros?)\b/gi
    ),
  ].map((match) => Number(match[1]));
  if (claimedQuantities.some((quantity) => !evidence.quantities.includes(quantity))) {
    return NO_EVIDENCE_RESPONSE;
  }

  const claimedStatuses = [...answer.matchAll(/(?:estado|estatus)\s*[:=]\s*([\p{L}_-]+)/giu)].map(
    (match) => match[1]
  );
  if (unsupported(claimedStatuses, evidence.statuses)) return NO_EVIDENCE_RESPONSE;

  const claimedDocuments = [
    ...answer.matchAll(/documento\s+(?:llamado\s+)?(?:\*\*)?["“]?([^\n"”*.,;:]{2,100})/giu),
  ].map((match) => match[1].trim());
  if (unsupported(claimedDocuments, evidence.document_titles)) return NO_EVIDENCE_RESPONSE;

  const claimedSigners = [
    ...answer.matchAll(/(?:firmante|participante)\s*[:=]\s*([^\n,.;]{2,100})/giu),
  ].map((match) => match[1].replace(/\*\*/g, '').trim());
  if (unsupported(claimedSigners, evidence.signer_names)) return NO_EVIDENCE_RESPONSE;

  return redactSensitiveText(answer, 12_000);
}
