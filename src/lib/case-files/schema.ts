export type CaseFileStatus =
  | 'draft'
  | 'open'
  | 'integrating'
  | 'in_review'
  | 'observed'
  | 'ready_to_sign'
  | 'signing'
  | 'signed'
  | 'ready_to_close'
  | 'sealed'
  | 'reopened'
  | 'cancelled';

export type TrafficLight = 'green' | 'amber' | 'red' | 'gray';
export type CasePriority = 'low' | 'normal' | 'high' | 'urgent';
export type CaseSensitivity = 'standard' | 'confidential' | 'highly_confidential';
export type MilestoneStatus = 'pending' | 'in_progress' | 'blocked' | 'observed' | 'completed' | 'overdue' | 'cancelled';
export type RequirementStatus = 'pending' | 'uploaded' | 'in_review' | 'approved' | 'observed' | 'expired';
export type SignatureFlow = 'sequential' | 'parallel' | 'mixed' | 'conditional';

export interface CaseFileSummary {
  id: string;
  folio: string;
  title: string;
  caseType: string;
  caseSubtype?: string;
  participant: string;
  responsible: string;
  status: CaseFileStatus;
  progress: number;
  priority: CasePriority;
  sensitivity: CaseSensitivity;
  pendingItems: number;
  openObservations: number;
  targetCloseAt?: string;
  lastActivityAt: string;
}

export interface CaseParticipant {
  id: string;
  name: string;
  role: string;
  email: string;
  rfc?: string;
  accessMethod: 'secure_link_otp' | 'email' | 'docubox_account';
  status: 'pending' | 'invited' | 'active' | 'completed';
}

export interface CaseRequirement {
  id: string;
  name: string;
  description: string;
  category: 'attachment' | 'signed' | 'generated';
  required: boolean;
  allowedFormats: string[];
  maxSizeMb: number;
  requiresReview: boolean;
  requiresSignature: boolean;
  requiresIdentity: boolean;
  status: RequirementStatus;
  uploadedAt?: string;
  expiresAt?: string;
  hash?: string;
  rejectionReason?: string;
  correctionAction?: string;
}

export interface CaseFormLink {
  id: string;
  templateId?: string;
  name: string;
  assignee: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'observed' | 'corrected' | 'approved' | 'locked';
  requiresSignature: boolean;
  pdfGenerated: boolean;
  updatedAt?: string;
}

export interface CaseIdentityCheck {
  id: string;
  person: string;
  method: string;
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'manual_review' | 'expired';
  verifiedAt?: string;
  result?: string;
}

export interface CaseMilestone {
  id: string;
  title: string;
  description: string;
  responsible: string;
  condition: string;
  status: MilestoneStatus;
  dueDate?: string;
  completedAt?: string;
}

export interface CaseSignature {
  id: string;
  documentName: string;
  signer: string;
  type: 'efirma' | 'autograph' | 'click_sign' | 'otp';
  flow: SignatureFlow;
  status: 'pending' | 'sent' | 'viewed' | 'signed' | 'rejected' | 'expired' | 'cancelled';
  sentAt?: string;
  signedAt?: string;
  hash?: string;
}

export interface CaseObservation {
  id: string;
  target: string;
  reason: string;
  message: string;
  correctionAction: string;
  responsible: string;
  status: 'open' | 'corrected' | 'resolved';
  dueDate?: string;
  createdAt: string;
}

export interface CaseAuditEvent {
  id: string;
  action: string;
  actor: string;
  result: 'success' | 'warning' | 'failure';
  object: string;
  occurredAt: string;
  ip?: string;
  hash: string;
}

export interface ClosureRule {
  id: string;
  label: string;
  required: boolean;
  satisfied: boolean;
  action?: string;
}

export interface CaseFileDetail extends CaseFileSummary {
  description: string;
  responsibleArea: string;
  openedAt: string;
  participants: CaseParticipant[];
  requirements: CaseRequirement[];
  forms: CaseFormLink[];
  identityChecks: CaseIdentityCheck[];
  milestones: CaseMilestone[];
  signatures: CaseSignature[];
  observations: CaseObservation[];
  auditEvents: CaseAuditEvent[];
  closureRules: ClosureRule[];
  rootHash?: string;
  manifestStatus: 'pending' | 'ready' | 'sealed';
  certificateStatus: 'pending' | 'generated';
}

export interface CaseTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  requirements: Array<Omit<CaseRequirement, 'id' | 'status'>>;
  identityMethods: string[];
  milestones: Array<Omit<CaseMilestone, 'id' | 'status'>>;
  closureRuleLabels: string[];
}

export const CASE_STATUS_META: Record<CaseFileStatus, { label: string; tone: TrafficLight; description: string }> = {
  draft: { label: 'Borrador', tone: 'gray', description: 'La apertura aún no se confirma.' },
  open: { label: 'Abierto', tone: 'amber', description: 'El expediente fue abierto formalmente.' },
  integrating: { label: 'En integración', tone: 'amber', description: 'Faltan documentos, formularios o identidad.' },
  in_review: { label: 'En revisión', tone: 'amber', description: 'El equipo está validando la información recibida.' },
  observed: { label: 'Observado', tone: 'red', description: 'Existen correcciones accionables pendientes.' },
  ready_to_sign: { label: 'Listo para firma', tone: 'green', description: 'La integración terminó y puede iniciar la firma.' },
  signing: { label: 'En firma', tone: 'amber', description: 'Hay documentos pendientes de firma.' },
  signed: { label: 'Firmado', tone: 'green', description: 'Los documentos principales ya fueron firmados.' },
  ready_to_close: { label: 'Listo para cierre', tone: 'green', description: 'Se cumplen las condiciones para sellar.' },
  sealed: { label: 'Cerrado herméticamente', tone: 'green', description: 'El contenido está bloqueado y verificable.' },
  reopened: { label: 'Reabierto por excepción', tone: 'red', description: 'Reapertura autorizada y auditada.' },
  cancelled: { label: 'Cancelado', tone: 'gray', description: 'El expediente fue cancelado antes del cierre.' },
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  pending: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueado', observed: 'Observado',
  completed: 'Completado', overdue: 'Vencido', cancelled: 'Cancelado',
};

const requirementDefaults = { allowedFormats: ['PDF', 'JPG', 'PNG'], maxSizeMb: 15, requiresReview: true, requiresSignature: false, requiresIdentity: false };

export const CASE_TEMPLATES: CaseTemplate[] = [
  {
    id: 'supplier-company',
    name: 'Alta de proveedor · Persona moral',
    type: 'Proveedor',
    description: 'Integración fiscal, corporativa, bancaria y contractual de proveedores nacionales.',
    requirements: [
      ['Acta constitutiva', 'Documento constitutivo completo y legible.'],
      ['Poder del representante legal', 'Poder vigente de quien representa a la empresa.'],
      ['Identificación oficial', 'INE o pasaporte vigente del representante.'],
      ['Constancia de situación fiscal', 'Documento emitido por el SAT.'],
      ['Opinión de cumplimiento', 'Opinión positiva y vigente.'],
      ['Comprobante de domicilio', 'Antigüedad no mayor a tres meses.'],
      ['Carátula bancaria', 'Debe mostrar banco, CLABE y titular.'],
    ].map(([name, description]) => ({ name, description, category: 'attachment' as const, required: true, ...requirementDefaults })),
    identityMethods: ['OTP por correo', 'INE + selfie', 'RFC / SAT', 'Representante legal'],
    milestones: defaultMilestoneBlueprints(),
    closureRuleLabels: defaultClosureLabels(),
  },
  {
    id: 'contractual', name: 'Expediente contractual', type: 'Contractual',
    description: 'Contrato principal, anexos, acreditamiento de firmantes y evidencia de firma.',
    requirements: [
      { name: 'Contrato principal', description: 'Documento principal sujeto a firma.', category: 'signed', required: true, ...requirementDefaults, requiresSignature: true, requiresIdentity: true },
      { name: 'Identificación de firmantes', description: 'Identificación vigente de cada firmante.', category: 'attachment', required: true, ...requirementDefaults, requiresIdentity: true },
      { name: 'Anexos', description: 'Anexos técnicos o comerciales aplicables.', category: 'attachment', required: false, ...requirementDefaults },
    ],
    identityMethods: ['OTP por correo', 'Identificación oficial'], milestones: defaultMilestoneBlueprints(), closureRuleLabels: defaultClosureLabels(),
  },
  {
    id: 'client-onboarding', name: 'Onboarding de cliente', type: 'Cliente',
    description: 'Conocimiento del cliente, identidad, información fiscal y contratos.',
    requirements: [
      { name: 'Identificación oficial', description: 'Documento vigente y legible.', category: 'attachment', required: true, ...requirementDefaults, requiresIdentity: true },
      { name: 'Constancia fiscal', description: 'Constancia de situación fiscal vigente.', category: 'attachment', required: true, ...requirementDefaults },
      { name: 'Comprobante de domicilio', description: 'Antigüedad no mayor a tres meses.', category: 'attachment', required: true, ...requirementDefaults },
    ],
    identityMethods: ['OTP por correo', 'INE + selfie', 'CURP / RENAPO'], milestones: defaultMilestoneBlueprints(), closureRuleLabels: defaultClosureLabels(),
  },
];

function defaultMilestoneBlueprints(): Array<Omit<CaseMilestone, 'id' | 'status'>> {
  return [
    { title: 'Apertura', description: 'Crear expediente e invitar participantes.', responsible: 'Responsable interno', condition: 'Expediente abierto' },
    { title: 'Carga documental', description: 'Recibir todos los documentos obligatorios.', responsible: 'Invitado', condition: '100% de requisitos cargados' },
    { title: 'Validación de identidad', description: 'Acreditar identidad de los participantes.', responsible: 'Sistema / analista', condition: 'Identidad aprobada' },
    { title: 'Revisión documental', description: 'Aprobar documentos y resolver observaciones.', responsible: 'Revisor', condition: 'Documentos aprobados' },
    { title: 'Firma', description: 'Firmar documentos principales.', responsible: 'Firmantes', condition: 'Firmas completadas' },
    { title: 'Cierre', description: 'Validar y sellar el expediente.', responsible: 'Responsable interno', condition: 'Reglas de cierre cumplidas' },
    { title: 'Constancia', description: 'Emitir constancia verificable.', responsible: 'Sistema', condition: 'Constancia emitida' },
  ];
}

function defaultClosureLabels() {
  return [
    'Documentos obligatorios aprobados', 'Formularios completados', 'Identidad acreditada',
    'Documentos principales firmados', 'Evidencia de firma generada', 'Hitos completados',
    'Sin observaciones abiertas', 'Sin documentos vencidos', 'Manifest preparado', 'Constancia de cierre emitida',
  ];
}

const now = '2026-08-02T18:40:00-06:00';

export const DEMO_CASE_FILES: CaseFileSummary[] = [
  { id: 'demo-supplier', folio: 'EXP-2026-000184', title: 'Alta de proveedor · Constructora del Norte', caseType: 'Proveedor', caseSubtype: 'Persona moral nacional', participant: 'Constructora del Norte, S.A. de C.V.', responsible: 'Luis Alberto Hernández', status: 'in_review', progress: 78, priority: 'high', sensitivity: 'confidential', pendingItems: 3, openObservations: 1, targetCloseAt: '2026-08-15', lastActivityAt: now },
  { id: 'demo-contract', folio: 'EXP-2026-000183', title: 'Contrato marco · Soluciones Industriales MX', caseType: 'Contractual', participant: 'Soluciones Industriales MX', responsible: 'Ana Martínez', status: 'signing', progress: 88, priority: 'normal', sensitivity: 'confidential', pendingItems: 1, openObservations: 0, targetCloseAt: '2026-08-08', lastActivityAt: '2026-08-02T16:10:00-06:00' },
  { id: 'demo-client', folio: 'EXP-2026-000179', title: 'Onboarding · Grupo Álamo', caseType: 'Cliente', participant: 'Grupo Álamo', responsible: 'Luis Alberto Hernández', status: 'observed', progress: 54, priority: 'urgent', sensitivity: 'highly_confidential', pendingItems: 5, openObservations: 2, targetCloseAt: '2026-08-05', lastActivityAt: '2026-08-01T13:20:00-06:00' },
  { id: 'demo-sealed', folio: 'EXP-2026-000171', title: 'Renovación contractual · Logística del Pacífico', caseType: 'Contractual', participant: 'Logística del Pacífico', responsible: 'Ana Martínez', status: 'sealed', progress: 100, priority: 'normal', sensitivity: 'standard', pendingItems: 0, openObservations: 0, targetCloseAt: '2026-07-30', lastActivityAt: '2026-07-30T18:05:00-06:00' },
];

export function createDemoCaseFile(id = 'demo-supplier'): CaseFileDetail {
  const summary = DEMO_CASE_FILES.find((item) => item.id === id) || DEMO_CASE_FILES[0];
  return {
    ...summary,
    description: 'Integración documental, fiscal, bancaria y contractual para el alta del proveedor.',
    responsibleArea: 'Legal y Cumplimiento', openedAt: '2026-07-26T09:30:00-06:00',
    participants: [
      { id: 'p1', name: summary.participant, role: 'Titular del expediente', email: 'administracion@constructoradelnorte.mx', rfc: 'CNO140410CH3', accessMethod: 'secure_link_otp', status: 'active' },
      { id: 'p2', name: 'José Alberto González', role: 'Representante legal y firmante', email: 'jose.gonzalez@constructoradelnorte.mx', rfc: 'GOJA850214AB1', accessMethod: 'secure_link_otp', status: 'active' },
      { id: 'p3', name: 'Ana Martínez', role: 'Revisora documental', email: 'ana.martinez@docubox.mx', accessMethod: 'docubox_account', status: 'active' },
    ],
    requirements: [
      { id: 'r1', name: 'Acta constitutiva', description: 'Documento constitutivo completo.', category: 'attachment', required: true, ...requirementDefaults, status: 'approved', uploadedAt: '2026-07-27T12:20:00-06:00', hash: '27f8b0a4…98c1' },
      { id: 'r2', name: 'Poder del representante legal', description: 'Poder vigente del representante.', category: 'attachment', required: true, ...requirementDefaults, status: 'approved', uploadedAt: '2026-07-27T12:24:00-06:00', hash: '7e2a13d1…5f89' },
      { id: 'r3', name: 'Identificación oficial', description: 'INE o pasaporte vigente.', category: 'attachment', required: true, ...requirementDefaults, requiresIdentity: true, status: 'approved', uploadedAt: '2026-07-27T12:31:00-06:00', hash: 'ac48c8d3…7f11' },
      { id: 'r4', name: 'Constancia de situación fiscal', description: 'Documento emitido por el SAT.', category: 'attachment', required: true, ...requirementDefaults, status: 'approved', uploadedAt: '2026-07-27T12:40:00-06:00', hash: '1802d121…32ae' },
      { id: 'r5', name: 'Opinión de cumplimiento', description: 'Opinión positiva y vigente.', category: 'attachment', required: true, ...requirementDefaults, status: 'observed', uploadedAt: '2026-07-27T12:44:00-06:00', rejectionReason: 'El documento corresponde al mes anterior y ya no está vigente.', correctionAction: 'Descarga una opinión positiva vigente desde el portal del SAT y reemplaza este archivo.' },
      { id: 'r6', name: 'Comprobante de domicilio', description: 'Antigüedad no mayor a tres meses.', category: 'attachment', required: true, ...requirementDefaults, status: 'in_review', uploadedAt: '2026-08-02T10:02:00-06:00' },
      { id: 'r7', name: 'Carátula bancaria', description: 'Banco, CLABE y titular visibles.', category: 'attachment', required: true, ...requirementDefaults, status: 'approved', uploadedAt: '2026-07-27T13:01:00-06:00', hash: 'a409115c…6b92' },
      { id: 'r8', name: 'Contrato de prestación de servicios', description: 'Contrato principal sujeto a firma.', category: 'signed', required: true, ...requirementDefaults, requiresSignature: true, requiresIdentity: true, status: 'uploaded', uploadedAt: '2026-08-01T16:12:00-06:00' },
    ],
    forms: [
      { id: 'f1', name: 'Datos fiscales del proveedor', assignee: 'Constructora del Norte', status: 'approved', requiresSignature: false, pdfGenerated: true, updatedAt: '2026-07-28T11:20:00-06:00' },
      { id: 'f2', name: 'Datos bancarios', assignee: 'Constructora del Norte', status: 'submitted', requiresSignature: false, pdfGenerated: true, updatedAt: '2026-07-28T11:42:00-06:00' },
      { id: 'f3', name: 'Declaración bajo protesta', assignee: 'José Alberto González', status: 'in_progress', requiresSignature: true, pdfGenerated: false, updatedAt: '2026-08-02T09:18:00-06:00' },
    ],
    identityChecks: [
      { id: 'i1', person: 'José Alberto González', method: 'INE + selfie', status: 'approved', verifiedAt: '2026-07-28T13:17:00-06:00', result: 'Coincidencia biométrica satisfactoria' },
      { id: 'i2', person: 'Constructora del Norte, S.A. de C.V.', method: 'RFC / SAT', status: 'approved', verifiedAt: '2026-07-28T13:22:00-06:00', result: 'RFC activo y razón social coincidente' },
    ],
    milestones: defaultMilestoneBlueprints().map((item, index) => ({ ...item, id: `m${index + 1}`, status: index < 3 ? 'completed' : index === 3 ? 'in_progress' : 'pending', completedAt: index < 3 ? '2026-07-28T13:22:00-06:00' : undefined })),
    signatures: [
      { id: 's1', documentName: 'Contrato de prestación de servicios', signer: 'José Alberto González', type: 'efirma', flow: 'sequential', status: 'pending', sentAt: '2026-08-01T16:15:00-06:00' },
      { id: 's2', documentName: 'Declaración bajo protesta', signer: 'José Alberto González', type: 'click_sign', flow: 'parallel', status: 'pending' },
    ],
    observations: [
      { id: 'o1', target: 'Opinión de cumplimiento', reason: 'Documento vencido', message: 'La opinión presentada ya no se encuentra vigente.', correctionAction: 'Sube una opinión positiva emitida durante el mes en curso.', responsible: 'Constructora del Norte', status: 'open', dueDate: '2026-08-04', createdAt: '2026-08-01T10:16:00-06:00' },
    ],
    auditEvents: [
      ['Documento cargado', 'Constructora del Norte', 'Comprobante de domicilio', '2026-08-02T10:02:00-06:00'],
      ['Observación creada', 'Ana Martínez', 'Opinión de cumplimiento', '2026-08-01T10:16:00-06:00'],
      ['Documento enviado a firma', 'Luis Alberto Hernández', 'Contrato de prestación de servicios', '2026-08-01T16:15:00-06:00'],
      ['Identidad validada', 'Sistema Docubox', 'José Alberto González', '2026-07-28T13:17:00-06:00'],
      ['Expediente creado', 'Luis Alberto Hernández', summary.folio, '2026-07-26T09:30:00-06:00'],
    ].map(([action, actor, object, occurredAt], index) => ({ id: `a${index + 1}`, action, actor, object, occurredAt, result: index === 1 ? 'warning' : 'success', ip: index < 3 ? '187.172.89.124' : undefined, hash: `evt_${index + 1}_8f3a9d74` })),
    closureRules: defaultClosureLabels().map((label, index) => ({ id: `c${index + 1}`, label, required: true, satisfied: index === 1 || index === 2 })),
    manifestStatus: 'pending', certificateStatus: 'pending',
  };
}

export function getCompletionStats(caseFile: CaseFileDetail) {
  const approvedDocs = caseFile.requirements.filter((item) => item.status === 'approved').length;
  const completedForms = caseFile.forms.filter((item) => ['approved', 'locked'].includes(item.status)).length;
  const approvedIdentity = caseFile.identityChecks.filter((item) => item.status === 'approved').length;
  const signed = caseFile.signatures.filter((item) => item.status === 'signed').length;
  const completedMilestones = caseFile.milestones.filter((item) => item.status === 'completed').length;
  return { approvedDocs, completedForms, approvedIdentity, signed, completedMilestones };
}

export function buildInitialCaseFromTemplate(template: CaseTemplate) {
  return {
    title: '', caseType: template.type, caseSubtype: '', priority: 'normal' as CasePriority,
    sensitivity: 'confidential' as CaseSensitivity, participant: '', responsibleArea: '', responsible: '',
    targetCloseAt: '', description: '', tags: [] as string[], participants: [] as CaseParticipant[],
    requirements: template.requirements.map((item, index) => ({ ...item, id: `requirement-${index + 1}`, status: 'pending' as RequirementStatus })),
    formIds: [] as string[], identityMethods: [...template.identityMethods],
    milestones: template.milestones.map((item, index) => ({ ...item, id: `milestone-${index + 1}`, status: 'pending' as MilestoneStatus })),
    closureRules: template.closureRuleLabels.map((label, index) => ({ id: `closure-${index + 1}`, label, required: true, satisfied: false })),
  };
}
