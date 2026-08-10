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
  typography: 'sans' | 'serif';
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
  mode: 'scroll' | 'multistep';
  multiStep: boolean;
  language: string;
  expirationHours: number;
  redirectAfterSubmit?: string;
  allowSaveProgress: boolean;
  requiresSignature: boolean;
  allowedSignatureTypes: SignatureType[];
  requireOtp: boolean;
  pdfSchema: PdfSchema;
}

export interface FormTemplate {
  id?: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'paused' | 'closed' | 'archived';
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
    primaryColor: '#4F46E5',
    typography: 'sans',
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
    name: 'Formulario sin título',
    description: 'Recaba información y genera un documento listo para firma.',
    status: 'draft',
    schema: [],
    sections: [createDefaultSection()],
    settings: {
      mode: 'multistep',
      multiStep: true,
      language: 'es',
      expirationHours: 72,
      allowSaveProgress: true,
      requiresSignature: true,
      allowedSignatureTypes: ['efirma_sat', 'autografa_digital', 'click_sign'],
      requireOtp: true,
      pdfSchema: createDefaultPdfSchema(),
    },
  };
}

export function normalizeFormTemplate(input: Partial<FormTemplate>): FormTemplate {
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
      pdfSchema: {
        ...defaults.settings.pdfSchema,
        ...(input.settings?.pdfSchema || {}),
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
    clave_elector: 'Clave de elector', business_name: 'Razón social',
    fiscal_address: 'Domicilio fiscal', consentimiento: 'Consentimiento',
    declaration: 'Declaración bajo protesta', firma_efirma: 'e.firma SAT',
    firma_autografa: 'Firma autógrafa', firma_click: 'Click & Sign',
    signature_block: 'Bloque de firma', iniciales: 'Iniciales', imagen: 'Carga de imagen',
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
    date: new Date().toISOString().slice(0, 10), time: '10:30', currency: '$ 12,500.00 MXN',
    rfc: 'PELJ900101XXX', curp: 'PELJ900101HDFRPN09', nss: '12345678901',
    business_name: 'Empresa Ejemplo, S.A. de C.V.', fiscal_address: 'Av. Reforma 100, CDMX',
    yes_no: 'Sí', radio: field.options?.[0]?.label, select: field.options?.[0]?.label,
    checkbox: true, consentimiento: true, declaration: true, firma_click: true,
    firma_efirma: 'Certificado por validar', firma_autografa: 'Firma capturada',
    signature_block: 'Pendiente de firma', documento: 'documento-adjunto.pdf', imagen: 'imagen-adjunta.jpg',
  };
  return samples[field.type] ?? '—';
}
