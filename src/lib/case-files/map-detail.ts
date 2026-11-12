import type {
  CaseFileDetail,
  CaseFileStatus,
  CasePriority,
  CaseSensitivity,
  CaseParticipant,
  CaseRequirement,
  CaseFormLink,
  CaseIdentityCheck,
  CaseMilestone,
  CaseSignature,
  CaseObservation,
  CaseAuditEvent,
} from './schema';

type Row = Record<string, unknown>;
const value = (input: unknown) => (typeof input === 'string' ? input : '');
const optional = (input: unknown) => value(input) || undefined;
const number = (input: unknown) => (typeof input === 'number' ? input : 0);
const boolean = (input: unknown) => input === true;

export function mapCaseFileDetail(
  row: Row,
  participantRows: Row[],
  requirementRows: Row[],
  formRows: Row[],
  identityRows: Row[],
  milestoneRows: Row[],
  signatureRows: Row[],
  observationRows: Row[],
  auditRows: Row[]
): CaseFileDetail {
  const participants: CaseParticipant[] = participantRows.map((item) => ({
    id: value(item.id),
    name: value(item.name),
    role:
      (
        {
          subject: 'Titular',
          representative: 'Representante',
          contact: 'Contacto de seguimiento',
        } as Record<string, string>
      )[value(item.role)] || value(item.role),
    email: value(item.email),
    rfc: optional(item.rfc),
    accessMethod: value(item.access_method) as CaseParticipant['accessMethod'],
    status: value(item.status) as CaseParticipant['status'],
  }));
  const participantName = (id: unknown) =>
    participants.find((item) => item.id === id)?.name || 'Sin asignar';
  const requirements: CaseRequirement[] = requirementRows.map((item) => ({
    id: value(item.id),
    name: value(item.title),
    description: value(item.description),
    category: value(item.category) as CaseRequirement['category'],
    required: boolean(item.is_required),
    allowedFormats: Array.isArray(item.allowed_mime_types)
      ? item.allowed_mime_types.map(String)
      : [],
    maxSizeMb: Math.round(number(item.max_size_bytes) / 1048576),
    requiresReview: boolean(item.requires_manual_review),
    requiresSignature: boolean(item.requires_signature),
    requiresIdentity: boolean(item.requires_identity),
    status: value(item.status) as CaseRequirement['status'],
  }));
  const forms: CaseFormLink[] = formRows.map((item) => ({
    id: value(item.id),
    templateId: optional(item.form_template_id),
    name: value(item.title),
    assignee: participantName(item.participant_id),
    status: value(item.status) as CaseFormLink['status'],
    requiresSignature: boolean(item.requires_signature),
    pdfGenerated: false,
    updatedAt: optional(item.updated_at),
  }));
  const identityChecks: CaseIdentityCheck[] = identityRows.map((item) => ({
    id: value(item.id),
    person: participantName(item.participant_id),
    method: value(item.method),
    status: value(item.status) as CaseIdentityCheck['status'],
    verifiedAt: optional(item.verified_at),
  }));
  const milestones: CaseMilestone[] = milestoneRows.map((item) => ({
    id: value(item.id),
    title: value(item.title),
    description: value(item.description),
    responsible: value(item.responsible_label) || 'Sin asignar',
    condition:
      typeof item.completion_condition_json === 'object' && item.completion_condition_json !== null
        ? value((item.completion_condition_json as Row).description)
        : '',
    status: value(item.status) as CaseMilestone['status'],
    dueDate: optional(item.due_date),
    completedAt: optional(item.completed_at),
  }));
  const signatures: CaseSignature[] = signatureRows.map((item) => ({
    id: value(item.id),
    documentName: 'Documento vinculado',
    signer: participantName(item.signer_participant_id),
    type: value(item.signature_type) as CaseSignature['type'],
    flow: value(item.flow_type) as CaseSignature['flow'],
    status: value(item.status) as CaseSignature['status'],
    sentAt: optional(item.sent_at),
    signedAt: optional(item.signed_at),
    hash: optional(item.signed_document_hash),
  }));
  const observations: CaseObservation[] = observationRows.map((item) => ({
    id: value(item.id),
    target: 'Documento o formulario',
    reason: value(item.reason_code),
    message: value(item.message),
    correctionAction: value(item.correction_action),
    responsible: participantName(item.responsible_participant_id),
    status: value(item.status) as CaseObservation['status'],
    dueDate: optional(item.due_at),
    createdAt: value(item.created_at),
  }));
  const auditEvents: CaseAuditEvent[] = auditRows.map((item) => ({
    id: value(item.id),
    action: value(item.action),
    actor: value(item.actor_label),
    result: value(item.result) as CaseAuditEvent['result'],
    object: value(item.affected_object_type),
    occurredAt: value(item.occurred_at),
    hash: value(item.event_hash),
  }));
  return {
    id: value(row.id),
    folio: value(row.folio),
    title: value(row.title),
    description: value(row.description),
    caseType: value(row.case_type),
    caseSubtype: optional(row.case_subtype),
    participant: value(row.subject_name) || 'Sin participante',
    responsible: value(row.responsible_name) || value(row.responsible_area) || 'Sin asignar',
    responsibleArea: value(row.responsible_area) || 'Sin asignar',
    status: value(row.status) as CaseFileStatus,
    progress: number(row.progress),
    priority: value(row.priority) as CasePriority,
    sensitivity: value(row.sensitivity_level) as CaseSensitivity,
    pendingItems: requirements.filter((item) => item.status !== 'approved').length,
    openObservations: observations.filter((item) => item.status === 'open').length,
    targetCloseAt: optional(row.target_close_at),
    lastActivityAt: value(row.updated_at),
    openedAt: value(row.opened_at) || value(row.created_at),
    participants,
    requirements,
    forms,
    identityChecks,
    milestones,
    signatures,
    observations,
    auditEvents,
    closureRules: [],
    rootHash: optional(row.root_hash),
    manifestStatus:
      row.closure_status === 'sealed' ? 'sealed' : row.manifest_id ? 'ready' : 'pending',
    certificateStatus: row.closure_certificate_id ? 'generated' : 'pending',
  };
}
