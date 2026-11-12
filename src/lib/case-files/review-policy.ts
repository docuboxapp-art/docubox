import type { CaseTemplateDraft, CaseTemplateStage } from './template-builder';

export type CaseControlRole = 'owner' | 'admin' | 'member';
export type ReviewOrigin = 'default' | 'user' | 'legacy';
export interface CaseReviewPolicy {
  version: number;
  reviewTiming: 'progressive' | 'after_collection';
  approval: { enabled: boolean; role: CaseControlRole | null };
  completion: { mode: 'automatic' | 'manual'; role: CaseControlRole | null };
  origin: ReviewOrigin;
  decisionOrigins: { reviewTiming: ReviewOrigin; approval: ReviewOrigin; completion: ReviewOrigin };
  compatibility: 'simple' | 'advanced' | 'incomplete';
}
export const CASE_CONTROL_ROLES: Record<CaseControlRole, string> = {
  owner: 'Responsable del expediente',
  admin: 'Administrador autorizado',
  member: 'Integrador autorizado',
};
const role = (value: unknown): CaseControlRole | null =>
  ['owner', 'admin', 'member'].includes(String(value)) ? (value as CaseControlRole) : null;
export function defaultReviewPolicy(): CaseReviewPolicy {
  return {
    version: 1,
    reviewTiming: 'progressive',
    approval: { enabled: false, role: null },
    completion: { mode: 'automatic', role: 'owner' },
    origin: 'default',
    decisionOrigins: { reviewTiming: 'default', approval: 'default', completion: 'default' },
    compatibility: 'simple',
  };
}
export function normalizeReviewPolicy(
  raw: unknown,
  legacyStages?: CaseTemplateStage[],
  custom = false
): CaseReviewPolicy {
  const defaults = defaultReviewPolicy();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (!legacyStages?.length) return defaults;
    const approval = legacyStages.find(
      (stage) => stage.requiresApproval || stage.activities?.some((item) => item.kind === 'approve')
    );
    const closing = legacyStages.find((stage) => stage.catalogKey === 'closing');
    return {
      ...defaults,
      origin: 'legacy',
      decisionOrigins: { reviewTiming: 'legacy', approval: 'legacy', completion: 'legacy' },
      compatibility: custom
        ? legacyStages.some(
            (stage) =>
              !stage.activities?.length && !['opening', 'closing'].includes(stage.catalogKey)
          )
          ? 'incomplete'
          : 'advanced'
        : 'simple',
      approval: { enabled: Boolean(approval), role: role(approval?.coordinatorRole) },
      completion: {
        mode: closing?.completionMode === 'all_activities' ? 'automatic' : 'manual',
        role: role(closing?.coordinatorRole),
      },
    };
  }
  const input = raw as Partial<CaseReviewPolicy>;
  const invalid =
    (input.reviewTiming !== undefined &&
      !['progressive', 'after_collection'].includes(input.reviewTiming)) ||
    (input.completion?.mode !== undefined &&
      !['automatic', 'manual'].includes(input.completion.mode)) ||
    (input.approval?.enabled !== undefined && typeof input.approval.enabled !== 'boolean');
  const decisionOrigin = (key: 'reviewTiming' | 'approval' | 'completion'): ReviewOrigin => {
    const origin = input.decisionOrigins?.[key] || input.origin;
    return origin === 'legacy' || origin === 'user' ? origin : 'default';
  };
  return {
    decisionOrigins: {
      reviewTiming: decisionOrigin('reviewTiming'),
      approval: decisionOrigin('approval'),
      completion: decisionOrigin('completion'),
    },
    version: invalid ? -1 : typeof input.version === 'number' ? input.version : 1,
    reviewTiming: input.reviewTiming === 'after_collection' ? 'after_collection' : 'progressive',
    approval: { enabled: input.approval?.enabled === true, role: role(input.approval?.role) },
    completion: {
      mode: input.completion?.mode === 'manual' ? 'manual' : 'automatic',
      role: role(input.completion?.role),
    },
    origin: ['user', 'legacy'].includes(String(input.origin)) ? input.origin! : 'default',
    compatibility:
      input.compatibility === 'advanced' || input.compatibility === 'incomplete'
        ? input.compatibility
        : 'simple',
  };
}
export function reviewPolicySources(draft: CaseTemplateDraft) {
  const items = draft.sections.flatMap((section) => section.items);
  const requested = items.filter(
    (item) => item.kind === 'requested_document' || item.kind === 'existing_document'
  );
  const forms = items.filter((item) => item.kind === 'form');
  const generated = items.filter((item) =>
    ['new_document', 'document_template'].includes(item.kind)
  );
  const reviewed = items.filter((item) => item.requiresReview);
  const signatureIds = new Set(
    draft.stages
      .flatMap((stage) => stage.activities || [])
      .filter((activity) => activity.kind === 'sign' && activity.required && activity.refId)
      .map((activity) => activity.refId!)
  );
  const signatures = items.filter((item) => item.requiresSignature || signatureIds.has(item.id));
  return {
    items,
    requested,
    forms,
    generated,
    reviewed,
    signatures,
    signatureRequired: draft.experience.signAtClosure || signatures.length > 0,
    verifications: draft.verifications,
  };
}
export function reviewPolicyIssues(
  draft: CaseTemplateDraft
): { code: string; message: string; itemId?: string }[] {
  const policy = draft.reviewPolicy;
  const source = reviewPolicySources(draft);
  const issues: { code: string; message: string; itemId?: string }[] = [];
  if (policy.version !== 1)
    issues.push({ code: 'policy_version', message: 'La versión de reglas no es compatible.' });
  if (!source.items.length)
    issues.push({
      code: 'empty_content',
      message:
        'Agrega contenido antes de publicar; un expediente vacío no se cierra automáticamente.',
    });
  if (policy.approval.enabled && !policy.approval.role)
    issues.push({
      code: 'approver_missing',
      message: 'Selecciona el rol que autorizará el expediente.',
    });
  if (policy.completion.mode === 'manual' && !policy.completion.role)
    issues.push({ code: 'closer_missing', message: 'Selecciona quién podrá confirmar el cierre.' });
  for (const item of source.reviewed)
    if (!item.reviewerRole)
      issues.push({
        code: 'reviewer_missing',
        message: `Asigna el rol revisor de «${item.title}» en Contenido.`,
        itemId: item.id,
      });
  if (source.signatureRequired && !source.signatures.length)
    issues.push({
      code: 'signature_source',
      message:
        'Vincula el documento, su versión y sus firmantes en la configuración original de firma.',
    });
  return issues;
}

/** Future requirements for preview. These are never evidence of compliance. */
export function reviewClosureConditions(draft: CaseTemplateDraft): string[] {
  const source = reviewPolicySources(draft);
  return [
    ...(source.requested.some((item) => item.required || item.conditional)
      ? ['Se exigirá recibir las aportaciones obligatorias y aplicables.']
      : []),
    ...(source.forms.some((item) => item.required || item.conditional)
      ? ['Se exigirá completar los formularios obligatorios.']
      : []),
    ...(source.generated.some((item) => item.required || item.conditional)
      ? ['Se exigirá terminar los documentos generados obligatorios.']
      : []),
    ...(source.reviewed.length
      ? ['Se exigirán revisiones favorables de las entregas que deban revisarse.']
      : []),
    ...(source.verifications.some((item) => item.required)
      ? ['Se exigirán verificaciones obligatorias satisfactorias.']
      : []),
    ...(draft.reviewPolicy.approval.enabled
      ? ['Se exigirá la aprobación final sobre la evidencia vigente.']
      : []),
    ...(source.signatureRequired
      ? ['Se exigirá completar las firmas obligatorias de las versiones correspondientes.']
      : []),
    'Se exigirá resolver observaciones bloqueantes y errores de trabajos indispensables.',
  ];
}

export interface CaseControlEvidence {
  content: Record<
    string,
    {
      applicable: boolean | null;
      applicabilityDecision?: { authorized: boolean; ruleId: string; subjectId: string };
      version: string | null;
      evidenceHash: string;
      subjectId: string | null;
      received?: boolean;
      completed?: boolean;
      generated?: boolean;
      review?: {
        decision: 'accepted' | 'observed' | 'rejected';
        evidenceHash: string;
        version: string;
        subjectId: string;
        authorized: boolean;
      };
    }
  >;
  verifications: Record<string, { status: string; subjectId: string; authorizedResult: boolean }>;
  signatures: Record<
    string,
    {
      status: string;
      version: string;
      subjectId: string;
      requestId: string;
      documentHash: string;
      evidenceHash: string;
    }
  >;
  subjectId: string;
  snapshotId: string;
  approval?: { decision: string; snapshotId: string; authorized: boolean };
  blockingObservations: number | null;
  failedRequiredJobs: number | null;
}
export interface CaseEligibilityCondition {
  key: string;
  status: 'satisfied' | 'pending' | 'blocking' | 'not_applicable' | 'failed';
  reason: string;
  evidenceVersion?: string;
}
/** Called only with evidence loaded and authorized by the server, never with a client success flag. */
export function evaluateCaseEligibility(draft: CaseTemplateDraft, evidence: CaseControlEvidence) {
  const conditions: CaseEligibilityCondition[] = [];
  const add = (
    key: string,
    status: CaseEligibilityCondition['status'],
    reason: string,
    evidenceVersion?: string
  ) => conditions.push({ key, status, reason, evidenceVersion });
  for (const issue of reviewPolicyIssues(draft))
    add(`configuration:${issue.code}:${issue.itemId || ''}`, 'blocking', issue.message);
  const source = reviewPolicySources(draft);
  if (!evidence.subjectId || !evidence.snapshotId)
    add('context', 'failed', 'Falta el sujeto o la versión verificable de la evaluación.');
  for (const item of source.items) {
    const current = evidence.content[item.id];
    if (item.conditional && current?.applicable == null) {
      add(`content:${item.id}`, 'blocking', 'La aplicabilidad sigue sin resolver.');
      continue;
    }
    if (current?.applicable === false) {
      const decision = current.applicabilityDecision;
      if (
        !item.conditional ||
        !decision?.authorized ||
        !decision.ruleId ||
        decision.subjectId !== evidence.subjectId
      ) {
        add(
          `content:${item.id}`,
          'blocking',
          'No aplica necesita una regla autorizada para este sujeto.'
        );
        continue;
      }
      add(`content:${item.id}`, 'not_applicable', 'No aplica a este expediente.');
      continue;
    }
    if (!item.required && !item.conditional && !current) {
      add(`content:${item.id}`, 'not_applicable', 'Elemento opcional sin entrega.');
      continue;
    }
    if (!current?.version || !current.evidenceHash || current.subjectId !== evidence.subjectId) {
      add(`content:${item.id}`, 'pending', 'Falta evidencia vigente del sujeto correspondiente.');
      continue;
    }
    const delivered =
      item.kind === 'form'
        ? current.completed
        : ['document_template', 'new_document'].includes(item.kind)
          ? current.generated
          : current.received;
    add(
      `content:${item.id}`,
      delivered ? 'satisfied' : 'pending',
      delivered
        ? 'Entrega de la versión vigente registrada.'
        : 'Aportación o generación pendiente.',
      current.version
    );
    if (item.requiresReview && delivered) {
      const reviewed = current.review;
      const accepted =
        reviewed?.decision === 'accepted' &&
        reviewed.authorized &&
        reviewed.version === current.version &&
        reviewed.evidenceHash === current.evidenceHash &&
        reviewed.subjectId === evidence.subjectId;
      add(
        `review:${item.id}`,
        accepted
          ? 'satisfied'
          : reviewed?.decision === 'observed' || reviewed?.decision === 'rejected'
            ? 'blocking'
            : 'pending',
        accepted
          ? 'Revisión autorizada de esta versión.'
          : 'Revisión pendiente, observada o desactualizada.',
        current.version
      );
    }
  }
  for (const check of source.verifications.filter((item) => item.required)) {
    const result = evidence.verifications[check.id];
    const accepted =
      result?.status === 'approved' &&
      result.authorizedResult &&
      result.subjectId === evidence.subjectId;
    add(
      `verification:${check.id}`,
      accepted ? 'satisfied' : 'pending',
      accepted
        ? 'Verificación válida para este sujeto.'
        : 'Verificación obligatoria pendiente o inválida.'
    );
  }
  for (const [key, count] of [
    ['observations', evidence.blockingObservations],
    ['jobs', evidence.failedRequiredJobs],
  ] as const)
    add(
      key,
      count === null ? 'failed' : count > 0 ? 'blocking' : 'satisfied',
      count === null
        ? 'No se pudieron evaluar los pendientes.'
        : count > 0
          ? 'Existen pendientes bloqueantes.'
          : 'Sin pendientes bloqueantes.'
    );
  const satisfied = (list: CaseEligibilityCondition[]) =>
    list.every((item) => ['satisfied', 'not_applicable'].includes(item.status));
  if (
    !source.items.some((item) => item.required || item.conditional) &&
    !Object.values(evidence.content).some(
      (item) => item.received || item.completed || item.generated
    )
  )
    add(
      'no_evidence',
      'blocking',
      'Falta una aportación aplicable; el expediente no se completa por ausencia de entregas.'
    );
  const controlsReady = satisfied(conditions);
  if (draft.reviewPolicy.approval.enabled) {
    const approval = evidence.approval;
    const accepted =
      controlsReady &&
      approval?.decision === 'approved' &&
      approval.authorized &&
      approval.snapshotId === evidence.snapshotId;
    add(
      'approval',
      accepted ? 'satisfied' : 'pending',
      accepted ? 'Aprobación vigente y autorizada.' : 'Falta aprobación de la evidencia actual.'
    );
  }
  const canSign = satisfied(conditions);
  for (const item of source.signatures) {
    const signed = evidence.signatures[item.id],
      current = evidence.content[item.id];
    if (
      (!item.required && !item.conditional && !current) ||
      (item.conditional &&
        current?.applicable === false &&
        current.applicabilityDecision?.authorized &&
        current.applicabilityDecision.subjectId === evidence.subjectId)
    ) {
      add(
        `signature:${item.id}`,
        'not_applicable',
        'El documento no forma parte de las entregas aplicables de este expediente.'
      );
      continue;
    }
    const accepted =
      signed?.status === 'signed' &&
      Boolean(signed.requestId && signed.evidenceHash) &&
      signed.version === current?.version &&
      signed.documentHash === current?.evidenceHash &&
      signed.subjectId === evidence.subjectId;
    add(
      `signature:${item.id}`,
      accepted ? 'satisfied' : 'pending',
      accepted
        ? 'Firma completada con evidencia de la versión vigente.'
        : 'Firma pendiente, parcial o correspondiente a otra versión.'
    );
  }
  const eligible = satisfied(conditions);
  const initialReady = source.items
    .filter(
      (item) =>
        ['requested_document', 'existing_document', 'form'].includes(item.kind) &&
        (item.required || item.conditional)
    )
    .every(
      (item) =>
        conditions.find((condition) => condition.key === `content:${item.id}`)?.status ===
          'satisfied' ||
        conditions.find((condition) => condition.key === `content:${item.id}`)?.status ===
          'not_applicable'
    );
  const reviewableIds = source.reviewed
    .filter(
      (item) =>
        (item.kind === 'form'
          ? evidence.content[item.id]?.completed
          : ['new_document', 'document_template'].includes(item.kind)
            ? evidence.content[item.id]?.generated
            : evidence.content[item.id]?.received) &&
        evidence.content[item.id]?.evidenceHash &&
        evidence.content[item.id]?.applicable !== false &&
        evidence.content[item.id]?.version &&
        evidence.content[item.id]?.subjectId === evidence.subjectId &&
        (draft.reviewPolicy.reviewTiming === 'progressive' || initialReady)
    )
    .map((item) => item.id);
  return {
    conditions,
    canApprove: draft.reviewPolicy.approval.enabled && controlsReady,
    canSign: source.signatureRequired && canSign,
    eligible,
    reviewableIds,
    nextState: eligible
      ? draft.reviewPolicy.completion.mode === 'manual'
        ? 'ready_to_close'
        : 'eligible_for_closure'
      : 'pending',
  };
}
