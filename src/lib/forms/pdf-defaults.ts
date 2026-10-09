import { createDefaultPdfSchema, type PdfSchema } from './schema';
import { normalizeFormPageSize } from './pdf-page-sizes';
import { isFormTypography } from '@/lib/typography/font-families';

export interface FormPdfDefaults {
  configurePdfDetails: boolean;
  pdfSchema: PdfSchema;
}

export const PDF_CONTENT_OPTIONS = [
  ['coverPage', 'Portada'],
  ['showPageNumbers', 'Numeración de páginas'],
  ['showFolio', 'Folio único'],
  ['showDate', 'Fecha de generación'],
  ['showRespondentEmail', 'Correo del participante'],
  ['showIp', 'Dirección IP'],
  ['showQr', 'QR de validación'],
  ['showHash', 'SHA-256 de respuestas'],
  ['showAttachments', 'Anexos'],
  ['showAuditTrail', 'Bitácora'],
  ['showEvidenceSheet', 'Hoja de evidencia legal'],
  ['consentPage', 'Hoja de consentimiento'],
] as const satisfies ReadonlyArray<readonly [keyof PdfSchema, string]>;

export function createDefaultFormPdfDefaults(): FormPdfDefaults {
  return { configurePdfDetails: false, pdfSchema: createDefaultPdfSchema() };
}

export function normalizeFormPdfDefaults(value: unknown): FormPdfDefaults {
  const defaults = createDefaultFormPdfDefaults();
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<FormPdfDefaults>;
  const source: Partial<PdfSchema> =
    candidate.pdfSchema && typeof candidate.pdfSchema === 'object' ? candidate.pdfSchema : {};
  const pdfSchema: PdfSchema = {
    ...defaults.pdfSchema,
    header:
      typeof source.header === 'string' ? source.header.slice(0, 500) : defaults.pdfSchema.header,
    footer:
      typeof source.footer === 'string' ? source.footer.slice(0, 500) : defaults.pdfSchema.footer,
    primaryColor:
      typeof source.primaryColor === 'string' && /^#[0-9a-f]{6}$/i.test(source.primaryColor)
        ? (source.primaryColor.toUpperCase() === '#4F46E5' ? '#1E6BFF' : source.primaryColor)
        : defaults.pdfSchema.primaryColor,
    pageSize: normalizeFormPageSize(source.pageSize),
    typography: isFormTypography(source.typography) ? source.typography : defaults.pdfSchema.typography,
    orientation: source.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: source.margins === 'narrow' || source.margins === 'wide' ? source.margins : 'normal',
    headerAlignment: source.headerAlignment === 'center' || source.headerAlignment === 'right' ? source.headerAlignment : 'left',
    columns: source.columns === 'one' ? 'one' : 'two',
  };
  if (typeof source.logoUrl === 'string') pdfSchema.logoUrl = source.logoUrl;
  for (const [key] of PDF_CONTENT_OPTIONS) {
    pdfSchema[key] = typeof source[key] === 'boolean' ? source[key] : defaults.pdfSchema[key];
  }
  for (const key of ['showUnanswered', 'showSectionNumbers', 'showDescription'] as const) {
    pdfSchema[key] = typeof source[key] === 'boolean' ? source[key] : defaults.pdfSchema[key];
  }
  return {
    configurePdfDetails: candidate.configurePdfDetails === true,
    pdfSchema,
  };
}

export function getFormPdfDefaultsStorageKey(workspaceId?: string | null) {
  return `docubox_form_pdf_defaults_${workspaceId || 'personal'}`;
}

export function readFormPdfDefaults(workspaceId?: string | null): FormPdfDefaults {
  if (typeof window === 'undefined') return createDefaultFormPdfDefaults();
  try {
    const stored = window.localStorage.getItem(getFormPdfDefaultsStorageKey(workspaceId));
    return stored ? normalizeFormPdfDefaults(JSON.parse(stored)) : createDefaultFormPdfDefaults();
  } catch {
    return createDefaultFormPdfDefaults();
  }
}

export function writeFormPdfDefaults(
  workspaceId: string | null | undefined,
  value: FormPdfDefaults
) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    getFormPdfDefaultsStorageKey(workspaceId),
    JSON.stringify(normalizeFormPdfDefaults(value))
  );
}
