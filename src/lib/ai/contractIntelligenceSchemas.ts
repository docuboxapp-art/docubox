import { z } from 'zod';
import { documentEvidenceSchema, documentObligationSchema } from './documentIntelligenceSchemas';

const confidence = z.number().min(0).max(1);

export const contractualFactSchema = z
  .object({
    category: z.enum([
      'party',
      'date',
      'term',
      'amount',
      'currency',
      'renewal',
      'notice',
      'milestone',
      'deliverable',
      'penalty',
      'warranty',
      'clause',
      'jurisdiction',
      'termination',
    ]),
    field_key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,100}$/),
    field_label: z.string().trim().min(1).max(160),
    field_value: z.string().trim().min(1).max(10_000),
    normalized_value: z.string().trim().min(1).max(10_000),
    value_type: z.enum(['text', 'date', 'money', 'number', 'person', 'company', 'boolean']),
    source_kind: z.enum(['explicit', 'inference']),
    confidence,
    chunk_id: z.string().uuid(),
    page_number: z.number().int().positive().nullable(),
    evidence_text: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const contractualRiskSchema = z
  .object({
    risk_key: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,100}$/),
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2_000),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    source_kind: z.enum(['explicit', 'inference']),
    confidence,
    chunk_id: z.string().uuid(),
    page_number: z.number().int().positive().nullable(),
    evidence_text: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const contractualAnalysisSchema = z
  .object({
    applicability: z
      .object({
        is_contract: z.boolean(),
        confidence,
        reason: z.string().trim().min(1).max(1_000),
        evidence: z.array(documentEvidenceSchema).max(6),
      })
      .strict(),
    facts: z.array(contractualFactSchema).max(80),
    obligations: z.array(documentObligationSchema).max(100),
    risks: z.array(contractualRiskSchema).max(40),
    not_found: z.array(z.string().trim().min(1).max(120)).max(30),
  })
  .strict();

export type ContractualAnalysis = z.infer<typeof contractualAnalysisSchema>;

const evidenceJson = {
  type: 'object',
  additionalProperties: false,
  required: ['chunk_id', 'page_number', 'quote'],
  properties: {
    chunk_id: { type: 'string', format: 'uuid' },
    page_number: { type: ['integer', 'null'], minimum: 1 },
    quote: { type: 'string', minLength: 1, maxLength: 1000 },
  },
};

const obligationJson = {
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
    obligated_party: { type: 'string', maxLength: 500 },
    beneficiary_party: { type: 'string', maxLength: 500 },
    description: { type: 'string', minLength: 1, maxLength: 4000 },
    due_date: { type: ['string', 'null'], format: 'date' },
    recurrence_rule: { type: ['string', 'null'], maxLength: 500 },
    priority: { enum: ['low', 'medium', 'high', 'critical'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    chunk_id: { type: 'string', format: 'uuid' },
    page_number: { type: ['integer', 'null'], minimum: 1 },
    evidence_text: { type: 'string', minLength: 1, maxLength: 1000 },
    suggested_task: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'due_date', 'priority'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 300 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        due_date: { type: ['string', 'null'], format: 'date' },
        priority: { enum: ['low', 'medium', 'high', 'critical'] },
      },
    },
  },
};

export const CONTRACTUAL_ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['applicability', 'facts', 'obligations', 'risks', 'not_found'],
  properties: {
    applicability: {
      type: 'object',
      additionalProperties: false,
      required: ['is_contract', 'confidence', 'reason', 'evidence'],
      properties: {
        is_contract: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
        evidence: { type: 'array', maxItems: 6, items: evidenceJson },
      },
    },
    facts: {
      type: 'array',
      maxItems: 80,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category',
          'field_key',
          'field_label',
          'field_value',
          'normalized_value',
          'value_type',
          'source_kind',
          'confidence',
          'chunk_id',
          'page_number',
          'evidence_text',
        ],
        properties: {
          category: {
            enum: [
              'party',
              'date',
              'term',
              'amount',
              'currency',
              'renewal',
              'notice',
              'milestone',
              'deliverable',
              'penalty',
              'warranty',
              'clause',
              'jurisdiction',
              'termination',
            ],
          },
          field_key: { type: 'string', pattern: '^[a-z0-9_]{1,100}$' },
          field_label: { type: 'string', minLength: 1, maxLength: 160 },
          field_value: { type: 'string', minLength: 1, maxLength: 10000 },
          normalized_value: { type: 'string', minLength: 1, maxLength: 10000 },
          value_type: { enum: ['text', 'date', 'money', 'number', 'person', 'company', 'boolean'] },
          source_kind: { enum: ['explicit', 'inference'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          chunk_id: { type: 'string', format: 'uuid' },
          page_number: { type: ['integer', 'null'], minimum: 1 },
          evidence_text: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    obligations: { type: 'array', maxItems: 100, items: obligationJson },
    risks: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'risk_key',
          'title',
          'description',
          'severity',
          'source_kind',
          'confidence',
          'chunk_id',
          'page_number',
          'evidence_text',
        ],
        properties: {
          risk_key: { type: 'string', pattern: '^[a-z0-9_]{1,100}$' },
          title: { type: 'string', minLength: 1, maxLength: 240 },
          description: { type: 'string', minLength: 1, maxLength: 2000 },
          severity: { enum: ['low', 'medium', 'high', 'critical'] },
          source_kind: { enum: ['explicit', 'inference'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          chunk_id: { type: 'string', format: 'uuid' },
          page_number: { type: ['integer', 'null'], minimum: 1 },
          evidence_text: { type: 'string', minLength: 1, maxLength: 1000 },
        },
      },
    },
    not_found: {
      type: 'array',
      maxItems: 30,
      items: { type: 'string', minLength: 1, maxLength: 120 },
    },
  },
};
