import { validateCaseWorkflow } from './workflow';
import { reviewPolicySources } from './review-policy';
import type { CaseTemplateDraft } from './template-builder';

export interface CasePublicationResource {
  workspaceId: string;
  status: string;
  version: string;
  revision?: number | null;
}
export interface CasePublicationRepository {
  resource: (
    kind: 'form' | 'document_template',
    id: string
  ) => Promise<CasePublicationResource | null>;
}
export interface CaseRuntimeCapabilities {
  transitions: boolean;
  versionedEvidence: boolean;
  approval: boolean;
  signatures: boolean;
}
/** Server entry point. Resource authorization is checked independently of client labels and counts. */
export async function validateCaseReviewPublication(
  draft: CaseTemplateDraft,
  workspaceId: string,
  repository: CasePublicationRepository,
  capabilities: CaseRuntimeCapabilities
) {
  const issues = validateCaseWorkflow(draft).errors;
  if (!draft.name?.trim())
    issues.push({ code: 'name_required', message: 'Escribe el nombre del tipo de expediente.' });
  const items = draft.sections.flatMap((section) => section.items);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    issues.push({
      code: 'duplicate_content',
      message: 'Cada elemento de contenido necesita un identificador único.',
    });
  if (
    draft.sections.some((section) => !section.title?.trim()) ||
    items.some((item) => !item.title?.trim())
  )
    issues.push({
      code: 'title_required',
      message: 'Completa los nombres de las secciones y de su contenido.',
    });
  const linked = draft.sections
    .flatMap((section) => section.items)
    .filter((item) => item.kind === 'form' || item.kind === 'document_template');
  const resources = await Promise.all(
    linked.map(async (item) => ({
      item,
      resource: item.sourceId
        ? await repository.resource(item.kind as 'form' | 'document_template', item.sourceId)
        : null,
    }))
  );
  for (const { item, resource } of resources) {
    if (!resource || resource.workspaceId !== workspaceId || resource.status !== 'published')
      issues.push({
        code: 'resource_access',
        message: `Selecciona un recurso publicado y autorizado para «${item.title}».`,
        itemId: item.id,
      });
    else if (
      !item.sourceVersion ||
      resource.version !== item.sourceVersion ||
      (item.sourceRevision != null && item.sourceRevision !== resource.revision)
    )
      issues.push({
        code: 'resource_version',
        message: `Confirma la versión del recurso vinculado a «${item.title}».`,
        itemId: item.id,
      });
  }
  if (!capabilities.transitions || !capabilities.versionedEvidence)
    issues.push({
      code: 'runtime_unavailable',
      message:
        'La ejecución y la evidencia versionada de expedientes aún no están habilitadas. Guarda el borrador.',
    });
  if (draft.reviewPolicy.approval.enabled && !capabilities.approval)
    issues.push({
      code: 'approval_unavailable',
      message:
        'La aprobación global del expediente requiere conectar su servicio antes de publicar.',
    });
  if (reviewPolicySources(draft).signatureRequired && !capabilities.signatures)
    issues.push({
      code: 'signature_unavailable',
      message: 'La firma del expediente requiere una integración operativa antes de publicar.',
    });
  return { valid: issues.length === 0, issues, policyVersion: draft.reviewPolicy.version };
}
