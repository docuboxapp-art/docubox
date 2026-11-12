export interface DocumentRequirementCatalogItem {
  id: string;
  title: string;
  description: string;
  categories: string[];
  suggestedValidityDays?: number;
  instructions?: string;
  kind?: 'document';
  recommendedFormats?: string[];
  defaults?: { required: boolean; requiresReview: boolean; maxFiles: number; maxSizeMb: number };
  status?: 'active' | 'archived';
  origin?: 'docubox' | 'personal' | 'workspace';
}

export const documentRequirementCategories = [
  { id: 'identity', title: 'Identidad y datos personales' },
  { id: 'corporate', title: 'Corporativos y representación legal' },
  { id: 'tax', title: 'Fiscales y cumplimiento' },
  { id: 'banking', title: 'Bancarios y financieros' },
  { id: 'commercial', title: 'Contractuales y comerciales' },
  { id: 'labor', title: 'Laborales y recursos humanos' },
  { id: 'property', title: 'Inmobiliarios y patrimoniales' },
  { id: 'licenses', title: 'Licencias, permisos y certificaciones' },
] as const;

// A requirement may appear in several categories, but has one catalog identity.
const requirementSeeds: DocumentRequirementCatalogItem[] = [
  {
    id: 'official-id',
    title: 'Identificación oficial (INE o pasaporte)',
    description: 'Identificación vigente y legible.',
    categories: ['identity', 'corporate'],
  },
  {
    id: 'curp',
    title: 'CURP',
    description: 'Clave Única de Registro de Población.',
    categories: ['identity'],
  },
  {
    id: 'birth-certificate',
    title: 'Acta de nacimiento',
    description: 'Copia legible del acta de nacimiento.',
    categories: ['identity'],
  },
  {
    id: 'address-proof',
    title: 'Comprobante de domicilio',
    description: 'Comprobante reciente de domicilio.',
    categories: ['identity', 'property'],
    suggestedValidityDays: 90,
  },
  {
    id: 'tax-status',
    title: 'Constancia de situación fiscal (SAT)',
    description: 'Constancia fiscal emitida por el SAT.',
    categories: ['identity', 'tax', 'labor'],
  },
  {
    id: 'professional-license',
    title: 'Cédula profesional',
    description: 'Cédula profesional aplicable.',
    categories: ['identity'],
  },
  {
    id: 'migration-document',
    title: 'Documento migratorio',
    description: 'Documento migratorio vigente, cuando corresponda.',
    categories: ['identity'],
  },
  {
    id: 'residence-proof',
    title: 'Constancia de identidad o residencia',
    description: 'Constancia expedida por la autoridad correspondiente.',
    categories: ['identity'],
  },
  {
    id: 'articles-of-incorporation',
    title: 'Acta constitutiva',
    description: 'Documento constitutivo completo y legible.',
    categories: ['corporate'],
  },
  {
    id: 'corporate-amendments',
    title: 'Modificaciones estatutarias',
    description: 'Modificaciones vigentes de la sociedad.',
    categories: ['corporate'],
  },
  {
    id: 'power-of-attorney',
    title: 'Poder notarial del representante legal',
    description: 'Acreditación vigente de facultades.',
    categories: ['corporate'],
  },
  {
    id: 'trade-register',
    title: 'Inscripción en el Registro Público de Comercio',
    description: 'Constancia o folio de inscripción.',
    categories: ['corporate'],
  },
  {
    id: 'assembly-minutes',
    title: 'Acta de asamblea',
    description: 'Acta de la asamblea correspondiente.',
    categories: ['corporate'],
  },
  {
    id: 'shareholding',
    title: 'Estructura accionaria',
    description: 'Relación actual de accionistas.',
    categories: ['corporate'],
  },
  {
    id: 'beneficial-owners',
    title: 'Beneficiarios controladores',
    description: 'Documentación de beneficiarios controladores.',
    categories: ['corporate', 'tax'],
  },
  {
    id: 'sat-compliance',
    title: 'Opinión de cumplimiento SAT',
    description: 'Opinión fiscal aplicable y vigente.',
    categories: ['tax'],
  },
  {
    id: 'imss-compliance',
    title: 'Opinión de cumplimiento IMSS',
    description: 'Opinión de cumplimiento aplicable.',
    categories: ['tax'],
  },
  {
    id: 'infonavit-status',
    title: 'Constancia de situación fiscal INFONAVIT',
    description: 'Constancia aplicable y vigente.',
    categories: ['tax'],
  },
  {
    id: 'repse',
    title: 'Registro REPSE',
    description: 'Registro vigente cuando corresponda.',
    categories: ['tax'],
  },
  {
    id: 'tax-return-receipt',
    title: 'Acuse de declaración fiscal',
    description: 'Acuse correspondiente al periodo solicitado.',
    categories: ['tax'],
  },
  {
    id: 'rfc-registration',
    title: 'Inscripción al RFC',
    description: 'Comprobante de inscripción al RFC.',
    categories: ['tax'],
  },
  {
    id: 'bank-cover',
    title: 'Carátula bancaria',
    description: 'Debe mostrar banco, CLABE y titular.',
    categories: ['banking'],
  },
  {
    id: 'bank-statement',
    title: 'Estado de cuenta bancario',
    description: 'Estado de cuenta del periodo solicitado.',
    categories: ['banking'],
  },
  {
    id: 'clabe-proof',
    title: 'Constancia de CLABE interbancaria',
    description: 'Comprobante de CLABE y titularidad.',
    categories: ['banking'],
  },
  {
    id: 'financial-statements',
    title: 'Estados financieros',
    description: 'Estados financieros del periodo solicitado.',
    categories: ['banking'],
  },
  {
    id: 'bank-ownership',
    title: 'Carta de titularidad bancaria',
    description: 'Constancia o carta de titularidad.',
    categories: ['banking'],
  },
  {
    id: 'service-contract',
    title: 'Contrato de prestación de servicios',
    description: 'Contrato principal y anexos aplicables.',
    categories: ['commercial'],
  },
  {
    id: 'sale-contract',
    title: 'Contrato de compraventa',
    description: 'Contrato principal de compraventa.',
    categories: ['commercial'],
  },
  {
    id: 'nda',
    title: 'Convenio de confidencialidad',
    description: 'Convenio firmado, cuando corresponda.',
    categories: ['commercial'],
  },
  {
    id: 'amendment-agreement',
    title: 'Convenio modificatorio',
    description: 'Modificación al contrato principal.',
    categories: ['commercial'],
  },
  {
    id: 'commercial-proposal',
    title: 'Cotización o propuesta comercial',
    description: 'Propuesta comercial vigente.',
    categories: ['commercial'],
  },
  {
    id: 'purchase-order',
    title: 'Orden de compra',
    description: 'Orden de compra relacionada.',
    categories: ['commercial'],
  },
  {
    id: 'invoice',
    title: 'Factura o CFDI',
    description: 'Comprobante fiscal digital aplicable.',
    categories: ['commercial'],
  },
  {
    id: 'technical-annexes',
    title: 'Anexos técnicos y entregables',
    description: 'Anexos o entregables del contrato.',
    categories: ['commercial'],
  },
  {
    id: 'resume',
    title: 'Currículum vitae',
    description: 'Trayectoria de la persona.',
    categories: ['labor'],
  },
  {
    id: 'social-security',
    title: 'Número de Seguridad Social',
    description: 'Comprobante del NSS.',
    categories: ['labor'],
  },
  {
    id: 'education-proof',
    title: 'Comprobante de estudios',
    description: 'Certificado o título correspondiente.',
    categories: ['labor'],
  },
  {
    id: 'employment-certificates',
    title: 'Constancias laborales',
    description: 'Constancias de experiencia laboral.',
    categories: ['labor'],
  },
  {
    id: 'employment-contract',
    title: 'Contrato individual de trabajo',
    description: 'Contrato laboral correspondiente.',
    categories: ['labor'],
  },
  {
    id: 'labor-beneficiaries',
    title: 'Beneficiarios laborales',
    description: 'Documentación de beneficiarios laborales.',
    categories: ['labor'],
  },
  {
    id: 'property-deed',
    title: 'Escritura pública',
    description: 'Escritura que acredita la propiedad.',
    categories: ['property'],
  },
  {
    id: 'lien-free',
    title: 'Certificado de libertad de gravamen',
    description: 'Certificado vigente del inmueble.',
    categories: ['property'],
  },
  {
    id: 'property-tax',
    title: 'Boleta predial',
    description: 'Boleta predial correspondiente.',
    categories: ['property'],
  },
  {
    id: 'utility-proof',
    title: 'Comprobante de servicios',
    description: 'Recibo reciente de servicios.',
    categories: ['property'],
  },
  {
    id: 'appraisal',
    title: 'Avalúo inmobiliario',
    description: 'Avalúo del inmueble.',
    categories: ['property'],
  },
  {
    id: 'lease',
    title: 'Contrato de arrendamiento',
    description: 'Contrato de arrendamiento vigente.',
    categories: ['property'],
  },
  {
    id: 'business-license',
    title: 'Licencia de funcionamiento',
    description: 'Licencia vigente de la actividad.',
    categories: ['licenses'],
  },
  {
    id: 'operating-permit',
    title: 'Permiso de operación',
    description: 'Permiso aplicable a la operación.',
    categories: ['licenses'],
  },
  {
    id: 'sector-authorization',
    title: 'Autorización sectorial',
    description: 'Registro o autorización sectorial.',
    categories: ['licenses'],
  },
  {
    id: 'quality-certificate',
    title: 'Certificación de calidad',
    description: 'Certificación vigente aplicable.',
    categories: ['licenses'],
  },
  {
    id: 'training-certificate',
    title: 'Constancia de capacitación',
    description: 'Constancia de capacitación requerida.',
    categories: ['licenses'],
  },
  {
    id: 'insurance-policy',
    title: 'Póliza de seguro o responsabilidad civil',
    description: 'Póliza vigente y cobertura aplicable.',
    categories: ['licenses'],
  },
  {
    id: 'civil-protection',
    title: 'Dictamen de protección civil',
    description: 'Dictamen aplicable al inmueble o establecimiento.',
    categories: ['licenses', 'property'],
  },
  {
    id: 'environmental-permit',
    title: 'Autorización ambiental',
    description: 'Autorización ambiental correspondiente a la actividad.',
    categories: ['licenses'],
  },
  {
    id: 'credit-reference',
    title: 'Referencias comerciales',
    description: 'Referencias de la relación comercial del titular.',
    categories: ['commercial', 'banking'],
  },
  {
    id: 'employer-registration',
    title: 'Registro patronal',
    description: 'Comprobante de registro patronal ante el IMSS.',
    categories: ['labor', 'tax'],
  },
];

export const documentRequirementCatalog: DocumentRequirementCatalogItem[] = requirementSeeds.map(
  (item) => ({
    ...item,
    instructions:
      'Adjunta el documento completo y legible, incluyendo las páginas y anexos que correspondan.',
    kind: 'document',
    recommendedFormats: ['PDF', 'JPG', 'PNG'],
    defaults: { required: false, requiresReview: true, maxFiles: 1, maxSizeMb: 15 },
    status: 'active',
    origin: 'docubox',
  })
);

export const caseStageCatalog = [
  {
    key: 'opening',
    title: 'Apertura',
    description: 'Abrir el expediente y asignar responsables.',
    category: 'base',
  },
  {
    key: 'capture',
    title: 'Captura de información',
    description: 'Completar datos y formularios.',
    category: 'optional',
  },
  {
    key: 'documents',
    title: 'Carga documental',
    description: 'Recibir los documentos requeridos.',
    category: 'base',
  },
  {
    key: 'identity',
    title: 'Validación de identidad',
    description: 'Revisar los métodos de identidad configurados.',
    category: 'optional',
  },
  {
    key: 'automatic',
    title: 'Validación automática',
    description: 'Aplicar controles automáticos disponibles.',
    category: 'optional',
  },
  {
    key: 'compliance',
    title: 'Verificación de cumplimiento',
    description: 'Revisar controles fiscales o regulatorios configurados.',
    category: 'optional',
  },
  {
    key: 'review',
    title: 'Revisión documental',
    description: 'Aceptar o rechazar documentos.',
    category: 'base',
  },
  {
    key: 'correction',
    title: 'Subsanación',
    description: 'Atender observaciones cuando existan.',
    category: 'conditional',
  },
  {
    key: 'approval',
    title: 'Aprobación',
    description: 'Autorizar internamente el expediente.',
    category: 'optional',
  },
  {
    key: 'signature',
    title: 'Firma',
    description: 'Firmar los documentos aplicables.',
    category: 'optional',
  },
  {
    key: 'certification',
    title: 'Certificación',
    description: 'Aplicar servicios de certificación disponibles.',
    category: 'optional',
  },
  { key: 'closing', title: 'Cierre', description: 'Finalizar el expediente.', category: 'base' },
  {
    key: 'certificate',
    title: 'Constancia y entrega',
    description: 'Emitir constancia o comprobante configurado.',
    category: 'optional',
  },
  {
    key: 'renewal',
    title: 'Renovación',
    description: 'Iniciar un nuevo ciclo después del cierre.',
    category: 'post_close',
  },
] as const;

export const caseStageSuggestions = [
  { id: 'general', title: 'General', keys: ['opening', 'documents', 'review', 'closing'] },
  {
    id: 'supplier',
    title: 'Alta de proveedor',
    keys: [
      'opening',
      'capture',
      'documents',
      'identity',
      'compliance',
      'review',
      'approval',
      'closing',
    ],
  },
  {
    id: 'client',
    title: 'Alta de cliente',
    keys: ['opening', 'capture', 'documents', 'identity', 'approval', 'closing'],
  },
  {
    id: 'labor',
    title: 'Laboral',
    keys: ['opening', 'capture', 'documents', 'review', 'signature', 'closing'],
  },
  {
    id: 'contract',
    title: 'Contractual',
    keys: ['opening', 'documents', 'review', 'approval', 'signature', 'closing'],
  },
  {
    id: 'compliance',
    title: 'Cumplimiento',
    keys: ['opening', 'documents', 'compliance', 'review', 'approval', 'closing'],
  },
] as const;

export const caseVerificationCatalog = [
  {
    key: 'email_otp',
    title: 'Confirmación de correo por OTP',
    description: 'Confirma acceso al correo de la persona.',
  },
  {
    key: 'official_id',
    title: 'Identificación oficial',
    description: 'Solicita acreditamiento con una identificación.',
  },
  {
    key: 'selfie',
    title: 'Identificación con selfie',
    description: 'Vincula identificación y prueba visual cuando el servicio esté disponible.',
  },
  {
    key: 'tax',
    title: 'Validación fiscal configurable',
    description: 'Revisa datos fiscales con el servicio habilitado.',
  },
  {
    key: 'representative',
    title: 'Facultades del representante',
    description: 'Revisa la acreditación del representante legal.',
  },
] as const;
