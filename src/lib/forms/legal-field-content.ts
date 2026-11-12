import type { FieldType, FormField } from './schema';

export type LegalFieldType = Extract<FieldType, 'consentimiento' | 'declaration'>;

export interface LegalFieldCopy { description: string; acceptanceLabel: string }
export type FormLegalDefaults = Record<LegalFieldType, LegalFieldCopy>;

const DEFAULT_CONTENT: FormLegalDefaults = {
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

export function createDefaultFormLegalDefaults(): FormLegalDefaults {
  return {
    consentimiento: { ...DEFAULT_CONTENT.consentimiento },
    declaration: { ...DEFAULT_CONTENT.declaration },
  };
}

export function normalizeFormLegalDefaults(value: unknown): FormLegalDefaults {
  const defaults = createDefaultFormLegalDefaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Partial<Record<LegalFieldType, Partial<LegalFieldCopy>>>;
  for (const type of ['consentimiento', 'declaration'] as const) {
    const entry = source[type];
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.description === 'string' && entry.description.trim())
      defaults[type].description = entry.description.trim().slice(0, 1000);
    if (typeof entry.acceptanceLabel === 'string' && entry.acceptanceLabel.trim())
      defaults[type].acceptanceLabel = entry.acceptanceLabel.trim().slice(0, 160);
  }
  return defaults;
}

export function getFormLegalDefaultsStorageKey(workspaceId?: string | null) {
  return `docubox_form_legal_defaults_${workspaceId || 'personal'}`;
}

export function readFormLegalDefaults(workspaceId?: string | null): FormLegalDefaults {
  if (typeof window === 'undefined') return createDefaultFormLegalDefaults();
  try {
    const saved = window.localStorage.getItem(getFormLegalDefaultsStorageKey(workspaceId));
    return normalizeFormLegalDefaults(saved ? JSON.parse(saved) : null);
  } catch {
    return createDefaultFormLegalDefaults();
  }
}

export function writeFormLegalDefaults(workspaceId: string | null | undefined, value: FormLegalDefaults) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getFormLegalDefaultsStorageKey(workspaceId), JSON.stringify(normalizeFormLegalDefaults(value)));
}
