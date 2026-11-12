import { CASE_CONTROL_ROLES, reviewPolicyIssues, reviewPolicySources } from './review-policy';
import {
  newCaseTemplateStage,
  type CaseTemplateDraft,
  type CaseTemplateItem,
  type CaseTemplateStage,
  type CaseWorkflowActivity,
  type CaseWorkflowActivityKind,
} from './template-builder';
import { caseStageSuggestions } from './template-catalog';

export interface WorkflowIssue {
  code: string;
  message: string;
  stageId?: string;
  itemId?: string;
}
export interface WorkflowValidation {
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
}

function activity(
  kind: CaseWorkflowActivityKind,
  refId: string | null,
  required = true
): CaseWorkflowActivity {
  return { id: `activity:${kind}:${refId || 'case'}`, kind, refId, required };
}

function contentActivity(item: CaseTemplateItem): CaseWorkflowActivity {
  const kind: CaseWorkflowActivityKind =
    item.kind === 'form'
      ? 'complete_form'
      : item.kind === 'document_template'
        ? 'generate_document'
        : item.kind === 'new_document'
          ? 'create_document'
          : 'receive_document';
  return activity(kind, item.id, item.required && !item.conditional);
}

function stage(
  key: string,
  activities: CaseWorkflowActivity[],
  dependsOn: string[],
  execution: 'parallel' | 'sequential' = 'sequential'
): CaseTemplateStage {
  const base = newCaseTemplateStage(key);
  return {
    ...base,
    id: `auto:${key}`,
    activities,
    dependsOn,
    execution,
    coordinatorRole: key === 'documents' || key === 'identity' ? 'member' : 'owner',
    completionMode: key === 'opening' || key === 'closing' ? 'manual' : 'all_activities',
    responsible:
      key === 'documents' || key === 'identity'
        ? 'Integrador del expediente'
        : 'Responsable del expediente',
    completionRule: '',
  };
}

/** The same content ID may be used by receipt and review activities without copying the requirement. */
export function suggestCaseWorkflow(
  draft: Pick<
    CaseTemplateDraft,
    'caseType' | 'caseSubtype' | 'sections' | 'verifications' | 'experience' | 'stages'
  >
): CaseTemplateStage[] {
  const items = draft.sections.flatMap((section) => section.items);
  const classification = `${draft.caseType} ${draft.caseSubtype}`.toLocaleLowerCase('es-MX');
  const profileId = /proveedor/.test(classification)
    ? 'supplier'
    : /cliente/.test(classification)
      ? 'client'
      : /laboral|emplead|trabajador/.test(classification)
        ? 'labor'
        : /contrat/.test(classification)
          ? 'contract'
          : /cumplimiento|auditor|regulator/.test(classification)
            ? 'compliance'
            : 'general';
  const profile = caseStageSuggestions.find((entry) => entry.id === profileId)!;
  const splitFormCapture = profile.keys.some((key) => key === 'capture');
  const formItems = items.filter((item) => item.kind === 'form');
  const documentItems = items.filter((item) => item.kind !== 'form');
  const stages: CaseTemplateStage[] = [stage('opening', [], [])];
  if (formItems.length && splitFormCapture)
    stages.push(stage('capture', formItems.map(contentActivity), ['auto:opening']));
  const collectionItems = formItems.length && splitFormCapture ? documentItems : items;
  if (collectionItems.length)
    stages.push(stage('documents', collectionItems.map(contentActivity), ['auto:opening']));
  const identityChecks = draft.verifications.filter(
    (item) => !['tax', 'compliance', 'sat'].includes(item.catalogKey)
  );
  const complianceChecks = draft.verifications.filter((item) =>
    ['tax', 'compliance', 'sat'].includes(item.catalogKey)
  );
  if (identityChecks.length)
    stages.push(
      stage(
        'identity',
        identityChecks.map((verification) =>
          activity('verify', verification.id, verification.required)
        ),
        ['auto:opening'],
        items.length ? 'parallel' : 'sequential'
      )
    );
  if (complianceChecks.length)
    stages.push(
      stage(
        'compliance',
        complianceChecks.map((verification) =>
          activity('verify', verification.id, verification.required)
        ),
        ['auto:opening'],
        items.length ? 'parallel' : 'sequential'
      )
    );
  const reviewItems = items.filter(
    (item) => item.kind === 'requested_document' && item.requiresReview
  );
  if (reviewItems.length)
    stages.push(
      stage(
        'review',
        reviewItems.map((item) => activity('review_document', item.id, item.required)),
        items.length ? ['auto:documents'] : ['auto:opening']
      )
    );
  const approvalConfigured = draft.stages.some(
    (entry) => entry.catalogKey === 'approval' && entry.requiresApproval
  );
  if (approvalConfigured)
    stages.push(stage('approval', [activity('approve', null)], [stages.at(-1)!.id]));
  if (draft.experience.signAtClosure)
    stages.push(stage('signature', [activity('sign', null)], [stages.at(-1)!.id]));
  stages.push(
    stage(
      'closing',
      [activity('close', null)],
      stages.filter((entry) => entry.id !== 'auto:opening').map((entry) => entry.id).length
        ? stages
            .filter(
              (entry) =>
                entry.id !== 'auto:opening' &&
                !stages.some((other) => other.dependsOn?.includes(entry.id))
            )
            .map((entry) => entry.id)
        : ['auto:opening']
    )
  );
  return stages;
}

export function resolvedCaseWorkflow(draft: CaseTemplateDraft): CaseTemplateStage[] {
  if (draft.workflowMode === 'custom') return draft.stages;
  const source = reviewPolicySources(draft);
  // Initial collection must never wait for documents produced later in the process.
  const initial = {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !source.generated.some((output) => output.id === item.id)
      ),
    })),
    stages: [],
    experience: { ...draft.experience, signAtClosure: false },
  };
  const stages = suggestCaseWorkflow(initial).filter(
    (entry) => !['closing', 'review'].includes(entry.catalogKey)
  );
  const initialReviews = source.reviewed.filter(
    (item) => !source.generated.some((output) => output.id === item.id)
  );
  if (initialReviews.length) {
    const review = stage(
      'review',
      initialReviews.map((item) => activity('review_document', item.id, item.required)),
      draft.reviewPolicy.reviewTiming === 'progressive'
        ? ['auto:opening']
        : stages
            .filter((entry) => ['documents', 'capture'].includes(entry.catalogKey))
            .map((entry) => entry.id)
    );
    review.description =
      draft.reviewPolicy.reviewTiming === 'progressive'
        ? 'Cada entrega válida habilita su revisión de forma independiente.'
        : 'La revisión comienza al reunir las aportaciones iniciales obligatorias.';
    stages.push(review);
  }
  if (source.generated.length) {
    stages.push({
      ...stage('documents', source.generated.map(contentActivity), ['auto:opening']),
      id: 'auto:preparation',
      catalogKey: 'preparation',
      title: 'Preparación de documentos',
      description: 'Crear o generar las versiones documentales requeridas según sus fuentes.',
    });
    const outputReviews = source.generated.filter((item) => item.requiresReview);
    if (outputReviews.length)
      stages.push({
        ...stage(
          'review',
          outputReviews.map((item) => activity('review_document', item.id, item.required)),
          ['auto:preparation']
        ),
        id: 'auto:review-prepared',
        catalogKey: 'review_prepared',
        title: 'Revisión de documentos preparados',
        description: 'Revisar las versiones generadas antes de la aprobación que las incluya.',
      });
  }
  if (draft.reviewPolicy.approval.enabled) {
    const approval = stage(
      'approval',
      [activity('approve', null)],
      stages.filter((entry) => entry.catalogKey !== 'opening').map((entry) => entry.id)
    );
    approval.coordinatorRole = draft.reviewPolicy.approval.role || undefined;
    approval.responsible = draft.reviewPolicy.approval.role
      ? CASE_CONTROL_ROLES[draft.reviewPolicy.approval.role]
      : 'Aprobador pendiente';
    stages.push(approval);
  }
  if (source.signatureRequired) {
    const signing = stage(
      'signature',
      source.signatures.length
        ? source.signatures.map((item) => activity('sign', item.id))
        : [activity('sign', null)],
      draft.reviewPolicy.approval.enabled
        ? ['auto:approval']
        : stages.filter((entry) => entry.catalogKey !== 'opening').map((entry) => entry.id)
    );
    signing.description = draft.reviewPolicy.approval.enabled
      ? 'Después de la aprobación final.'
      : 'Después de los controles previos obligatorios.';
    stages.push(signing);
  }
  const closing = stage(
    'closing',
    [activity('close', null)],
    stages
      .filter((entry) => !stages.some((other) => other.dependsOn?.includes(entry.id)))
      .map((entry) => entry.id)
  );
  closing.completionMode =
    draft.reviewPolicy.completion.mode === 'manual' ? 'manual' : 'all_activities';
  closing.coordinatorRole = draft.reviewPolicy.completion.role || undefined;
  closing.description =
    draft.reviewPolicy.completion.mode === 'manual'
      ? 'Se exigirá confirmación autorizada después de cumplir todas las condiciones.'
      : 'Se solicitará el cierre al cumplir todas las condiciones.';
  stages.push(closing);
  return stages;
}

export function validateCaseWorkflow(
  draft: CaseTemplateDraft,
  stages = resolvedCaseWorkflow(draft)
): WorkflowValidation {
  const errors: WorkflowIssue[] = reviewPolicyIssues(draft);
  const warnings: WorkflowIssue[] = [];
  const items = draft.sections.flatMap((section) => section.items);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const verificationById = new Map(draft.verifications.map((item) => [item.id, item]));
  const stageById = new Map(stages.map((item) => [item.id, item]));
  if (stageById.size !== stages.length)
    errors.push({ code: 'duplicate_stage', message: 'Hay identificadores de etapa duplicados.' });
  if (!stages.length) errors.push({ code: 'no_stages', message: 'Agrega al menos una etapa.' });
  const activityKeys = new Set<string>();
  for (const entry of stages) {
    if (!entry.title.trim())
      errors.push({
        code: 'stage_name',
        message: 'La etapa necesita un nombre.',
        stageId: entry.id,
      });
    if (!entry.coordinatorRole)
      errors.push({
        code: 'coordinator',
        message: 'Selecciona un coordinador de la etapa.',
        stageId: entry.id,
      });
    if (entry.completionMode === 'all_activities' && !entry.activities?.length)
      errors.push({
        code: 'empty_operational_stage',
        message: 'Esta etapa operativa no tiene actividades.',
        stageId: entry.id,
      });
    for (const dependency of entry.dependsOn || []) {
      if (dependency === entry.id || !stageById.has(dependency))
        errors.push({
          code: 'invalid_dependency',
          message: 'La etapa depende de una etapa inexistente o de sí misma.',
          stageId: entry.id,
        });
    }
    for (const work of entry.activities || []) {
      activityKeys.add(`${work.kind}:${work.refId || ''}`);
      if (
        [
          'receive_document',
          'create_document',
          'generate_document',
          'complete_form',
          'review_document',
        ].includes(work.kind) &&
        (!work.refId || !itemById.has(work.refId))
      )
        errors.push({
          code: 'orphan_content',
          message: 'Una actividad apunta a contenido inexistente.',
          stageId: entry.id,
        });
      if (work.kind === 'sign' && work.refId && !itemById.has(work.refId))
        errors.push({
          code: 'orphan_signature',
          message: 'La firma apunta a un documento inexistente.',
          stageId: entry.id,
        });
      if (work.kind === 'verify' && (!work.refId || !verificationById.has(work.refId)))
        errors.push({
          code: 'orphan_verification',
          message: 'Una actividad apunta a una verificación inexistente.',
          stageId: entry.id,
        });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id) || !stageById.has(id)) return false;
    visiting.add(id);
    for (const dependency of stageById.get(id)?.dependsOn || []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (stages.some((entry) => visit(entry.id)))
    errors.push({ code: 'cycle', message: 'Las dependencias de las etapas forman un ciclo.' });
  for (const item of items) {
    const expected = contentActivity(item);
    if (item.required && !item.conditional && !activityKeys.has(`${expected.kind}:${item.id}`))
      errors.push({
        code: 'unassigned_content',
        message: `Asigna «${item.title}» a una etapa.`,
        itemId: item.id,
      });
    if (item.requiresReview && !activityKeys.has(`review_document:${item.id}`))
      errors.push({
        code: 'missing_review',
        message: `Agrega revisión para «${item.title}».`,
        itemId: item.id,
      });
    if (item.kind === 'existing_document' && item.sourceId)
      errors.push({
        code: 'shared_document',
        message: `«${item.title}» conserva un documento fijo. Desvincúlalo; debe elegirse al abrir cada expediente.`,
        itemId: item.id,
      });
  }
  for (const verification of draft.verifications)
    if (verification.required && !activityKeys.has(`verify:${verification.id}`))
      errors.push({
        code: 'unassigned_verification',
        message: `Asigna «${verification.title}» a una etapa.`,
        itemId: verification.id,
      });
  if (draft.experience.signAtClosure && ![...activityKeys].some((key) => key.startsWith('sign:')))
    errors.push({
      code: 'missing_signature',
      message: 'La firma de cierre requiere una actividad de firma.',
    });
  if (draft.experience.signAtClosure)
    warnings.push({
      code: 'signature_integration',
      message:
        'La firma de cierre necesita vincularse a un documento y un flujo de firma real antes de publicar.',
    });
  return { errors, warnings };
}
