import { createDefaultFormTemplate, type FormSettings } from './schema';

export type FormExperienceDefaults = Pick<
  FormSettings,
  | 'multiStep'
  | 'mode'
  | 'allowSaveProgress'
  | 'configurePdfDetails'
  | 'configureFormDetails'
  | 'requiresSignature'
  | 'configureLinkExpiration'
  | 'expirationHours'
>;

export function snapshotFormExperience(settings: FormSettings): FormExperienceDefaults {
  return {
    multiStep: settings.multiStep,
    mode: settings.mode,
    allowSaveProgress: settings.allowSaveProgress,
    configurePdfDetails: settings.configurePdfDetails,
    configureFormDetails: settings.configureFormDetails,
    requiresSignature: true,
    configureLinkExpiration: settings.configureLinkExpiration,
    expirationHours: settings.expirationHours,
  };
}

export function hasFormExperienceChanges(
  settings: FormSettings,
  saved: FormExperienceDefaults
): boolean {
  const current = snapshotFormExperience(settings);
  return (Object.keys(current) as Array<keyof FormExperienceDefaults>).some(
    (key) => key === 'expirationHours' && !current.configureLinkExpiration && !saved.configureLinkExpiration
      ? false
      : current[key] !== saved[key]
  );
}

export function createDefaultFormExperienceDefaults(
  configurePdfDetails = false
): FormExperienceDefaults {
  const settings = createDefaultFormTemplate().settings;
  return { ...snapshotFormExperience(settings), configurePdfDetails };
}

export function normalizeFormExperienceDefaults(
  value: unknown,
  legacyConfigurePdfDetails = false
): FormExperienceDefaults {
  const defaults = createDefaultFormExperienceDefaults(legacyConfigurePdfDetails);
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<FormExperienceDefaults>;
  const multiStep = typeof candidate.multiStep === 'boolean'
    ? candidate.multiStep : defaults.multiStep;
  const expirationHours = Number(candidate.expirationHours);
  return {
    multiStep,
    mode: multiStep ? 'multistep' : 'scroll',
    allowSaveProgress: typeof candidate.allowSaveProgress === 'boolean'
      ? candidate.allowSaveProgress : defaults.allowSaveProgress,
    configurePdfDetails: typeof candidate.configurePdfDetails === 'boolean'
      ? candidate.configurePdfDetails : defaults.configurePdfDetails,
    configureFormDetails: typeof candidate.configureFormDetails === 'boolean'
      ? candidate.configureFormDetails : defaults.configureFormDetails,
    requiresSignature: true,
    configureLinkExpiration: typeof candidate.configureLinkExpiration === 'boolean'
      ? candidate.configureLinkExpiration : typeof candidate.expirationHours === 'number',
    expirationHours: Number.isFinite(expirationHours) && expirationHours >= 1 / 60 && expirationHours <= 720
      ? expirationHours : defaults.expirationHours,
  };
}

export function getFormExperienceDefaultsStorageKey(workspaceId?: string | null) {
  return `docubox_form_experience_defaults_${workspaceId || 'personal'}`;
}

export function hasFormExperienceDefaults(workspaceId?: string | null) {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(getFormExperienceDefaultsStorageKey(workspaceId)) !== null;
  } catch {
    return false;
  }
}

export function readFormExperienceDefaults(
  workspaceId?: string | null,
  legacyConfigurePdfDetails = false
): FormExperienceDefaults {
  if (typeof window === 'undefined') return createDefaultFormExperienceDefaults(legacyConfigurePdfDetails);
  try {
    const stored = window.localStorage.getItem(getFormExperienceDefaultsStorageKey(workspaceId));
    return normalizeFormExperienceDefaults(
      stored ? JSON.parse(stored) : null,
      legacyConfigurePdfDetails
    );
  } catch {
    return createDefaultFormExperienceDefaults(legacyConfigurePdfDetails);
  }
}

export function writeFormExperienceDefaults(
  workspaceId: string | null | undefined,
  value: FormExperienceDefaults
) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    getFormExperienceDefaultsStorageKey(workspaceId),
    JSON.stringify(normalizeFormExperienceDefaults(value))
  );
}
