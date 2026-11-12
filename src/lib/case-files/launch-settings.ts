import { isSupportedTimeZone } from '@/lib/datetime';

export const caseSignatureLabels = {
  click_sign: 'Click & Sign',
  autografa_digital: 'Firma autógrafa digital',
  efirma_sat: 'e.firma SAT',
} as const;
export type CaseSignatureType = keyof typeof caseSignatureLabels;
export type CaseLaunchSettings = {
  accessMode: 'private' | 'public';
  signatureType: CaseSignatureType;
  requireLiveness: boolean;
  expirationHours: number;
  scheduledAt: string | null;
  timezone: string;
  subjectPrefill?: Record<string, string>;
};
export const defaultCaseLaunchSettings: CaseLaunchSettings = {
  accessMode: 'private',
  signatureType: 'autografa_digital',
  requireLiveness: false,
  expirationHours: 168,
  scheduledAt: null,
  timezone: 'America/Mazatlan',
};
export function normalizeCaseLaunchSettings(raw: unknown, now = Date.now()): CaseLaunchSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Revisa la configuración del lanzamiento.');
  const v = raw as Record<string, unknown>;
  if (!['private', 'public'].includes(String(v.accessMode)))
    throw new Error('Selecciona el tipo de acceso.');
  if (!Object.hasOwn(caseSignatureLabels, String(v.signatureType)))
    throw new Error('Selecciona el tipo de firma.');
  if (typeof v.requireLiveness !== 'boolean')
    throw new Error('Revisa la opción de prueba de vida.');
  if (
    typeof v.expirationHours !== 'number' ||
    !Number.isFinite(v.expirationHours) ||
    v.expirationHours < 1 / 60 ||
    v.expirationHours > 720
  )
    throw new Error('La vigencia debe estar entre 1 minuto y 720 horas.');
  if (typeof v.timezone !== 'string' || !isSupportedTimeZone(v.timezone))
    throw new Error('Selecciona una zona horaria válida.');
  if (v.scheduledAt && Number.isNaN(Date.parse(String(v.scheduledAt))))
    throw new Error('Indica una fecha y hora válidas.');
  const scheduledAt = v.scheduledAt ? new Date(String(v.scheduledAt)).toISOString() : null;
  if (
    scheduledAt &&
    (Date.parse(scheduledAt) <= now + 60000 || Date.parse(scheduledAt) > now + 365 * 86400000)
  )
    throw new Error('Selecciona una fecha futura válida, dentro del próximo año.');
  return {
    accessMode: v.accessMode as CaseLaunchSettings['accessMode'],
    signatureType: v.signatureType as CaseSignatureType,
    requireLiveness: v.accessMode === 'public' || v.requireLiveness,
    expirationHours: v.expirationHours,
    scheduledAt,
    timezone: v.timezone,
    subjectPrefill:
      v.subjectPrefill && typeof v.subjectPrefill === 'object' && !Array.isArray(v.subjectPrefill)
        ? Object.fromEntries(
            [
              'nombre',
              'apellido_paterno',
              'apellido_materno',
              'full_name',
              'phone',
              'rfc',
              'curp',
              'personalidad_juridica',
              'business_name',
            ].map((k) => [
              k,
              typeof (v.subjectPrefill as Record<string, unknown>)[k] === 'string'
                ? String((v.subjectPrefill as Record<string, unknown>)[k])
                    .trim()
                    .slice(0, 160)
                : '',
            ])
          )
        : {},
  };
}
