import { formatFormAddress, type FormField } from './schema';

export function hasFormValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasFormValue);
  return true;
}

export function matchesFormCondition(field: FormField, values: Record<string, unknown>): boolean {
  const rule = field.conditionalRule;
  if (!field.conditionalVisible || !rule?.fieldId) return false;
  const current = values[rule.fieldId];
  const actual = Array.isArray(current) ? current.map(String) : String(current ?? '');
  switch (rule.operator) {
    case 'eq': return Array.isArray(actual) ? actual.includes(rule.value) : actual === rule.value;
    case 'neq': return Array.isArray(actual) ? !actual.includes(rule.value) : actual !== rule.value;
    case 'contains': return Array.isArray(actual) ? actual.includes(rule.value) : actual.includes(rule.value);
    case 'empty': return !hasFormValue(current);
    case 'not_empty': return hasFormValue(current);
    default: return false;
  }
}

export function isFormFieldVisible(field: FormField, values: Record<string, unknown>): boolean {
  if (field.type === 'signature_block') return true;
  if (!field.conditionalVisible || !field.conditionalRule?.fieldId) return true;
  const matches = matchesFormCondition(field, values);
  return field.conditionalRule.action === 'hide' ? !matches
    : field.conditionalRule.action === 'require' || field.conditionalRule.action === 'enable_signature'
      ? true : matches;
}

export function isFormFieldRequired(field: FormField, values: Record<string, unknown>): boolean {
  if (field.type === 'signature_block') return true;
  return field.required || (field.conditionalRule?.action === 'require' && matchesFormCondition(field, values));
}

export function formatFormFieldValue(field: FormField, value: unknown): string {
  if (!hasFormValue(value)) return '—';
  if (field.type === 'fiscal_address') return formatFormAddress(value) || '—';
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  const optionLabel = (item: unknown) => field.options?.find((option) => option.value === item)?.label || String(item);
  if (Array.isArray(value)) return value.map(optionLabel).join(', ');
  if (['radio', 'select', 'yes_no'].includes(field.type)) return optionLabel(value);
  if (field.type === 'currency') return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value) || 0);
  if (field.type === 'signature_block') return 'Espacio de firma';
  if (typeof value === 'object') return 'Evidencia capturada';
  return String(value);
}
