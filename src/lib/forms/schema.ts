import { isFormTypography, type FormTypography } from '../typography/font-families.ts';

export type SignatureType = 'efirma_sat' | 'autografa_digital' | 'click_sign';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'time'
  | 'currency'
  | 'checkbox'
  | 'checkbox_group'
  | 'radio'
  | 'select'
  | 'yes_no'
  | 'estado_mx'
  | 'rfc'
  | 'curp'
  | 'nss'
  | 'clave_elector'
  | 'business_name'
  | 'fiscal_address'
  | 'person_first_name'
  | 'person_last_name'
  | 'person_second_last_name'
  | 'consentimiento'
  | 'declaration'
  | 'firma_efirma'
  | 'firma_autografa'
  | 'firma_click'
  | 'signature_block'
  | 'iniciales'
  | 'imagen'
  | 'documento'
  | 'divider'
  | 'texto_bloque'
  | 'imagen_estatica'
  | 'columnas';

export interface FieldOption {
  label: string;
  value: string;
}

export interface ConditionalRule {
  fieldId: string;
  operator: 'eq' | 'neq' | 'contains' | 'empty' | 'not_empty';
  value: string;
  action?: 'show' | 'hide' | 'require' | 'go_to_section' | 'enable_signature';
}

export interface PdfMapping {
  x: number;
  y: number;
  page: number;
  fontSize: number;
  color: string;
}

export interface FieldPdfConfig {
  show: boolean;
  sectionId?: string;
  label?: string;
  order?: number;
  pageBreakBefore?: boolean;
}

export interface SignatureBlockConfig {
  signerRole: string;
  allowedTypes: SignatureType[];
  requireOtp: boolean;
  requireEvidence: boolean;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  slug: string;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  required: boolean;
  readOnly: boolean;
  editableBeforeSign?: boolean;
  conditionalVisible: boolean;
  conditionalRule?: ConditionalRule;
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  regex?: string;
  regexError?: string;
  options?: FieldOption[];
  assignedTo?: 'signer1' | 'signer2' | 'all' | 'any';
  pdf?: FieldPdfConfig;
  pdfMapping?: PdfMapping;
  signature?: SignatureBlockConfig;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  sectionId?: string;
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  order: number;
  collapsed: boolean;
  fieldIds: string[];
  conditionalRule?: ConditionalRule;
  showInPdf: boolean;
  pageBreakBefore: boolean;
}

export interface PdfSchema {
  version: number;
  logoUrl?: string;
  header: string;
  footer: string;
  primaryColor: string;
  typography: FormTypography;
  orientation: 'portrait' | 'landscape';
  margins: 'normal' | 'narrow' | 'wide';
  headerAlignment: 'left' | 'center' | 'right';
  columns: 'one' | 'two';
  showSectionNumbers: boolean;
  showDescription: boolean;
  pageSize: 'letter' | 'a4';
  showPageNumbers: boolean;
  showFolio: boolean;
  showDate: boolean;
  showRespondentEmail: boolean;
  showIp: boolean;
  showQr: boolean;
  showHash: boolean;
  showAuditTrail: boolean;
  showEvidenceSheet: boolean;
  showAttachments: boolean;
  showUnanswered: boolean;
  coverPage: boolean;
  consentPage: boolean;
}

export interface FormSettings {
  accessMode: 'private' | 'public';
  documentNumber: string;
  documentTypeId: string;
  documentTypeName: string;
  tagIds: string[];
  configurePdfDetails: boolean;
  configureFormDetails: boolean;
  appearance: FormAppearance;
  mode: 'scroll' | 'multistep';
  multiStep: boolean;
  language: string;
  configureLinkExpiration: boolean;
  expirationHours: number;
  redirectAfterSubmit?: string;
  allowSaveProgress: boolean;
  requiresSignature: boolean;
  allowedSignatureTypes: SignatureType[];
  requireOtp: boolean;
  pdfSchema: PdfSchema;
}

export interface FormAppearance {
  accentColor: string;
  backgroundColor: string;
  headerText: string;
  headerDescription: string;
  headerDocumentNumber: string;
  headerDocumentTypeName: string;
  headerAlignment: 'left' | 'center' | 'right';
  footerText: string;
  footerAlignment: 'left' | 'center' | 'right';
  confirmationMessage: string;
  showHeader: boolean;
  showTitle: boolean;
  showFooter: boolean;
  showProgressBar: boolean;
  showAccentBar: boolean;
  showDescription: boolean;
  showDocumentNumber: boolean;
  showDocumentType: boolean;
  showSectionDescriptions: boolean;
  width: 'standard' | 'wide';
  typography: FormTypography;
  showSectionNumbers: boolean;
  compactSpacing: boolean;
}

export function createDefaultFormAppearance(): FormAppearance {
  return {
    accentColor: '#1E6BFF',
    backgroundColor: '#F8F8FB',
    headerText: '',
    headerDescription: '',
    headerDocumentNumber: '',
    headerDocumentTypeName: '',
    headerAlignment: 'left',
    footerText: 'Formulario creado con Docubox',
    footerAlignment: 'center',
    confirmationMessage: '',
    showHeader: true,
    showTitle: true,
    showFooter: false,
    showProgressBar: true,
    showAccentBar: true,
    showDescription: true,
    showDocumentNumber: true,
    showDocumentType: true,
    showSectionDescriptions: true,
    width: 'standard',
    typography: 'sans',
    showSectionNumbers: true,
    compactSpacing: false,
  };
}

export interface FormTemplate {
  id?: string;
  rootTemplateId?: string;
  sourceTemplateId?: string;
  versionNumber?: number;
  revisionNumber?: number;
  publicationComment?: string;
  publishedAt?: string;
  updatedAt?: string;
  name: string;
  description: string;
  status: 'draft' | 'in_review' | 'published' | 'paused' | 'archived';
  schema: FormField[];
  sections: FormSection[];
  settings: FormSettings;
  pdfBasePath?: string;
  workspaceId?: string;
}

export const DEFAULT_SECTION_ID = 'section-general';

export function createDefaultPdfSchema(): PdfSchema {
  return {
    version: 1,
    header: 'DOCUBOX · FORMULARIO FIRMABLE',
    footer: 'Documento generado electrónicamente por Docubox',
    primaryColor: '#1E6BFF',
    typography: 'sans',
    orientation: 'portrait',
    margins: 'normal',
    headerAlignment: 'left',
    columns: 'two',
    showSectionNumbers: true,
    showDescription: true,
    pageSize: 'letter',
    showPageNumbers: true,
    showFolio: true,
    showDate: true,
    showRespondentEmail: true,
    showIp: true,
    showQr: true,
    showHash: true,
    showAuditTrail: true,
    showEvidenceSheet: true,
    showAttachments: true,
    showUnanswered: false,
    coverPage: false,
    consentPage: false,
  };
}

export function createDefaultSection(order = 0, title = 'Datos generales'): FormSection {
  return {
    id: order === 0 ? DEFAULT_SECTION_ID : crypto.randomUUID(),
    title,
    description: order === 0 ? 'Información principal del participante.' : '',
    order,
    collapsed: false,
    fieldIds: [],
    showInPdf: true,
    pageBreakBefore: order > 0,
  };
}

export function createDefaultFormTemplate(): FormTemplate {
  return {
    name: '',
    description: '',
    status: 'draft',
    schema: [],
    sections: [createDefaultSection()],
    settings: {
      accessMode: 'private',
      documentNumber: '',
      documentTypeId: '',
      documentTypeName: '',
      tagIds: [],
      configurePdfDetails: false,
      configureFormDetails: false,
      appearance: createDefaultFormAppearance(),
      mode: 'multistep',
      multiStep: true,
      language: 'es',
      configureLinkExpiration: false,
      expirationHours: 72,
      allowSaveProgress: true,
      requiresSignature: true,
      allowedSignatureTypes: [],
      requireOtp: false,
      pdfSchema: createDefaultPdfSchema(),
    },
  };
}

export function normalizeFormTemplate(input: Partial<Omit<FormTemplate, 'settings'>> & { settings?: Partial<Omit<FormSettings, 'pdfSchema' | 'appearance'>> & { pdfSchema?: Partial<PdfSchema>; appearance?: Partial<FormAppearance> } }): FormTemplate {
  const defaults = createDefaultFormTemplate();
  const sections = Array.isArray(input.sections) && input.sections.length
    ? input.sections.map((section, index) => ({
        ...createDefaultSection(index, section.title || `Sección ${index + 1}`),
        ...section,
        order: index,
      }))
    : defaults.sections;

  return {
    ...defaults,
    ...input,
    schema: Array.isArray(input.schema)
      ? input.schema.map((field, index) => ({
          ...field,
          required: field.type === 'signature_block' ? true : field.required,
          conditionalVisible: field.type === 'signature_block' ? false : field.conditionalVisible,
          conditionalRule: field.type === 'signature_block' ? undefined : field.conditionalRule,
          label: field.type === 'business_name' && field.label === 'Razón social'
            ? 'Nombre o denominación social'
            : field.type === 'fiscal_address' && field.label === 'Domicilio fiscal'
              ? 'Domicilio'
              : field.label,
          sectionId: field.sectionId || sections[0].id,
          editableBeforeSign: field.editableBeforeSign ?? true,
          pdf: {
            show: field.pdf?.show ?? true,
            sectionId: field.pdf?.sectionId || field.sectionId || sections[0].id,
            label: field.pdf?.label || field.label,
            order: field.pdf?.order ?? index,
            pageBreakBefore: field.pdf?.pageBreakBefore ?? false,
          },
        }))
      : [],
    sections,
    settings: {
      ...defaults.settings,
      ...(input.settings || {}),
      accessMode: input.settings?.accessMode === 'public' ? 'public' : 'private',
      requiresSignature: true,
      configurePdfDetails:
        typeof input.settings?.configurePdfDetails === 'boolean'
          ? input.settings.configurePdfDetails
          : Boolean(input.id),
      configureFormDetails: input.settings?.configureFormDetails === true,
      configureLinkExpiration:
        typeof input.settings?.configureLinkExpiration === 'boolean'
          ? input.settings.configureLinkExpiration
          : false,
      appearance: {
        ...defaults.settings.appearance,
        ...(input.settings?.appearance || {}),
        headerText: input.settings?.appearance?.headerText === 'Formulario firmable'
          ? '' : input.settings?.appearance?.headerText ?? defaults.settings.appearance.headerText,
        headerDocumentNumber: input.settings?.appearance?.headerDocumentNumber || input.settings?.documentNumber || '',
        headerDocumentTypeName: input.settings?.appearance?.headerDocumentTypeName || input.settings?.documentTypeName || '',
        typography: isFormTypography(input.settings?.appearance?.typography)
          ? input.settings!.appearance!.typography
          : defaults.settings.appearance.typography,
        accentColor: /^#[0-9a-fA-F]{6}$/.test(input.settings?.appearance?.accentColor || '')
          ? (input.settings!.appearance!.accentColor!.toUpperCase() === '#4F46E5' ? '#1E6BFF' : input.settings!.appearance!.accentColor!)
          : defaults.settings.appearance.accentColor,
        backgroundColor: /^#[0-9a-fA-F]{6}$/.test(input.settings?.appearance?.backgroundColor || '')
          ? input.settings!.appearance!.backgroundColor!
          : defaults.settings.appearance.backgroundColor,
      },
      tagIds: Array.isArray(input.settings?.tagIds) ? input.settings.tagIds : [],
      pdfSchema: {
        ...defaults.settings.pdfSchema,
        ...(input.settings?.pdfSchema || {}),
        typography: isFormTypography(input.settings?.pdfSchema?.typography)
          ? input.settings!.pdfSchema!.typography
          : defaults.settings.pdfSchema.typography,
        primaryColor: input.settings?.pdfSchema?.primaryColor?.toUpperCase() === '#4F46E5' ? '#1E6BFF' : input.settings?.pdfSchema?.primaryColor || defaults.settings.pdfSchema.primaryColor,
      },
      allowedSignatureTypes:
        input.settings?.allowedSignatureTypes || defaults.settings.allowedSignatureTypes,
    },
  };
}

export function getFieldTypeLabel(type: FieldType): string {
  const labels: Record<FieldType, string> = {
    text: 'Texto corto', textarea: 'Texto largo', email: 'Correo', phone: 'Teléfono',
    number: 'Número', date: 'Fecha', time: 'Hora', currency: 'Moneda', checkbox: 'Checkbox',
    checkbox_group: 'Casillas', radio: 'Opción múltiple', select: 'Lista desplegable',
    yes_no: 'Sí / No', estado_mx: 'Estado', rfc: 'RFC', curp: 'CURP', nss: 'NSS',
    clave_elector: 'Clave de elector', business_name: 'Nombre o denominación social',
    fiscal_address: 'Domicilio', person_first_name: 'Nombre',
    person_last_name: 'Apellido paterno', person_second_last_name: 'Apellido materno',
    consentimiento: 'Consentimiento',
    declaration: 'Declaración bajo protesta', firma_efirma: 'e.firma SAT',
    firma_autografa: 'Firma autógrafa', firma_click: 'Click & Sign',
    signature_block: 'Firma', iniciales: 'Iniciales', imagen: 'Carga de imagen',
    documento: 'Carga de archivo', divider: 'Separador', texto_bloque: 'Texto informativo',
    imagen_estatica: 'Imagen estática', columnas: 'Columnas',
  };
  return labels[type];
}

export function getSignatureTypeLabel(type: SignatureType): string {
  return {
    efirma_sat: 'e.firma SAT',
    autografa_digital: 'Firma autógrafa digital',
    click_sign: 'Click & Sign',
  }[type];
}

export function sampleValueForField(field: FormField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  const samples: Partial<Record<FieldType, unknown>> = {
    text: 'Juan Pérez López', textarea: 'Información proporcionada por el participante.',
    email: 'participante@ejemplo.com', phone: '55 1234 5678', number: '1250',
    date: new Date().toISOString().slice(0, 10), time: '10:30', currency: '12500',
    rfc: 'PELJ900101XXX', curp: 'PELJ900101HDFRPN09', nss: '12345678901',
    business_name: 'Empresa Ejemplo, S.A. de C.V.',
    fiscal_address: { street: 'Av. Reforma', exteriorNumber: '100', interiorNumber: '', neighborhood: 'Centro', city: 'Ciudad de México', state: 'Ciudad de México' },
    person_first_name: 'Juan', person_last_name: 'Pérez', person_second_last_name: 'López',
    yes_no: 'Sí', radio: field.options?.[0]?.label, select: field.options?.[0]?.label,
    checkbox: true, consentimiento: true, declaration: true, firma_click: true,
    firma_efirma: 'Certificado por validar', firma_autografa: 'Firma capturada',
    signature_block: 'Pendiente de firma', documento: 'documento-adjunto.pdf', imagen: 'imagen-adjunta.jpg',
  };
  return samples[field.type] ?? '—';
}

export function formatFormAddress(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const address = value as Record<string, unknown>;
  const part = (key: string) => typeof address[key] === 'string' ? String(address[key]).trim() : '';
  return [
    [part('street'), part('exteriorNumber'), part('interiorNumber') && `Int. ${part('interiorNumber')}`].filter(Boolean).join(' '),
    part('neighborhood'), part('city'), part('state'),
  ].filter(Boolean).join(', ');
}
