import { z } from 'zod';

export const AUTOMATION_CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'exists',
  'not_exists',
  'contains',
  'in',
  'greater_than',
  'less_than',
] as const;

const fieldPattern =
  /^(event\.type|document\.(status|type_id|classification|template_id)|participant\.reference_id|organization\.id|workspace\.id|package\.(status|resource_count)|metadata\.[a-zA-Z0-9_.-]{1,120})$/;
const scalarSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);

export const automationConditionSchema = z.object({
  field: z.string().regex(fieldPattern),
  operator: z.enum(AUTOMATION_CONDITION_OPERATORS),
  value: z.union([scalarSchema, z.array(scalarSchema).max(100)]).optional(),
});

export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationConditionContext = Record<string, unknown>;

export type AutomationConditionEvaluation = {
  matched: boolean;
  schemaVersion: 1;
  results: Array<{
    index: number;
    field: string;
    operator: AutomationCondition['operator'];
    matched: boolean;
  }>;
};

function readField(context: AutomationConditionContext, field: string): unknown {
  const parts = field.split('.');
  let value: unknown = context;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (part === '__proto__' || part === 'prototype' || part === 'constructor') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function equal(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return left === right;
  if (left === null || right === null) return left === right;
  return String(left) === String(right);
}

function compareNumber(left: unknown, right: unknown, direction: 'greater' | 'less') {
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  return direction === 'greater' ? leftNumber > rightNumber : leftNumber < rightNumber;
}

function evaluateOne(actual: unknown, condition: AutomationCondition) {
  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== '';
    case 'not_exists':
      return actual === undefined || actual === null || actual === '';
    case 'equals':
      return equal(actual, condition.value);
    case 'not_equals':
      return !equal(actual, condition.value);
    case 'contains':
      return Array.isArray(actual)
        ? actual.some((value) => equal(value, condition.value))
        : typeof actual === 'string' && typeof condition.value === 'string'
          ? actual.includes(condition.value)
          : false;
    case 'in':
      return Array.isArray(condition.value)
        ? condition.value.some((value) => equal(actual, value))
        : false;
    case 'greater_than':
      return compareNumber(actual, condition.value, 'greater');
    case 'less_than':
      return compareNumber(actual, condition.value, 'less');
  }
}

export function evaluateAutomationConditions(
  rawConditions: unknown,
  context: AutomationConditionContext
): AutomationConditionEvaluation {
  const conditions = z
    .array(automationConditionSchema)
    .max(50)
    .parse(rawConditions || []);
  const results = conditions.map((condition, index) => ({
    index,
    field: condition.field,
    operator: condition.operator,
    matched: evaluateOne(readField(context, condition.field), condition),
  }));
  return {
    matched: results.every((result) => result.matched),
    schemaVersion: 1,
    results,
  };
}
