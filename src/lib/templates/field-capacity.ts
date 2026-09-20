import type { PublishedTemplateDocument } from './preview';

type TemplateFieldLike = {
  label?: unknown;
  customName?: unknown;
  fieldType?: unknown;
};

function normalizedText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('es-MX') : '';
}

export function getTemplateSignatureCapacity(template?: PublishedTemplateDocument | null): number {
  if (!template || !Array.isArray(template.campos_insertados)) return 0;

  return template.campos_insertados.reduce<number>((capacity, rawField) => {
    if (!rawField || typeof rawField !== 'object') return capacity;

    const field = rawField as TemplateFieldLike;
    const fieldType = normalizedText(field.fieldType);
    const label = normalizedText(field.label);
    const customName = normalizedText(field.customName);
    const isSignature = fieldType === 'signature' || label === 'firma' || customName === 'firma';
    return isSignature ? capacity + 1 : capacity;
  }, 0);
}
