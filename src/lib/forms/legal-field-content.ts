import type { FieldType, FormField } from './schema';

export type LegalFieldType = Extract<FieldType, 'consentimiento' | 'declaration'>;

const DEFAULT_CONTENT: Record<LegalFieldType, { description: string; acceptanceLabel: string }> = {
  consentimiento: {
    description: 'He leído la información de este formulario y autorizo el tratamiento de los datos que proporciono para atender la solicitud indicada, conforme al aviso de privacidad aplicable.',
    acceptanceLabel: 'Otorgo mi consentimiento.',
  },
  declaration: {
    description: 'Declaro bajo protesta de decir verdad que la información y los documentos que proporciono son correctos y completos según mi conocimiento.',
    acceptanceLabel: 'Confirmo esta declaración.',
  },
};

export function isLegalField(type: FieldType): type is LegalFieldType {
  return type === 'consentimiento' || type === 'declaration';
}

export function legalFieldContent(field: Pick<FormField, 'type' | 'description' | 'acceptanceLabel'>) {
  if (!isLegalField(field.type)) return null;
  const defaults = DEFAULT_CONTENT[field.type];
  return {
    description: field.description?.trim() || defaults.description,
    acceptanceLabel: field.acceptanceLabel?.trim() || defaults.acceptanceLabel,
  };
}

export function defaultLegalFieldContent(type: LegalFieldType) {
  return DEFAULT_CONTENT[type];
}
