import { z } from 'zod';

export const DOCUMENT_TYPES = [
  'contrato',
  'convenio',
  'carta',
  'autorizacion',
  'acuse',
  'constancia',
  'identificacion',
  'documento_fiscal',
  'formulario',
  'anexo',
  'evidencia',
  'expediente',
  'notificacion',
  'certificacion',
  'pagare',
  'titulo_de_credito',
  'documento_interno',
  'documento_laboral',
  'documento_corporativo',
  'documento_legal',
  'documento_financiero',
  'documento_administrativo',
  'otro',
] as const;

export const DOCUMENT_CATEGORIES = [
  'firma',
  'revision',
  'autorizacion',
  'cumplimiento',
  'identidad',
  'fiscal',
  'laboral',
  'cobranza',
  'notificacion',
  'certificacion',
  'archivo',
  'evidencia',
  'operacion',
  'administracion',
] as const;

export const DOCUMENT_SENSITIVITY = [
  'public',
  'internal',
  'confidential',
  'sensitive',
  'restricted',
] as const;

export const DOCUMENT_RETENTION = [
  'normal',
  'fiscal',
  'legal',
  'evidencia',
  'temporal',
  'permanente',
  'bajo_revision',
] as const;

const nullablePage = z.number().int().positive().nullable();
const confidence = z.number().min(0).max(1);

export const documentEvidenceSchema = z
  .object({
    chunk_id: z.string().uuid(),
    page_number: nullablePage,
    quote: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const documentClassificationSchema = z
  .object({
    detected_document_type: z.enum(DOCUMENT_TYPES),
    detected_document_category: z.enum(DOCUMENT_CATEGORIES),
    language: z.string().trim().min(2).max(32),
    confidence,
    reason: z.string().trim().min(1).max(2_000),
    suggested_tags: z.array(z.string().trim().min(1).max(80)).max(12),
    suggested_folder: z.string().trim().min(1).max(160),
    sensitivity: z.enum(DOCUMENT_SENSITIVITY),
    retention_category: z.enum(DOCUMENT_RETENTION),
    evidence: z.array(documentEvidenceSchema).min(1).max(12),
  })
  .strict();

export const extractedFieldSchema = z
  .object({
    field_key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,120}$/),
    field_label: z.string().trim().min(1).max(160),
    field_value: z.string().trim().min(1).max(10_000),
    normalized_value: z.string().trim().min(1).max(10_000),
    value_type: z.enum([
      'text',
      'date',
      'money',
      'number',
      'person',
      'company',
      'rfc',
      'curp',
      'email',
      'phone',
      'address',
      'boolean',
    ]),
    confidence,
    chunk_id: z.string().uuid(),
    page_number: nullablePage,
    evidence_text: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const documentFieldsSchema = z
  .object({ fields: z.array(extractedFieldSchema).max(100) })
  .strict();

export const documentObligationSchema = z
  .object({
    obligation_type: z.enum([
      'payment',
      'delivery',
      'signature',
      'notice',
      'renewal',
      'confidentiality',
      'compliance',
      'documentary',
      'other',
    ]),
    obligated_party: z.string().trim().max(500),
    beneficiary_party: z.string().trim().max(500),
    description: z.string().trim().min(1).max(4_000),
    due_date: z.string().date().nullable(),
    recurrence_rule: z.string().trim().max(500).nullable(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    confidence,
    chunk_id: z.string().uuid(),
    page_number: nullablePage,
    evidence_text: z.string().trim().min(1).max(1_000),
    suggested_task: z
      .object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().min(1).max(2_000),
        due_date: z.string().date().nullable(),
        priority: z.enum(['low', 'medium', 'high', 'critical']),
      })
      .strict(),
  })
  .strict();

export const documentObligationsSchema = z
  .object({ obligations: z.array(documentObligationSchema).max(100) })
  .strict();

export const completenessCheckSchema = z
  .object({
    check_key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,120}$/),
    check_label: z.string().trim().min(1).max(160),
    status: z.enum(['passed', 'warning', 'failed', 'not_applicable']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    description: z.string().trim().min(1).max(2_000),
    recommendation: z.string().trim().min(1).max(2_000),
    evidence: z.array(documentEvidenceSchema).max(12),
  })
  .strict();

export const documentCompletenessSchema = z
  .object({ checks: z.array(completenessCheckSchema).max(50) })
  .strict();

export const documentProfileSchema = z
  .object({
    title_suggestion: z.string().trim().min(1).max(300),
    short_summary: z.string().trim().min(1).max(1_500),
    executive_summary: z.string().trim().min(1).max(6_000),
    warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict();

const versionChangeSchema = z
  .object({
    change_type: z.enum([
      'title',
      'date',
      'amount',
      'party',
      'obligation',
      'section_added',
      'section_removed',
      'content',
    ]),
    description: z.string().trim().min(1).max(2_000),
    significance: z.enum(['low', 'medium', 'high']),
    version_a_evidence: z.array(documentEvidenceSchema).max(6),
    version_b_evidence: z.array(documentEvidenceSchema).max(6),
  })
  .strict();

export const documentVersionComparisonSchema = z
  .object({
    summary: z.string().trim().min(1).max(4_000),
    changes: z.array(versionChangeSchema).max(100),
  })
  .strict();

export type DocumentClassification = z.infer<typeof documentClassificationSchema>;
export type DocumentFields = z.infer<typeof documentFieldsSchema>;
export type DocumentObligations = z.infer<typeof documentObligationsSchema>;
export type DocumentCompleteness = z.infer<typeof documentCompletenessSchema>;
export type DocumentProfileDraft = z.infer<typeof documentProfileSchema>;
export type DocumentVersionComparison = z.infer<typeof documentVersionComparisonSchema>;

export const SENSITIVE_FIELD_TYPES = new Set(['rfc', 'curp', 'email', 'phone', 'address']);

export function validateEvidenceReferences<T>(
  value: T,
  chunkIds: Set<string>,
  evidenceSelector: (value: T) => Array<{ chunk_id: string; page_number: number | null }>
) {
  const references = evidenceSelector(value);
  if (!references.length || references.some((reference) => !chunkIds.has(reference.chunk_id))) {
    throw new Error('INSUFFICIENT_EVIDENCE');
  }
  return value;
}

export function isPossibleIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'detected_document_type',
    'detected_document_category',
    'language',
    'confidence',
    'reason',
    'suggested_tags',
    'suggested_folder',
    'sensitivity',
    'retention_category',
    'evidence',
  ],
  properties: {
    detected_document_type: { type: 'string', enum: DOCUMENT_TYPES },
    detected_document_category: { type: 'string', enum: DOCUMENT_CATEGORIES },
    language: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' },
    suggested_tags: { type: 'array', maxItems: 12, items: { type: 'string' } },
    suggested_folder: { type: 'string' },
    sensitivity: { type: 'string', enum: DOCUMENT_SENSITIVITY },
    retention_category: { type: 'string', enum: DOCUMENT_RETENTION },
    evidence: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/evidence' },
    },
  },
  $defs: {
    evidence: {
      type: 'object',
      additionalProperties: false,
      required: ['chunk_id', 'page_number', 'quote'],
      properties: {
        chunk_id: { type: 'string', format: 'uuid' },
        page_number: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
        quote: { type: 'string' },
      },
    },
  },
} as const;

export const FIELDS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'field_key',
          'field_label',
          'field_value',
          'normalized_value',
          'value_type',
          'confidence',
          'chunk_id',
          'page_number',
          'evidence_text',
        ],
        properties: {
          field_key: { type: 'string' },
          field_label: { type: 'string' },
          field_value: { type: 'string' },
          normalized_value: { type: 'string' },
          value_type: {
            type: 'string',
            enum: [
              'text',
              'date',
              'money',
              'number',
              'person',
              'company',
              'rfc',
              'curp',
              'email',
              'phone',
              'address',
              'boolean',
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          chunk_id: { type: 'string', format: 'uuid' },
          page_number: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          evidence_text: { type: 'string' },
        },
      },
    },
  },
} as const;

export const OBLIGATIONS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['obligations'],
  properties: {
    obligations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'obligation_type',
          'obligated_party',
          'beneficiary_party',
          'description',
          'due_date',
          'recurrence_rule',
          'priority',
          'confidence',
          'chunk_id',
          'page_number',
          'evidence_text',
          'suggested_task',
        ],
        properties: {
          obligation_type: {
            type: 'string',
            enum: [
              'payment',
              'delivery',
              'signature',
              'notice',
              'renewal',
              'confidentiality',
              'compliance',
              'documentary',
              'other',
            ],
          },
          obligated_party: { type: 'string' },
          beneficiary_party: { type: 'string' },
          description: { type: 'string' },
          due_date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
          recurrence_rule: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          chunk_id: { type: 'string', format: 'uuid' },
          page_number: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          evidence_text: { type: 'string' },
          suggested_task: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'description', 'due_date', 'priority'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              due_date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            },
          },
        },
      },
    },
  },
} as const;

export const COMPLETENESS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checks'],
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'check_key',
          'check_label',
          'status',
          'severity',
          'description',
          'recommendation',
          'evidence',
        ],
        properties: {
          check_key: { type: 'string' },
          check_label: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'warning', 'failed', 'not_applicable'] },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          description: { type: 'string' },
          recommendation: { type: 'string' },
          evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
        },
      },
    },
  },
  $defs: CLASSIFICATION_JSON_SCHEMA.$defs,
} as const;

export const PROFILE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title_suggestion', 'short_summary', 'executive_summary', 'warnings'],
  properties: {
    title_suggestion: { type: 'string' },
    short_summary: { type: 'string' },
    executive_summary: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const VERSION_COMPARISON_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changes'],
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'change_type',
          'description',
          'significance',
          'version_a_evidence',
          'version_b_evidence',
        ],
        properties: {
          change_type: {
            type: 'string',
            enum: [
              'title',
              'date',
              'amount',
              'party',
              'obligation',
              'section_added',
              'section_removed',
              'content',
            ],
          },
          description: { type: 'string' },
          significance: { type: 'string', enum: ['low', 'medium', 'high'] },
          version_a_evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
          version_b_evidence: { type: 'array', items: { $ref: '#/$defs/evidence' } },
        },
      },
    },
  },
  $defs: CLASSIFICATION_JSON_SCHEMA.$defs,
} as const;
