import { createDefaultFormAppearance, type FormAppearance } from './schema';
import { isFormTypography } from '@/lib/typography/font-families';

export function normalizeFormAppearanceDefaults(value: unknown): FormAppearance {
  const defaults = createDefaultFormAppearance();
  if (!value || typeof value !== 'object') return defaults;
  const source = value as Partial<FormAppearance>;
  const color = typeof source.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(source.accentColor)
    ? source.accentColor : defaults.accentColor;
  const backgroundColor = typeof source.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(source.backgroundColor)
    ? source.backgroundColor : defaults.backgroundColor;

  return {
    accentColor: color.toUpperCase() === '#4F46E5' ? defaults.accentColor : color,
    backgroundColor,
    headerText: typeof source.headerText === 'string' && source.headerText !== 'Formulario firmable' ? source.headerText.slice(0, 120) : defaults.headerText,
    headerDescription: typeof source.headerDescription === 'string' ? source.headerDescription.slice(0, 500) : defaults.headerDescription,
    headerDocumentNumber: typeof source.headerDocumentNumber === 'string' ? source.headerDocumentNumber.slice(0, 120) : defaults.headerDocumentNumber,
    headerDocumentTypeName: typeof source.headerDocumentTypeName === 'string' ? source.headerDocumentTypeName.slice(0, 120) : defaults.headerDocumentTypeName,
    headerAlignment: source.headerAlignment === 'center' || source.headerAlignment === 'right' ? source.headerAlignment : 'left',
    footerText: typeof source.footerText === 'string' ? source.footerText.slice(0, 200) : defaults.footerText,
    footerAlignment: source.footerAlignment === 'left' || source.footerAlignment === 'right' ? source.footerAlignment : 'center',
    confirmationMessage: typeof source.confirmationMessage === 'string' ? source.confirmationMessage.slice(0, 300) : defaults.confirmationMessage,
    showHeader: source.showHeader !== false,
    showTitle: source.showTitle !== false,
    showFooter: typeof source.showFooter === 'boolean' ? source.showFooter : defaults.showFooter,
    showProgressBar: source.showProgressBar !== false,
    showAccentBar: source.showAccentBar !== false,
    showDescription: source.showDescription !== false,
    showDocumentNumber: source.showDocumentNumber !== false,
    showDocumentType: source.showDocumentType !== false,
    showSectionDescriptions: source.showSectionDescriptions !== false,
    width: source.width === 'wide' ? 'wide' : 'standard',
    typography: isFormTypography(source.typography) ? source.typography : defaults.typography,
    showSectionNumbers: source.showSectionNumbers !== false,
    compactSpacing: source.compactSpacing === true,
  };
}

export function reusableFormAppearance(value: FormAppearance): FormAppearance {
  return {
    ...normalizeFormAppearanceDefaults(value),
    headerText: '',
    headerDescription: '',
    headerDocumentNumber: '',
    headerDocumentTypeName: '',
  };
}

export function getFormAppearanceDefaultsStorageKey(workspaceId?: string | null) {
  return `docubox_form_appearance_defaults_${workspaceId || 'personal'}`;
}

export function readFormAppearanceDefaults(workspaceId?: string | null): FormAppearance {
  if (typeof window === 'undefined') return createDefaultFormAppearance();
  try {
    const stored = window.localStorage.getItem(getFormAppearanceDefaultsStorageKey(workspaceId));
    return stored ? normalizeFormAppearanceDefaults(JSON.parse(stored)) : createDefaultFormAppearance();
  } catch {
    return createDefaultFormAppearance();
  }
}

export function writeFormAppearanceDefaults(workspaceId: string | null | undefined, value: FormAppearance) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getFormAppearanceDefaultsStorageKey(workspaceId), JSON.stringify(normalizeFormAppearanceDefaults(value)));
}
