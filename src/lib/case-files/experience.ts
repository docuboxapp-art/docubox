export interface CaseExperience {
  showBySteps: boolean;
  allowSaveProgress: boolean;
  signAtClosure: boolean;
  expireSections: boolean;
  expireElements: boolean;
  configureDesign: boolean;
  configureWorkflow: boolean;
  signatureDueDays: number | null;
}

export interface CaseAppearance {
  headerText: string;
  headerDescription: string;
  headerAlignment: 'left' | 'center';
  accentColor: string;
  backgroundColor: string;
  width: 'standard' | 'wide';
  showSectionNumbers: boolean;
  showSectionDescriptions: boolean;
  compactSpacing: boolean;
  showFooter: boolean;
  footerText: string;
}

export const DEFAULT_CASE_EXPERIENCE: CaseExperience = {
  showBySteps: true,
  allowSaveProgress: true,
  signAtClosure: false,
  expireSections: false,
  expireElements: false,
  configureDesign: true,
  configureWorkflow: true,
  signatureDueDays: null,
};

export const DEFAULT_CASE_APPEARANCE: CaseAppearance = {
  headerText: '',
  headerDescription: '',
  headerAlignment: 'left',
  accentColor: '#1E6BFF',
  backgroundColor: '#F7F9FC',
  width: 'standard',
  showSectionNumbers: true,
  showSectionDescriptions: true,
  compactSpacing: false,
  showFooter: false,
  footerText: '',
};

export function positiveDays(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 3650
    ? value
    : null;
}

export function normalizeCaseExperience(value: unknown): CaseExperience {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<CaseExperience>)
      : {};
  return {
    showBySteps: input.showBySteps !== false,
    allowSaveProgress: input.allowSaveProgress !== false,
    signAtClosure: input.signAtClosure === true,
    expireSections: input.expireSections === true,
    expireElements: input.expireElements === true,
    configureDesign: input.configureDesign !== false,
    // Review and closure always apply; this legacy preference cannot disable controls.
    configureWorkflow: true,
    signatureDueDays: positiveDays(input.signatureDueDays),
  };
}

const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const shortText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

export function normalizeCaseAppearance(value: unknown): CaseAppearance {
  const input =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<CaseAppearance>)
      : {};
  return {
    headerText: shortText(input.headerText, 120),
    headerDescription: shortText(input.headerDescription, 500),
    headerAlignment: input.headerAlignment === 'center' ? 'center' : 'left',
    accentColor: isColor(input.accentColor)
      ? input.accentColor
      : DEFAULT_CASE_APPEARANCE.accentColor,
    backgroundColor: isColor(input.backgroundColor)
      ? input.backgroundColor
      : DEFAULT_CASE_APPEARANCE.backgroundColor,
    width: input.width === 'wide' ? 'wide' : 'standard',
    showSectionNumbers: input.showSectionNumbers !== false,
    showSectionDescriptions: input.showSectionDescriptions !== false,
    compactSpacing: input.compactSpacing === true,
    showFooter: input.showFooter === true,
    footerText: shortText(input.footerText, 200),
  };
}

export function readCaseDefaults(workspaceId?: string | null) {
  const fallback = { experience: DEFAULT_CASE_EXPERIENCE, appearance: DEFAULT_CASE_APPEARANCE };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`docubox_case_defaults_${workspaceId || 'personal'}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      experience: normalizeCaseExperience(parsed.experience),
      appearance: normalizeCaseAppearance(parsed.appearance),
    };
  } catch {
    return fallback;
  }
}

export function writeCaseDefaults(
  workspaceId: string | null | undefined,
  values: { experience: CaseExperience; appearance: CaseAppearance }
) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    `docubox_case_defaults_${workspaceId || 'personal'}`,
    JSON.stringify({
      experience: normalizeCaseExperience(values.experience),
      appearance: normalizeCaseAppearance(values.appearance),
    })
  );
}

/** The seven steps stay visible; configureDesign controls editing, never step numbering. */
export function isCaseWizardStepEnabled(_stepId: string, _experience: CaseExperience): boolean {
  return true;
}
