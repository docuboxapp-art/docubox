import { createHash } from 'node:crypto';
import { canonicalizeRFC8785 } from '../certification/canonical';
import { parseStoredCaseTemplate, type StoredCaseTemplate } from './template-builder';
import {
  evaluateCaseEligibility,
  reviewPolicySources,
  type CaseControlEvidence,
} from './review-policy';

export type RuntimeRow = Record<string, unknown>;
export type RuntimeItem = {
  id: string;
  title: string;
  kind: string;
  sourceId: string | null;
  conditional: boolean;
  applicable?: boolean | null;
  required: boolean;
  requiresReview: boolean;
  reviewerId: string;
  version?: string | null;
  documentId?: unknown;
  bindingId?: unknown;
  submissionId?: unknown;
  received: boolean;
  review?: string;
  askIssueDate: boolean;
  validityDays: number | null;
};
export type RuntimeSnapshot = Record<string, unknown> & {
  revision: string;
  case: RuntimeRow;
  template: RuntimeRow;
};
export const record = (value: unknown): RuntimeRow =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RuntimeRow) : {};
export const rows = (value: unknown): RuntimeRow[] =>
  Array.isArray(value) ? value.map(record) : [];
export const textValue = (value: unknown) => (typeof value === 'string' ? value : '');
export const hash = (value: unknown) =>
  createHash('sha256').update(canonicalizeRFC8785(value)).digest('hex');
export const signingScope = (value: unknown) =>
  rows(value)
    .map((person) => ({
      id: person.id || '',
      userId: person.user_id || '',
      email: person.email || '',
      role: person.role || person.acto || '',
      types: person.signature_types || person.signatureTypes || person.tipoFirma || [],
      order: person.signing_order || person.order || 0,
      revoked: Boolean(person.revoked_at || person.removed_at),
    }))
    .sort((a, b) => String(a.id || a.email).localeCompare(String(b.id || b.email)));
const ordered = (values: RuntimeRow[], key: string) =>
  [...values].sort((a, b) => textValue(a[key]).localeCompare(textValue(b[key])));

export function eligibleMember(
  snapshot: RuntimeSnapshot,
  userId: string,
  role: string,
  now = Date.now()
) {
  return rows(snapshot.members).some(
    (member) =>
      member.user_id === userId &&
      member.status === 'active' &&
      (!member.access_expires_at || Date.parse(textValue(member.access_expires_at)) > now) &&
      (role === 'member' ||
        (role === 'owner' && snapshot.case.owner_user_id === userId) ||
        (role === 'admin' && ['owner', 'admin'].includes(textValue(member.role))))
  );
}

/** Reads only provider records returned by the server RPC. No client success flags are accepted. */
export function evaluateRuntimeSnapshot(snapshot: RuntimeSnapshot, now = Date.now()) {
  const draft = parseStoredCaseTemplate({
    ...snapshot.template,
    id: snapshot.case.template_id,
    status: 'active',
  } as StoredCaseTemplate);
  const sources = reviewPolicySources(draft);
  const subjectId = textValue(snapshot.case.runtime_subject_id);
  const subject = rows(snapshot.participants).find((participant) => participant.id === subjectId);
  const evidence: CaseControlEvidence = {
    subjectId,
    snapshotId: '',
    content: {},
    verifications: {},
    signatures: {},
    blockingObservations: rows(snapshot.observations).filter((item) => item.status === 'open')
      .length,
    failedRequiredJobs: 0,
  };
  const issues: { key: string; reason: string }[] = [];
  const itemViews: RuntimeItem[] = [];
  const bindings = new Map<string, RuntimeRow>();
  const currentDocuments = new Map<string, RuntimeRow>();
  const requiredSignatureSources = new Map<string, RuntimeRow[]>();
  for (const item of sources.items) {
    const requirement = rows(snapshot.requirements).find(
      (value) => record(value.settings).id === item.id
    );
    const form = rows(snapshot.forms).find((value) => value.template_item_id === item.id);
    let content: CaseControlEvidence['content'][string] | undefined;
    let document: RuntimeRow | undefined;
    let submission: RuntimeRow | undefined;
    const settings = record(requirement?.settings || form?.settings);
    const applicability = record(settings.applicability);
    if (
      item.conditional &&
      applicability.resolved === true &&
      applicability.subjectId === subjectId
    ) {
      content = {
        applicable: applicability.applies === true,
        applicabilityDecision: {
          authorized: true,
          ruleId: textValue(applicability.ruleId),
          subjectId,
        },
        version: null,
        evidenceHash: '',
        subjectId,
      };
    }
    if (item.kind === 'form') {
      submission = ordered(
        rows(snapshot.submissions).filter((value) => value.case_form_id === form?.id),
        'created_at'
      ).at(-1);
      const response = rows(snapshot.responses).find(
        (value) => value.id === submission?.form_response_id
      );
      if (submission && response) {
        if (
          response.template_id !== form?.form_template_id ||
          response.pdf_output_hash !== submission.sha256_hash
        )
          issues.push({
            key: item.id,
            reason:
              'La respuesta o su PDF cambió. Vincula expresamente la entrega actual antes de continuar.',
          });
        if (!(
          response.subject_matched === true ||
          (response.subject_matched === undefined &&
            subject?.user_id &&
            response.respondent_user_id === subject.user_id)
        ))
          issues.push({
            key: item.id,
            reason: 'La respuesta no corresponde al sujeto del expediente.',
          });
        else if (
          response.template_id === form?.form_template_id &&
          response.pdf_output_hash === submission.sha256_hash &&
          ['submitted', 'pdf_generated', 'signing', 'completed', 'signed', 'approved'].includes(
            textValue(response.status)
          ) &&
          response.submitted_at &&
          response.pdf_output_hash
        ) {
          content = {
            ...content,
            applicable: item.conditional ? (content?.applicable ?? null) : true,
            version: textValue(response.id),
            evidenceHash: textValue(response.pdf_output_hash),
            subjectId,
            completed: true,
          };
          document = rows(snapshot.sources).find((value) => value.id === response.document_id);
        }
      }
    } else {
      const binding = rows(snapshot.documents).find(
        (value) => value.requirement_id === requirement?.id
      );
      const version = rows(snapshot.document_versions).find(
        (value) => value.document_id === binding?.id && value.version === binding?.current_version
      );
      document = rows(snapshot.sources).find((value) => value.id === binding?.source_document_id);
      const sourceVersion = rows(snapshot.source_versions).find(
        (value) =>
          value.id === record(binding?.validation_result).sourceVersionId &&
          value.document_id === document?.id
      );
      const latestVersion = rows(snapshot.source_versions)
        .filter((value) => value.document_id === document?.id)
        .sort((a, b) => Number(b.version_number) - Number(a.version_number))[0];
      if (binding) bindings.set(item.id, binding);
      if (
        binding &&
        version &&
        document &&
        sourceVersion &&
        !document.deleted_at &&
        !['cancelado', 'rechazado', 'vencido'].includes(textValue(document.estado))
      ) {
        if (
          latestVersion?.id !== sourceVersion.id ||
          sourceVersion.sha256 !== version.sha256_hash ||
          document.file_hash_sha256 !== sourceVersion.sha256
        )
          issues.push({
            key: item.id,
            reason:
              'El documento cambió. Vincula expresamente su nueva versión y repite los controles afectados.',
          });
        else
          content = {
            ...content,
            applicable: item.conditional ? (content?.applicable ?? null) : true,
            version: textValue(sourceVersion.id),
            evidenceHash: textValue(version.sha256_hash),
            subjectId,
            received: true,
            generated: ['new_document', 'document_template'].includes(item.kind),
          };
        if (item.kind === 'document_template' && document.source_template_id !== item.sourceId)
          issues.push({
            key: item.id,
            reason: 'El documento no procede de la plantilla configurada.',
          });
      }
    }
    if (document) currentDocuments.set(item.id, document);
    if (content) {
      const reviewerId = textValue(requirement?.reviewer_user_id || form?.reviewer_user_id);
      const review = rows(snapshot.reviews)
        .filter((value) => record(value.comparison_result).itemId === item.id)
        .at(-1);
      if (review) {
        const comparison = record(review.comparison_result);
        content.review = {
          decision: review.decision as 'accepted' | 'observed' | 'rejected',
          version: textValue(comparison.version),
          evidenceHash: textValue(comparison.evidenceHash),
          subjectId: textValue(comparison.subjectId),
          authorized:
            review.reviewer_user_id === reviewerId &&
            eligibleMember(snapshot, reviewerId, item.reviewerRole || ''),
        };
      }
      if (document?.fecha_vencimiento && Date.parse(textValue(document.fecha_vencimiento)) <= now)
        issues.push({ key: item.id, reason: 'La vigencia configurada del documento terminó.' });
      const binding = bindings.get(item.id);
      if (binding?.expires_at && Date.parse(textValue(binding.expires_at)) <= now)
        issues.push({
          key: item.id,
          reason: 'El documento excedió la vigencia configurada para este requisito.',
        });
      evidence.content[item.id] = content;
    }
    const reviewerId = textValue(requirement?.reviewer_user_id || form?.reviewer_user_id);
    if (item.requiresReview && !eligibleMember(snapshot, reviewerId, item.reviewerRole || ''))
      issues.push({
        key: item.id,
        reason: 'El revisor asignado no tiene acceso vigente. Reasígnalo antes de continuar.',
      });
    itemViews.push({
      id: item.id,
      title: item.title,
      kind: item.kind,
      sourceId: item.sourceId,
      conditional: item.conditional,
      applicable: content?.applicable,
      required: item.required,
      requiresReview: item.requiresReview,
      askIssueDate: item.askIssueDate,
      validityDays: item.validityDays,
      reviewerId,
      version: content?.version,
      documentId: document?.id,
      bindingId: bindings.get(item.id)?.id,
      submissionId: submission?.id,
      received: Boolean(content?.received || content?.generated || content?.completed),
      review: content?.review?.decision,
    });
    if (
      document &&
      (sources.signatures.some((value) => value.id === item.id) ||
        rows(document.participantes).some((person) =>
          ['firmante', 'signer', 'firma'].includes(
            textValue(person.role || person.acto).toLowerCase()
          )
        ))
    )
      requiredSignatureSources.set(item.id, [document]);
  }
  for (const check of draft.verifications) {
    const stored = rows(snapshot.checks).find(
      (value) => value.template_verification_id === check.id && value.participant_id === subjectId
    );
    const result = record(stored?.result);
    const proof = record(result.proof);
    const verifiedSource = rows(snapshot.verification_sources).find(
      (value) =>
        value.id === proof.sourceId &&
        value.user_id === subject?.user_id &&
        value.status === 'completed' &&
        (check.catalogKey !== 'selfie' || value.face_match_passed === true)
    );
    const proofDocument = rows(snapshot.documents).find(
      (value) => value.id === proof.sourceId && value.sha256_hash === proof.sourceHash
    );
    const proofRequirement = rows(snapshot.requirements).find(
      (value) => value.id === proofDocument?.requirement_id
    );
    const proofReview = rows(snapshot.reviews).find(
      (value) =>
        value.id === proof.reviewId &&
        value.document_id === proofDocument?.id &&
        value.decision === 'accepted' &&
        value.reviewer_user_id === proofRequirement?.reviewer_user_id &&
        record(value.comparison_result).evidenceHash === proofDocument?.sha256_hash &&
        record(value.comparison_result).version ===
          record(proofDocument?.validation_result).sourceVersionId
    );
    const authorizedDocument =
      proof.type === 'document_review' &&
      proof.subjectId === subjectId &&
      Boolean(proofReview) &&
      eligibleMember(
        snapshot,
        textValue(proofRequirement?.reviewer_user_id),
        textValue(record(proofRequirement?.settings).reviewerRole)
      );
    const emailProof = rows(snapshot.email_proofs).find(
      (value) => value.id === proof.sourceId && value.verified_at && value.subjectId === subjectId
    );
    const authorizedEmail =
      check.catalogKey === 'email_otp' && proof.type === 'email_otp' && Boolean(emailProof);
    const valid =
      stored?.status === 'approved' &&
      Boolean(stored.evidence_hash) &&
      (authorizedDocument ||
        authorizedEmail ||
        (proof.subjectUserId === subject?.user_id &&
          Boolean(verifiedSource) &&
          proof.sourceUpdatedAt === verifiedSource?.updated_at)) &&
      (!stored.expires_at || Date.parse(textValue(stored.expires_at)) > now);
    evidence.verifications[check.id] = {
      status: valid ? 'approved' : textValue(stored?.status),
      subjectId,
      authorizedResult: valid,
    };
  }
  // Approval binds to material inputs only. Signature completion does not invalidate it.
  evidence.snapshotId = hash({
    policy: draft.reviewPolicy,
    subjectId,
    inputs: Object.entries(evidence.content).map(([id, value]) => [
      id,
      value.version,
      value.evidenceHash,
      value.applicable,
    ]),
    signing: [...currentDocuments.values()].map((doc) => [doc.id, signingScope(doc.participantes)]),
    signingGroups: rows(snapshot.signing_groups).map((group) => [
      group.id,
      group.document_id,
      group.completion_policy,
      rows(snapshot.signing_members)
        .filter((member) => member.group_id === group.id)
        .map((member) => member.participant_reference_id),
    ]),
    checks: rows(snapshot.checks).map((value) => [value.id, value.evidence_hash, value.status]),
  });
  const approval = record(snapshot.case.review_approval);
  const assignments = record(snapshot.case.runtime_assignments);
  if (draft.reviewPolicy.approval.enabled) {
    const approver = textValue(assignments.approver);
    if (!eligibleMember(snapshot, approver, draft.reviewPolicy.approval.role || ''))
      issues.push({
        key: 'approval',
        reason: 'El aprobador no tiene acceso vigente. Reasígnalo antes de aprobar.',
      });
    evidence.approval = {
      decision: textValue(approval.decision),
      snapshotId: textValue(approval.snapshotId),
      authorized:
        approval.actorId === approver &&
        eligibleMember(snapshot, approver, draft.reviewPolicy.approval.role || ''),
    };
    if (['corrections', 'rejected'].includes(textValue(approval.decision)))
      issues.push({
        key: 'approval-decision',
        reason: 'La autorización final tiene correcciones o rechazo pendiente de atender.',
      });
  }
  for (const [itemId, documents] of requiredSignatureSources) {
    const content = evidence.content[itemId];
    let complete = Boolean(content);
    const proofIds: string[] = [];
    for (const document of documents) {
      const references = rows(snapshot.references).filter(
        (value) =>
          value.document_id === document.id &&
          ['firmante', 'signer', 'firma'].includes(
            textValue(record(value.snapshot).role || record(value.snapshot).acto).toLowerCase()
          )
      );
      const version = rows(snapshot.source_versions)
        .filter((value) => value.document_id === document.id)
        .sort((a, b) => Number(b.version_number) - Number(a.version_number))[0];
      if (
        !references.length ||
        !version ||
        ['cancelado', 'rechazado', 'vencido'].includes(textValue(document.estado))
      )
        complete = false;
      const signatureFor = (reference: RuntimeRow) => {
        if (reference.active !== true) return null;
        const completion = rows(snapshot.completions).find(
          (value) =>
            value.participant_reference_id === reference.id &&
            value.document_id === document.id &&
            value.document_version_id === version?.id &&
            value.action_type === 'signature' &&
            value.status === 'committed'
        );
        const signature = rows(snapshot.signature_evidence).find(
          (value) =>
            value.id === completion?.signature_evidence_id &&
            value.document_id === document.id &&
            value.document_version_id === version?.id &&
            value.captured_by ===
              (completion?.effective_actor_user_id || completion?.actor_user_id) &&
            value.is_voided !== true &&
            value.document_sha256 === version?.sha256 &&
            Boolean(value.combined_sha256 || value.signature_hash || value.signed_payload_sha256)
        );
        return completion && signature ? signature : null;
      };
      const groups = rows(snapshot.signing_groups).filter(
        (group) => group.document_id === document.id
      );
      const groupMembers = rows(snapshot.signing_members).filter(
        (member) => member.document_id === document.id
      );
      const grouped = new Set(groupMembers.map((member) => member.participant_reference_id));
      for (const reference of references.filter((ref) => !grouped.has(ref.id))) {
        const proof = signatureFor(reference);
        if (!proof) complete = false;
        else proofIds.push(textValue(proof.id));
      }
      for (const group of groups) {
        const members = groupMembers.filter((member) => member.group_id === group.id);
        const proofs = members.map((member) => ({
          member,
          proof: signatureFor(
            references.find((ref) => ref.id === member.participant_reference_id) || {}
          ),
        }));
        const valid =
          group.status === 'satisfied' &&
          members.length > 0 &&
          (group.completion_policy === 'ANY_ONE'
            ? proofs.some(
                (value) =>
                  value.member.participant_reference_id === group.winner_participant_reference_id &&
                  Boolean(value.proof)
              )
            : ['ALL', 'ALL_MEMBERS'].includes(textValue(group.completion_policy))
              ? proofs.every((value) => Boolean(value.proof))
              : false);
        if (!valid) complete = false;
        else
          proofs.forEach((value) => {
            if (value.proof) proofIds.push(textValue(value.proof.id));
          });
      }
      for (const signer of rows(document.participantes).filter((person) =>
        ['firmante', 'signer', 'firma'].includes(
          textValue(person.role || person.acto).toLowerCase()
        )
      )) {
        if (
          !references.some(
            (ref) =>
              ref.id === signer.participant_ref_id ||
              (signer.id && ref.participant_json_id === signer.id) ||
              (signer.user_id && ref.participant_user_id === signer.user_id)
          )
        )
          complete = false;
      }
    }
    evidence.signatures[itemId] = {
      status: complete ? 'signed' : 'pending',
      version: content?.version || '',
      subjectId,
      documentHash: content?.evidenceHash || '',
      evidenceHash: complete ? hash(proofIds) : '',
      requestId: complete ? proofIds.join(':') : '',
    };
  }
  const result = evaluateCaseEligibility(draft, evidence);
  for (const [id] of requiredSignatureSources) {
    if (!sources.signatures.some((item) => item.id === id))
      result.conditions.push({
        key: `signature:${id}`,
        status: evidence.signatures[id].status === 'signed' ? 'satisfied' : 'pending',
        reason: 'Se exige el resultado de la firma configurada en el documento vinculado.',
      });
  }
  for (const issue of issues)
    result.conditions.push({
      key: `runtime:${issue.key}`,
      status: 'blocking',
      reason: issue.reason,
    });
  result.eligible = result.conditions.every((condition) =>
    ['satisfied', 'not_applicable'].includes(condition.status)
  );
  result.canApprove =
    result.canApprove && !issues.some((issue) => !['approval-decision'].includes(issue.key));
  const signingRequired = sources.signatureRequired || requiredSignatureSources.size > 0;
  result.canSign =
    signingRequired &&
    result.conditions
      .filter((condition) => !condition.key.startsWith('signature:'))
      .every((condition) => ['satisfied', 'not_applicable'].includes(condition.status));
  const stageState = new Map<string, boolean>();
  const evaluating = new Set<string>();
  const stages = draft.stages;
  const milestone = (id: string) =>
    rows(snapshot.milestones).find((value) => record(value.completion_condition_json).id === id);
  const activityDone = (kind: string, id: string | null) => {
    if (kind === 'close') return result.eligible;
    const key = [
      'receive_document',
      'create_document',
      'generate_document',
      'complete_form',
    ].includes(kind)
      ? `content:${id}`
      : kind === 'review_document'
        ? `review:${id}`
        : kind === 'verify'
          ? `verification:${id}`
          : kind === 'approve'
            ? 'approval'
            : `signature:${id}`;
    return result.conditions.some(
      (condition) =>
        condition.key === key && ['satisfied', 'not_applicable'].includes(condition.status)
    );
  };
  const stageDone = (id: string): boolean => {
    if (stageState.has(id)) return stageState.get(id)!;
    if (evaluating.has(id)) return false;
    evaluating.add(id);
    const stage = stages.find((value) => value.id === id);
    const prerequisites = Boolean(stage) && (stage!.dependsOn || []).every(stageDone);
    const completed = Boolean(
      stage &&
      prerequisites &&
      (stage.catalogKey === 'opening' ||
        (stage.completionMode === 'manual'
          ? milestone(id)?.status === 'completed'
          : (stage.activities || []).every((work) => activityDone(work.kind, work.refId))))
    );
    stageState.set(id, completed);
    evaluating.delete(id);
    return completed;
  };
  stages.forEach((stage) => stageDone(stage.id));
  const readyStageIds = stages
    .filter(
      (stage) =>
        !['opening', 'closing'].includes(stage.catalogKey) &&
        stage.completionMode === 'manual' &&
        (stage.dependsOn || []).every((id) => stageState.get(id)) &&
        (stage.activities || []).every((work) => activityDone(work.kind, work.refId))
    )
    .map((stage) => stage.id);
  if (draft.workflowMode === 'custom') {
    for (const stage of stages.filter(
      (stage) => !['opening', 'closing'].includes(stage.catalogKey)
    ))
      result.conditions.push({
        key: `stage:${stage.id}`,
        status: stageState.get(stage.id) ? 'satisfied' : 'pending',
        reason: `Etapa: ${stage.title}`,
      });
    result.reviewableIds = result.reviewableIds.filter((id) =>
      stages.some(
        (stage) =>
          stage.activities?.some((work) => work.kind === 'review_document' && work.refId === id) &&
          (stage.dependsOn || []).every((dependency) => stageState.get(dependency))
      )
    );
    result.canApprove =
      result.canApprove &&
      stages
        .filter((stage) => stage.activities?.some((work) => work.kind === 'approve'))
        .every((stage) => (stage.dependsOn || []).every((id) => stageState.get(id)));
    result.canSign =
      result.canSign &&
      stages
        .filter((stage) => stage.activities?.some((work) => work.kind === 'sign'))
        .every((stage) => (stage.dependsOn || []).every((id) => stageState.get(id)));
  }
  result.eligible = result.conditions.every((condition) =>
    ['satisfied', 'not_applicable'].includes(condition.status)
  );
  const stageStatuses = stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    manual: stage.completionMode === 'manual',
    coordinatorRole: stage.coordinatorRole,
    ready: readyStageIds.includes(stage.id),
    status: stageState.get(stage.id)
      ? 'completed'
      : (stage.dependsOn || []).every((id) => stageState.get(id))
        ? 'in_progress'
        : 'pending',
  }));
  return {
    draft,
    evidence,
    ...result,
    snapshotId: evidence.snapshotId,
    revision: snapshot.revision,
    items: itemViews,
    bindings,
    currentDocuments,
    readyStageIds,
    stageStatuses,
    signingStarted: rows(snapshot.completions).some((value) =>
      ['claimed', 'committed'].includes(textValue(value.status))
    ),
    operationalStatus: result.conditions.some((condition) => condition.status === 'blocking')
      ? 'observed'
      : sources.reviewed.some((item) => evidence.content[item.id])
        ? 'in_review'
        : 'integrating',
  };
}
