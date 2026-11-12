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
  templateId?: string;
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
