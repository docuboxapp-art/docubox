import { defaultReviewPolicy, normalizeReviewPolicy, type CaseReviewPolicy } from './review-policy';
import { CASE_TEMPLATES, type CaseTemplate } from './schema';
import { caseStageCatalog, caseVerificationCatalog } from './template-catalog';
import { caseCategories, caseTags } from './category-catalog';
import { readCaseCatalogTags, type CaseCatalogTag } from '../catalog/classification';
import {
  DEFAULT_CASE_APPEARANCE,
  DEFAULT_CASE_EXPERIENCE,
  normalizeCaseAppearance,
  normalizeCaseExperience,
  positiveDays,
  type CaseAppearance,
  type CaseExperience,
} from './experience';

export type CaseTemplateItemKind =
  'requested_document' | 'new_document' | 'existing_document' | 'document_template' | 'form';
export type CasePersonality = 'both' | 'individual' | 'company';

export interface CaseTemplateItem {
  id: string;
  kind: CaseTemplateItemKind;
  title: string;
  description: string;
  instructions: string;
  documentCategory: string;
  responsibleRole: 'subject' | 'external' | 'representative' | 'internal';
  sourceVersion: string | null;
  sourceRevision: number | null;
  required: boolean;
  conditional: boolean;
  condition: string;
  catalogId: string | null;
  sourceId: string | null;
  sourceName: string;
  requiresReview: boolean;
  requiresSignature: boolean;
  reviewerRole: 'owner' | 'admin' | 'member' | null;
  customizableAtLaunch: boolean;
  appliesTo: CasePersonality;
  validityDays: number | null;
  dueInDays: number | null;
  allowedFormats: string[];
  maxSizeMb: number;
  maxFiles: number;
  responsible: string;
  askIssueDate: boolean;
  allowReplacement: boolean;
}

export interface CaseTemplateVerification {
  id: string;
  catalogKey: string;
  title: string;
  description: string;
  subject: string;
  timing: string;
  required: boolean;
  consentRequired: boolean;
  retryLimit: number;
  evidence: string;
  dueInDays: number | null;
}

export interface CaseTemplateStage {
  id: string;
  catalogKey: string;
  title: string;
  description: string;
  responsible: string;
  completionRule: string;
  requiresApproval: boolean;
  notifyOnCompletion: boolean;
  conditional: boolean;
  observationAction: string;
  coordinatorRole?: 'owner' | 'admin' | 'member';
  dependsOn?: string[];
  execution?: 'sequential' | 'parallel';
  completionMode?: 'all_activities' | 'manual';
  activities?: CaseWorkflowActivity[];
  deadlineDays?: number | null;
}

export type CaseWorkflowActivityKind =
  | 'receive_document'
  | 'create_document'
  | 'generate_document'
  | 'complete_form'
  | 'verify'
  | 'review_document'
  | 'approve'
  | 'sign'
  | 'close';
export interface CaseWorkflowActivity {
  id: string;
  kind: CaseWorkflowActivityKind;
  refId: string | null;
  required: boolean;
}

export interface CaseTemplateSection {
  id: string;
  title: string;
  description: string;
  items: CaseTemplateItem[];
  dueInDays: number | null;
}

export interface CaseTemplateDraft {
  name: string;
  description: string;
  caseType: string;
  caseSubtype: string;
  categoryCode: string;
  typeCode: string;
  folio: string;
  tagIds: string[];
  catalogTags?: CaseCatalogTag[];
  experience: CaseExperience;
  appearance: CaseAppearance;
  personality: CasePersonality;
  sections: CaseTemplateSection[];
  verifications: CaseTemplateVerification[];
  stages: CaseTemplateStage[];
  workflowMode: 'recommended' | 'custom';
  reviewPolicy: CaseReviewPolicy;
}

export interface StoredCaseTemplate {
  id: string;
  name: string;
  description: string;
  case_type: string;
  case_subtype: string | null;
  requirements_schema: unknown;
  status: 'draft' | 'active' | 'paused' | 'archived';
  updated_at?: string | null;
  archived_from_status?: 'draft' | 'active' | 'paused' | null;
}

export function newCaseTemplateItem(kind: CaseTemplateItemKind): CaseTemplateItem {
  const labels: Record<CaseTemplateItemKind, string> = {
    requested_document: 'Solicitar documento',
    new_document: 'Nuevo documento',
    existing_document: 'Documento en progreso',
    document_template: 'Documento desde plantilla',
    form: 'Formulario',
  };
  return {
    id: crypto.randomUUID(),
    kind,
    title: labels[kind],
    description: '',
    instructions: '',
    documentCategory: 'identity',
    responsibleRole: 'external',
    sourceVersion: null,
    sourceRevision: null,
    required: kind !== 'requested_document',
    conditional: false,
    condition: '',
    catalogId: null,
    sourceId: null,
    sourceName: '',
    requiresReview: kind === 'requested_document',
    requiresSignature: false,
    reviewerRole: 'owner',
    customizableAtLaunch: true,
    appliesTo: 'both',
    validityDays: null,
    dueInDays: null,
    allowedFormats: ['PDF', 'JPG', 'PNG'],
    maxSizeMb: 15,
    maxFiles: 1,
    responsible: 'Persona que integra el expediente',
    askIssueDate: false,
    allowReplacement: true,
  };
}

export function newCaseTemplateVerification(key: string): CaseTemplateVerification {
  const preset = caseVerificationCatalog.find((item) => item.key === key);
  return {
    id: crypto.randomUUID(),
    catalogKey: preset?.key ?? 'custom',
    title: preset?.title ?? 'Nueva verificación',
    description: preset?.description ?? '',
    subject: 'Persona que integra el expediente',
    timing: 'Antes de la revisión',
    required: true,
    consentRequired: key !== 'email_otp',
    retryLimit: 3,
    evidence: 'Resultado y fecha',
    dueInDays: null,
  };
}

export function newCaseTemplateStage(key: string): CaseTemplateStage {
  const preset = caseStageCatalog.find((item) => item.key === key);
  return {
    id: crypto.randomUUID(),
    catalogKey: preset?.key ?? 'custom',
    title: preset?.title ?? 'Nueva etapa',
    description: preset?.description ?? '',
    responsible: 'Responsable interno',
    completionRule: '',
    requiresApproval: key === 'approval',
    notifyOnCompletion: false,
    conditional: key === 'correction' || key === 'renewal',
    observationAction: '',
    coordinatorRole: 'owner',
    dependsOn: [],
    execution: 'sequential',
    completionMode: key === 'opening' || key === 'closing' ? 'manual' : 'all_activities',
    activities: [],
    deadlineDays: null,
  };
}

export function emptyCaseTemplate(): CaseTemplateDraft {
  return {
    name: '',
    description: '',
    caseType: '',
    caseSubtype: '',
    categoryCode: '',
    typeCode: '',
    folio: '',
    tagIds: [],
    experience: { ...DEFAULT_CASE_EXPERIENCE },
    appearance: { ...DEFAULT_CASE_APPEARANCE },
    personality: 'both',
    sections: [
      {
        id: crypto.randomUUID(),
        title: 'Documentación inicial',
        description: '',
        items: [],
        dueInDays: null,
      },
    ],
    verifications: [],
    stages: ['opening', 'documents', 'review', 'closing'].map(newCaseTemplateStage),
    workflowMode: 'recommended',
    reviewPolicy: defaultReviewPolicy(),
  };
}

export function fromPresetCaseTemplate(template: CaseTemplate): CaseTemplateDraft {
  return {
    name: template.name,
    description: template.description,
    caseType: template.type,
    caseSubtype: '',
    categoryCode: caseCategories.find((item) => item.name === template.type)?.code || '',
    typeCode: '',
    folio: '',
    tagIds: [],
    experience: { ...DEFAULT_CASE_EXPERIENCE },
    appearance: { ...DEFAULT_CASE_APPEARANCE },
    personality: 'both',
    sections: [
      {
        id: crypto.randomUUID(),
        title: 'Documentación inicial',
        description: '',
        dueInDays: null,
        items: template.requirements.map((requirement) => ({
          ...newCaseTemplateItem('requested_document'),
          title: requirement.name,
          description: requirement.description,
          required: requirement.required,
          requiresReview: requirement.requiresReview,
          allowedFormats: requirement.allowedFormats,
          maxSizeMb: requirement.maxSizeMb,
        })),
      },
    ],
    verifications: template.identityMethods.map((method) => ({
      ...newCaseTemplateVerification(
        method.toLowerCase().includes('otp')
          ? 'email_otp'
          : method.toLowerCase().includes('sat')
            ? 'tax'
            : method.toLowerCase().includes('representante')
              ? 'representative'
              : 'official_id'
      ),
      title: method,
    })),
    stages: template.milestones.map((milestone) => ({
      ...newCaseTemplateStage(
        caseStageCatalog.find((item) => item.title === milestone.title)?.key ?? 'custom'
      ),
      title: milestone.title,
      description: milestone.description,
      responsible: milestone.responsible,
      completionRule: milestone.condition,
    })),
    workflowMode: 'recommended',
    reviewPolicy: defaultReviewPolicy(),
  };
}

export function parseStoredCaseTemplate(row: StoredCaseTemplate): CaseTemplateDraft {
  const raw = row.requirements_schema;
  const schema =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const catalogTags = readCaseCatalogTags(schema.catalogTags);
  const knownTags = new Set([...caseTags, ...catalogTags].map((tag) => tag.id));
  const candidate = schema.sections;
  const sections: CaseTemplateSection[] = Array.isArray(candidate)
    ? candidate.filter((section): section is CaseTemplateSection =>
        Boolean(
          section &&
          typeof section === 'object' &&
          typeof section.id === 'string' &&
          typeof section.title === 'string' &&
          Array.isArray(section.items)
        )
      )
    : [];
  return {
    name: row.name,
    description: row.description,
    caseType: row.case_type === 'Sin especificar' ? '' : row.case_type,
    caseSubtype: row.case_subtype || '',
    categoryCode:
      typeof schema.categoryCode === 'string'
        ? schema.categoryCode
        : caseCategories.find((item) => item.name === row.case_type)?.code || '',
    typeCode:
      typeof schema.typeCode === 'string'
        ? schema.typeCode
        : caseCategories
            .flatMap((item) => item.types)
            .find((item) => item.name === row.case_subtype)?.code || '',
    folio: typeof schema.folio === 'string' ? schema.folio : '',
    tagIds: Array.isArray(schema.tagIds)
      ? schema.tagIds.filter(
          (id): id is string => typeof id === 'string' && knownTags.has(id)
        )
      : [],
    ...(catalogTags.length > 0 && { catalogTags }),
    experience: normalizeCaseExperience(schema.experience),
    appearance: normalizeCaseAppearance(schema.appearance),
    personality: isCasePersonality(schema.personality) ? schema.personality : 'both',
    sections: sections.length
      ? sections.map((section) => ({
          ...section,
          dueInDays: positiveDays(section.dueInDays),
          items: section.items.map((item) => ({
            ...item,
            reviewerRole: ['owner', 'admin', 'member'].includes(String(item.reviewerRole))
              ? item.reviewerRole
              : null,
            requiresSignature: item.requiresSignature === true,
            instructions: typeof item.instructions === 'string' ? item.instructions : '',
            documentCategory:
              typeof item.documentCategory === 'string' ? item.documentCategory : 'identity',
            responsibleRole: ['subject', 'external', 'representative', 'internal'].includes(
              item.responsibleRole
            )
              ? item.responsibleRole
              : 'external',
            sourceVersion: typeof item.sourceVersion === 'string' ? item.sourceVersion : null,
            sourceRevision: typeof item.sourceRevision === 'number' ? item.sourceRevision : null,
            appliesTo: isCasePersonality(item.appliesTo) ? item.appliesTo : 'both',
            customizableAtLaunch:
              typeof item.customizableAtLaunch === 'boolean' ? item.customizableAtLaunch : true,
            validityDays:
              typeof item.validityDays === 'number' && item.validityDays > 0
                ? item.validityDays
                : null,
            dueInDays: positiveDays(item.dueInDays),
            allowedFormats:
              Array.isArray(item.allowedFormats) && item.allowedFormats.length
                ? item.allowedFormats
                : ['PDF', 'JPG', 'PNG'],
            maxSizeMb:
              typeof item.maxSizeMb === 'number' && item.maxSizeMb > 0 ? item.maxSizeMb : 15,
            conditional: item.conditional === true,
            condition: typeof item.condition === 'string' ? item.condition : '',
            catalogId: typeof item.catalogId === 'string' ? item.catalogId : null,
            maxFiles: typeof item.maxFiles === 'number' && item.maxFiles > 0 ? item.maxFiles : 1,
            responsible:
              typeof item.responsible === 'string'
                ? item.responsible
                : 'Persona que integra el expediente',
            askIssueDate: item.askIssueDate === true,
            allowReplacement: item.allowReplacement !== false,
          })),
        }))
      : emptyCaseTemplate().sections,
    verifications: Array.isArray(schema.verifications)
      ? schema.verifications
          .filter((value): value is CaseTemplateVerification =>
            Boolean(
              value &&
              typeof value === 'object' &&
              typeof value.id === 'string' &&
              typeof value.title === 'string'
            )
          )
          .map((value) => ({
            ...newCaseTemplateVerification(value.catalogKey || 'custom'),
            ...value,
            dueInDays: positiveDays(value.dueInDays),
          }))
      : [],
    stages: Array.isArray(schema.stages)
      ? schema.stages
          .filter((value): value is CaseTemplateStage =>
            Boolean(
              value &&
              typeof value === 'object' &&
              typeof value.id === 'string' &&
              typeof value.title === 'string'
            )
          )
          .map((value) => ({
            ...newCaseTemplateStage(value.catalogKey || 'custom'),
            ...value,
            dependsOn: Array.isArray(value.dependsOn)
              ? value.dependsOn.filter((id): id is string => typeof id === 'string')
              : [],
            activities: Array.isArray(value.activities)
              ? value.activities.filter((activity): activity is CaseWorkflowActivity =>
                  Boolean(
                    activity && typeof activity.id === 'string' && typeof activity.kind === 'string'
                  )
                )
              : [],
            deadlineDays: positiveDays(value.deadlineDays),
          }))
      : emptyCaseTemplate().stages,
    reviewPolicy: normalizeReviewPolicy(
      schema.reviewPolicy,
      Array.isArray(schema.stages) ? (schema.stages as CaseTemplateStage[]) : undefined,
      schema.workflowMode === 'custom' ||
        (Array.isArray(schema.stages) && (typeof schema.version !== 'number' || schema.version < 5))
    ),
    workflowMode:
      schema.workflowMode === 'custom' ||
      ((typeof schema.version !== 'number' || schema.version < 5) && Array.isArray(schema.stages))
        ? 'custom'
        : 'recommended',
  };
}

export function toCaseTemplate(row: StoredCaseTemplate): CaseTemplate {
  const draft = parseStoredCaseTemplate(row);
  return {
    id: row.id,
    name: row.name,
    type: row.case_type,
    description: row.description,
    requirements: draft.sections
      .flatMap((section) => section.items)
      .filter((item) => item.kind !== 'form')
      .map((item) => ({
        name: item.title,
        description: item.description,
        category:
          item.kind === 'document_template' || item.kind === 'new_document'
            ? ('generated' as const)
            : ('attachment' as const),
        required: item.required,
        allowedFormats: item.allowedFormats,
        maxSizeMb: item.maxSizeMb,
        requiresReview: item.requiresReview,
        requiresSignature: false,
        requiresIdentity: false,
      })),
    identityMethods: draft.verifications.map((item) => item.title),
    milestones: draft.stages.map((item) => ({
      title: item.title,
      description: item.description,
      responsible: item.responsible,
      condition: item.completionRule,
    })),
    closureRuleLabels: draft.experience.signAtClosure ? ['Firma de cierre del expediente'] : [],
  };
}

export const itemKindLabel: Record<CaseTemplateItemKind, string> = {
  requested_document: 'Solicitar documento',
  new_document: 'Crear documento',
  existing_document: 'Vincular documento al abrir',
  document_template: 'Documento desde plantilla',
  form: 'Agregar formulario',
};

export const presetCaseTemplates = CASE_TEMPLATES;

function isCasePersonality(value: unknown): value is CasePersonality {
  return value === 'both' || value === 'individual' || value === 'company';
}
