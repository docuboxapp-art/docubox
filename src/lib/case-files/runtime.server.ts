import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { requireDocumentIdentity } from '@/lib/security/document-access';
import { parseStoredCaseTemplate, type StoredCaseTemplate } from './template-builder';
import { resolvedCaseWorkflow } from './workflow';
import { caseEvidenceProgress } from './runtime-progress';
import { validateCaseReviewPublication } from './review-publication';
import {
  evaluateRuntimeSnapshot,
  eligibleMember,
  record,
  rows,
  textValue,
  hash,
  signingScope,
  type RuntimeSnapshot,
  type RuntimeRow,
} from './runtime-model';
export { record, rows, textValue } from './runtime-model';

export const runtimeHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export class CaseRuntimeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409
  ) {
    super(message);
  }
}
export function runtimeFailure(cause: unknown) {
  if (cause instanceof SyntaxError)
    return { status: 422, body: { error: 'Solicitud inválida.', code: 'CASE_INPUT_INVALID' } };
  if (cause instanceof CaseRuntimeError)
    return { status: cause.status, body: { error: cause.message, code: cause.code } };
  const error = record(cause);
  if (
    typeof error.status === 'number' &&
    [401, 403, 503].includes(error.status) &&
    textValue(error.code).startsWith('AUTH_')
  )
    return {
      status: error.status,
      body: {
        error: 'No se pudo validar la sesión. Inicia sesión o vuelve a intentarlo.',
        code: error.code,
      },
    };
  const raw = textValue(error.message);
  const code = raw.match(/\bCASE_[A-Z_]+\b/)?.[0] || 'CASE_OPERATION_FAILED';
  const status =
    error.code === '42501'
      ? 403
      : ['40001', '23505', '55P03'].includes(textValue(error.code)) ||
          code !== 'CASE_OPERATION_FAILED'
        ? 409
        : 503;
  const messages: Record<string, string> = {
    CASE_LAUNCH_SETTINGS_INVALID: 'Revisa el acceso, la firma y la vigencia del lanzamiento.',
    CASE_SIGNATURE_METHOD_UNAVAILABLE:
      'El método de firma no es compatible con los documentos o formularios vinculados. Elige otro método o actualiza el tipo de expediente.',
    CASE_SCHEDULE_INVALID: 'Selecciona una fecha de envío futura, dentro del próximo año.',
    CASE_SCHEDULE_ALREADY_STARTED:
      'El envío ya comenzó. Actualiza el expediente para consultar sus invitaciones.',
    CASE_SCHEDULE_CANCEL_DENIED:
      'Solo puedes cancelar un envío antes de su fecha programada y antes de recibir entregas.',
    CASE_INVITATION_NOT_ACTIVE:
      'La invitación estará disponible a partir de la fecha de envío programada.',
    CASE_PORTAL_CODE_INVALID: 'El código no corresponde a esta invitación.',
    CASE_PORTAL_LIVENESS_REQUIRED: 'Completa la prueba de vida para abrir el expediente.',
    CASE_PORTAL_INVALID:
      'La invitación venció o fue revocada. Solicita un nuevo enlace al remitente.',
    CASE_PORTAL_SCOPE: 'Esta entrega no corresponde a tu participación en el expediente.',
    CASE_ITEM_LOCKED: 'Este elemento ya fue recibido o aprobado. Actualiza el expediente.',
    CASE_UPLOAD_BUSY: 'La entrega se está procesando. Espera un momento antes de reintentar.',
    CASE_UPLOAD_STALE:
      'La carga venció o el requisito cambió. Actualiza y selecciona el archivo de nuevo.',
    CASE_FORM_REVISION_CHANGED:
      'La versión del formulario cambió. El responsable debe actualizar su vínculo en el expediente.',
    CASE_FILE_TOO_LARGE: 'El archivo excede el tamaño permitido para este requisito.',
    CASE_FILE_FORMAT_INVALID: 'El formato del archivo no está permitido para este requisito.',
    CASE_REPLACEMENT_DISABLED: 'Este requisito no permite sustituir el documento recibido.',
    CASE_ISSUE_DATE_REQUIRED: 'Indica una fecha de emisión válida que no sea futura.',
    CASE_INVITATION_DENIED:
      'Solo el responsable o un administrador puede gestionar las invitaciones.',
    CASE_EMAIL_REQUIRED:
      'Cada participante necesita un correo disponible para recibir su invitación.',
    CASE_INVITATION_INVALID:
      'Revisa la selección de participantes antes de enviar las invitaciones.',
    CASE_PARTICIPANT_INVALID: 'Revisa el nombre, el correo y el rol de cada participante.',
    CASE_PARTICIPANT_DUPLICATE:
      'Una persona ya está incluida. Revisa los participantes duplicados.',
    CASE_ASSIGNEE_INVALID: 'El responsable seleccionado ya no tiene los permisos necesarios.',
    CASE_REVIEWER_REQUIRED: 'Asigna un revisor autorizado a cada requisito que lo necesite.',
    CASE_TEMPLATE_DENIED: 'El tipo de expediente ya no está disponible o no tienes acceso.',
    CASE_REVISION_CONFLICT: 'La evidencia cambió. Actualiza el expediente antes de confirmar.',
    CASE_APPROVAL_NOT_READY: 'Completa los controles pendientes antes de aprobar.',
    CASE_CLOSURE_NOT_ALLOWED:
      'El cierre requiere todas las condiciones y un responsable autorizado.',
    CASE_SIGNATURE_NOT_READY: 'Completa las revisiones y la aprobación antes de enviar a firma.',
    CASE_REVIEW_DENIED: 'Solo el revisor asignado puede registrar esta decisión.',
    CASE_APPROVAL_DENIED: 'Solo el aprobador asignado puede autorizar el expediente.',
    CASE_IDEMPOTENCY_CONFLICT: 'Esta operación ya se utilizó con datos diferentes.',
    CASE_SOURCE_VERSION_REQUIRED: 'Elige un documento que tenga una versión guardada.',
    CASE_SOURCE_INVALID: 'El documento no está disponible o no tienes permiso para vincularlo.',
    CASE_TERMINAL: 'El expediente está cerrado o cancelado; su historial se conserva.',
    CASE_SEPARATION_OF_DUTIES: 'La política de la organización exige un aprobador independiente.',
    CASE_SIGNED_SOURCE_REPLACEMENT_REQUIRED:
      'La evidencia en firma requiere un proceso explícito de sustitución; no puede sobrescribirse.',
  };
  return {
    status,
    body: {
      code,
      error:
        messages[code] ||
        'No se pudo completar la operación. Revisa los permisos y el estado del expediente.',
    },
  };
}

export async function caseIdentity(request: NextRequest) {
  if (request.headers.get('authorization')) return (await requireDocumentIdentity(request)).user;
  if (
    request.method !== 'GET' &&
    request.headers.get('origin') &&
    request.headers.get('origin') !== request.nextUrl.origin
  )
    throw new CaseRuntimeError('CASE_ORIGIN_DENIED', 'Origen de solicitud no permitido.', 403);
  const jar = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) =>
          values.forEach((value) => jar.set(value.name, value.value, value.options)),
      },
    }
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new CaseRuntimeError('CASE_AUTH_REQUIRED', 'Inicia sesión para continuar.', 401);
  return data.user;
}

export async function caseSnapshot(service: SupabaseClient, caseId: string, actorId: string) {
  const result = await service.rpc('case_control_snapshot', {
    p_case_id: caseId,
    p_actor_id: actorId,
    p_lock: false,
  });
  if (result.error) throw result.error;
  if (!result.data || typeof result.data !== 'object')
    throw new CaseRuntimeError('CASE_LOAD_FAILED', 'No se pudo cargar la evidencia.', 503);
  return result.data as RuntimeSnapshot;
}

const evaluationPayload = (value: ReturnType<typeof evaluateRuntimeSnapshot>) => ({
  progress: caseEvidenceProgress(value.conditions),
  conditions: value.conditions,
  eligible: value.eligible,
  canApprove: value.canApprove,
  canSign: value.canSign,
  reviewableIds: value.reviewableIds,
  operationalStatus: value.operationalStatus,
  readyStageIds: value.readyStageIds,
  stageStatuses: value.stageStatuses,
  signingStarted: value.signingStarted,
});

export async function executeCaseControl(
  service: SupabaseClient,
  caseId: string,
  actorId: string,
  command: string,
  operationKey: string,
  input: RuntimeRow = {}
) {
  const snapshot = await caseSnapshot(service, caseId, actorId);
  if (input.revision !== snapshot.revision)
    throw new CaseRuntimeError(
      'CASE_REVISION_CONFLICT',
      'La evidencia cambió. Actualiza el expediente antes de confirmar.'
    );
  const evaluated = evaluateRuntimeSnapshot(snapshot);
  const payload: RuntimeRow = {};
  if (command === 'review') {
    const itemId = textValue(input.itemId);
    const item = evaluated.items.find((value) => value.id === itemId);
    const evidence = evaluated.evidence.content[itemId];
    if (!item || !evidence || !evaluated.reviewableIds.includes(itemId))
      throw new CaseRuntimeError(
        'CASE_REVIEW_NOT_READY',
        'Todavía no hay una entrega vigente disponible para revisar.'
      );
    Object.assign(payload, {
      itemId,
      decision: input.decision,
      reason: textValue(input.reason).trim().slice(0, 2000),
      documentId: evaluated.bindings.get(itemId)?.id || null,
      submissionId: item.submissionId || null,
      evidenceVersion: evidence.version,
      evidenceHash: evidence.evidenceHash,
    });
  } else if (command === 'approval') {
    const ids = Array.isArray(input.itemIds)
      ? input.itemIds.filter(
          (id) => typeof id === 'string' && evaluated.items.some((item) => item.id === id)
        )
      : [];
    Object.assign(payload, {
      decision: input.decision,
      reason: textValue(input.reason).trim().slice(0, 2000),
      itemIds: ids,
      snapshotId: evaluated.snapshotId,
    });
  } else if (command === 'stage') {
    Object.assign(payload, { stageId: input.stageId });
  } else if (!['close', 'refresh', 'signatures'].includes(command))
    throw new CaseRuntimeError('CASE_COMMAND_INVALID', 'Acción inválida.', 422);
  const result = await service.rpc('case_control_apply', {
    p_case_id: caseId,
    p_actor_id: actorId,
    p_revision: snapshot.revision,
    p_command: command,
    p_operation_key: operationKey,
    p_evaluation: evaluationPayload(evaluated),
    p_payload: payload,
  });
  if (result.error) throw result.error;
  if (['review', 'approval', 'stage'].includes(command))
    await refreshCaseControl(service, caseId, actorId);
  return result.data;
}

export async function refreshCaseControl(service: SupabaseClient, caseId: string, actorId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await caseSnapshot(service, caseId, actorId);
    if (['sealed', 'cancelled'].includes(textValue(snapshot.case.status))) return snapshot;
    const evaluation = evaluateRuntimeSnapshot(snapshot);
    const next = evaluation.eligible
      ? 'ready_to_close'
      : evaluation.canSign
        ? evaluation.signingStarted
          ? 'signing'
          : 'ready_to_sign'
        : evaluation.operationalStatus;
    const stagesChanged = evaluation.stageStatuses.some(
      (stage) =>
        !stage.manual &&
        rows(snapshot.milestones).find(
          (row) => record(row.completion_condition_json).id === stage.id
        )?.status !== stage.status
    );
    if (
      !stagesChanged &&
      Math.min(99, evaluationPayload(evaluation).progress) === Number(snapshot.case.progress) &&
      !(evaluation.eligible && evaluation.draft.reviewPolicy.completion.mode === 'automatic') &&
      snapshot.case.status === next
    )
      return snapshot;
    const result = await service.rpc('case_control_apply', {
      p_case_id: caseId,
      p_actor_id: actorId,
      p_revision: snapshot.revision,
      p_command: 'refresh',
      p_operation_key: randomUUID(),
      p_evaluation: evaluationPayload(evaluation),
      p_payload: {},
    });
    if (!result.error) return caseSnapshot(service, caseId, actorId);
    if (result.error.code !== '40001' || attempt === 2) throw result.error;
  }
  throw new CaseRuntimeError(
    'CASE_REVISION_CONFLICT',
    'La evidencia sigue cambiando. Vuelve a actualizar.'
  );
}

export function publicCaseRuntime(snapshot: RuntimeSnapshot, actorId: string) {
  const closed = snapshot.case.status === 'sealed';
  const readOnly = closed || snapshot.case.status === 'cancelled';
  const sealed = record(record(snapshot.case.sealed_snapshot).snapshot);
  const result = evaluateRuntimeSnapshot(
    closed && sealed.case ? (sealed as RuntimeSnapshot) : snapshot
  );
  const assignments = record(snapshot.case.runtime_assignments);
  const approval = record(snapshot.case.review_approval);
  const frozen = record(record(snapshot.case.sealed_snapshot).evaluation);
  return {
    id: snapshot.case.id,
    title: snapshot.case.title,
    status: snapshot.case.status,
    version: snapshot.case.version,
    revision: snapshot.revision,
    closedAt: snapshot.case.closed_at,
    rootHash: snapshot.case.root_hash,
    canOrganize:
      !readOnly &&
      (snapshot.case.owner_user_id === actorId || eligibleMember(snapshot, actorId, 'admin')),
    canManageInvitations:
      snapshot.case.owner_user_id === actorId || eligibleMember(snapshot, actorId, 'admin'),
    responsibilities: [
      {
        kind: 'owner',
        userId: textValue(snapshot.case.owner_user_id),
        label: 'Responsable del expediente',
      },
      ...(result.draft.reviewPolicy.approval.enabled
        ? [{ kind: 'approver', userId: textValue(assignments.approver), label: 'Aprobación final' }]
        : []),
      ...(result.draft.reviewPolicy.completion.mode === 'manual'
        ? [{ kind: 'closer', userId: textValue(assignments.closer), label: 'Cierre' }]
        : []),
    ],
    conditions:
      closed && Array.isArray(frozen.conditions)
        ? (frozen.conditions as typeof result.conditions)
        : result.conditions,
    items: result.items.map((item) => ({
      ...item,
      canReview:
        !readOnly &&
        item.reviewerId === actorId &&
        result.reviewableIds.includes(textValue(item.id)),
    })),
    approval: {
      enabled: result.draft.reviewPolicy.approval.enabled,
      decision: approval.decision,
      stale: approval.decision === 'approved' && approval.snapshotId !== result.snapshotId,
      canDecide:
        !readOnly &&
        assignments.approver === actorId &&
        eligibleMember(snapshot, actorId, result.draft.reviewPolicy.approval.role || ''),
      ready: result.canApprove,
    },
    completion: {
      mode: result.draft.reviewPolicy.completion.mode,
      eligible: result.eligible,
      canClose:
        !readOnly &&
        result.eligible &&
        assignments.closer === actorId &&
        eligibleMember(snapshot, actorId, result.draft.reviewPolicy.completion.role || ''),
    },
    signatures: {
      ready: !readOnly && result.canSign,
      documents: [...result.currentDocuments.entries()]
        .filter(([itemId]) => Boolean(result.evidence.signatures[itemId]))
        .map(([itemId, doc]) => ({
          itemId,
          id: doc.id,
          title: doc.nombre,
          status: doc.estado,
          signed: result.evidence.signatures[itemId]?.status === 'signed',
        })),
    },
    checks: rows(snapshot.checks).map((check) => ({
      id: check.template_verification_id,
      method: check.method,
      status: result.evidence.verifications[textValue(check.template_verification_id)]
        ?.authorizedResult
        ? 'approved'
        : 'pending',
    })),
    stages: result.stageStatuses.map((stage) => ({
      ...stage,
      canConfirm:
        !readOnly &&
        stage.manual &&
        stage.ready &&
        eligibleMember(snapshot, actorId, stage.coordinatorRole || ''),
    })),
    members: rows(snapshot.members)
      .filter((member) => member.status === 'active')
      .map((member) => ({ id: member.user_id, role: member.role })),
  };
}

export async function runtimePublication(
  service: SupabaseClient,
  actorId: string,
  workspaceId: string,
  template: StoredCaseTemplate,
  expected: string | null,
  publish = true
) {
  const membership = await service
    .from('workspace_members')
    .select('status,role,access_expires_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', actorId)
    .maybeSingle();
  if (membership.error) throw membership.error;
  if (
    !membership.data ||
    membership.data.status !== 'active' ||
    (membership.data.access_expires_at &&
      Date.parse(membership.data.access_expires_at) <= Date.now())
  )
    throw new CaseRuntimeError(
      'CASE_ACCESS_DENIED',
      'No tienes acceso activo a este espacio.',
      403
    );
  const draft = parseStoredCaseTemplate(template);
  const resources = new Map<
    string,
    { workspaceId: string; status: string; version: string; revision?: number; signatures: boolean }
  >();
  for (const item of draft.sections.flatMap((section) => section.items)) {
    if (!['form', 'document_template'].includes(item.kind) || !isUuid(item.sourceId)) continue;
    const query =
      item.kind === 'form'
        ? service
            .from('form_templates')
            .select('id,workspace_id,status,version_number,revision_number,requires_signature')
            .eq('id', item.sourceId)
            .eq('status', 'published')
        : service
            .from('plantillas')
            .select('id,workspace_id,estado,version_publicada,signer_roles,requires_efirma')
            .eq('id', item.sourceId)
            .eq('estado', 'published');
    const source = await query.eq('workspace_id', workspaceId).maybeSingle();
    if (source.error) throw source.error;
    if (!source.data) continue;
    const value = source.data as unknown as RuntimeRow;
    const resource = {
      workspaceId,
      status: 'published',
      version: String(value.version_number ?? value.version_publicada ?? ''),
      revision: typeof value.revision_number === 'number' ? value.revision_number : undefined,
      signatures:
        item.kind === 'form'
          ? value.requires_signature === true
          : value.requires_efirma === true || rows(value.signer_roles).length > 0,
    };
    resources.set(item.sourceId!, resource);
    if (resource.signatures) item.requiresSignature = true;
  }
  const checks = await validateCaseReviewPublication(
    draft,
    workspaceId,
    { resource: async (_kind, id) => resources.get(id) || null },
    { transitions: true, versionedEvidence: true, approval: true, signatures: true }
  );
  if (!checks.valid)
    throw new CaseRuntimeError(
      'CASE_PUBLICATION_INVALID',
      checks.issues.map((issue) => issue.message).join(' '),
      422
    );
  if (!publish) return { valid: true, policyVersion: draft.reviewPolicy.version, issues: [] };
  const payload = {
    name: draft.name.trim(),
    description: draft.description,
    case_type: draft.caseType || 'Sin especificar',
    case_subtype: draft.caseSubtype || null,
    requirements_schema: {
      ...record(template.requirements_schema),
      version: 6,
      reviewPolicy: draft.reviewPolicy,
      sections: draft.sections,
      stages: resolvedCaseWorkflow(draft),
      workflowMode: draft.workflowMode,
      verifications: draft.verifications,
      experience: draft.experience,
    },
    forms_schema: draft.sections
      .flatMap((section) => section.items)
      .filter((item) => item.kind === 'form'),
  };
  const id = isUuid(template.id) ? template.id : randomUUID();
  const result = await service.rpc('case_control_publish', {
    p_id: id,
    p_actor: actorId,
    p_workspace: workspaceId,
    p_expected: expected,
    p_payload: payload,
  });
  if (result.error) throw result.error;
  return result.data;
}

/** Called by the existing document completion route. The document flow is still authoritative. */
export async function refreshCasesForDocument(documentId: string) {
  const service = createServiceClient(AbortSignal.timeout(15_000));
  const links = await service
    .from('case_file_documents')
    .select('case_file_id')
    .eq('source_document_id', documentId)
    .limit(100);
  if (links.error) throw links.error;
  const responses = await service.from('form_responses').select('id').eq('document_id', documentId);
  if (responses.error) throw responses.error;
  const formLinks = responses.data?.length
    ? await service
        .from('case_file_form_submissions')
        .select('case_file_id')
        .in(
          'form_response_id',
          responses.data.map((row) => row.id)
        )
    : { data: [], error: null };
  if (formLinks.error) throw formLinks.error;
  for (const caseId of new Set(
    [...(links.data || []), ...(formLinks.data || [])].map((link) => link.case_file_id)
  )) {
    const instance = await service
      .from('case_files')
      .select('owner_user_id,status,runtime_version')
      .eq('id', caseId)
      .maybeSingle();
    if (instance.error) throw instance.error;
    if (
      instance.data?.runtime_version === 1 &&
      !['sealed', 'cancelled'].includes(instance.data.status)
    ) {
      await refreshCaseControl(service, caseId, instance.data.owner_user_id);
      await service
        .from('case_file_tasks')
        .update({ status: 'completed' })
        .eq('case_file_id', caseId)
        .eq('title', 'case_runtime:refresh')
        .eq('status', 'pending');
    }
  }
}

/** The existing authorized maintenance endpoint drains retries without losing a provider result. */
export async function processPendingCaseControls(limit = 30) {
  const service = createServiceClient();
  const pending = await service
    .from('case_file_tasks')
    .select('id,case_file_id')
    .eq('title', 'case_runtime:refresh')
    .eq('status', 'pending')
    .order('created_at')
    .limit(limit);
  if (pending.error) throw pending.error;
  let completed = 0;
  for (const task of pending.data || []) {
    try {
      const instance = await service
        .from('case_files')
        .select('owner_user_id')
        .eq('id', task.case_file_id)
        .single();
      if (instance.error) throw instance.error;
      await refreshCaseControl(service, task.case_file_id, instance.data.owner_user_id);
      const saved = await service
        .from('case_file_tasks')
        .update({ status: 'completed' })
        .eq('id', task.id)
        .eq('status', 'pending');
      if (saved.error) throw saved.error;
      completed++;
    } catch {
      /* Keep pending: revoked access or temporary source failure must never imply success. */
    }
  }
  return { processed: pending.data?.length || 0, completed };
}

export async function assertCaseDocumentSigningReady(
  documentId: string,
  expected?: { hash?: string; participants?: unknown }
) {
  const service = createServiceClient(AbortSignal.timeout(15_000));
  const links = await service
    .from('case_file_documents')
    .select('case_file_id')
    .eq('source_document_id', documentId)
    .limit(100);
  if (links.error) throw links.error;
  for (const caseId of new Set((links.data || []).map((link) => link.case_file_id))) {
    const instance = await service
      .from('case_files')
      .select('owner_user_id,status,runtime_version')
      .eq('id', caseId)
      .maybeSingle();
    if (instance.error) throw instance.error;
    if (instance.data?.runtime_version !== 1) continue;
    if (!instance.data || instance.data.status === 'sealed')
      throw new CaseRuntimeError('CASE_TERMINAL', 'El expediente vinculado está cerrado.');
    const snapshot = await caseSnapshot(service, caseId, instance.data.owner_user_id);
    const source = rows(snapshot.sources).find((doc) => doc.id === documentId);
    if (
      !evaluateRuntimeSnapshot(snapshot).canSign ||
      (expected?.hash && source?.file_hash_sha256 !== expected.hash) ||
      (expected?.participants &&
        hash(signingScope(source?.participantes)) !== hash(signingScope(expected.participants)))
    )
      throw new CaseRuntimeError(
        'CASE_SIGNATURE_NOT_READY',
        'El expediente aún tiene controles pendientes o cambió el documento o sus firmantes. Guarda y revisa la nueva configuración.'
      );
  }
}

export async function assertCaseSourceReplacementAllowed(documentId: string) {
  const service = createServiceClient();
  const bindings = await service
    .from('case_file_documents')
    .select('case_file_id')
    .eq('source_document_id', documentId)
    .limit(100);
  if (bindings.error) throw bindings.error;
  if (!bindings.data?.length) return;
  const claimed = await service
    .from('participant_completion_attempts')
    .select('id')
    .eq('document_id', documentId)
    .in('status', ['claimed', 'committed'])
    .limit(1);
  if (claimed.error) throw claimed.error;
  const closed = await service
    .from('case_files')
    .select('id')
    .in(
      'id',
      bindings.data.map((value) => value.case_file_id)
    )
    .eq('status', 'sealed')
    .limit(1);
  if (closed.error) throw closed.error;
  if (closed.data?.length || claimed.data?.length)
    throw new CaseRuntimeError(
      'CASE_SIGNED_SOURCE_REPLACEMENT_REQUIRED',
      'El documento forma parte de una firma o de un expediente cerrado. Utiliza un nuevo ciclo o un proceso autorizado de sustitución.'
    );
}
