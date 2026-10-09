import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeFormTemplate,
  type FormTemplate,
  type FormField,
  type FormSection,
  type FormSettings,
  type PdfSchema,
} from './schema';

export const FORM_STATUS_LABELS: Record<FormTemplate['status'], string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  published: 'Publicado',
  paused: 'Pausado',
  archived: 'Archivado',
};

interface FormTemplateRow {
  id: string;
  name: string;
  description?: string | null;
  status: FormTemplate['status'];
  workspace_id: string;
  schema?: FormField[];
  form_schema?: { fields?: FormField[]; sections?: FormSection[] };
  settings?: Partial<FormSettings> & { sections?: FormSection[] };
  pdf_schema?: Partial<PdfSchema>;
  pdf_base_path?: string | null;
  root_template_id?: string | null;
  source_template_id?: string | null;
  version_number?: number;
  revision_number?: number;
  publication_comment?: string | null;
  published_at?: string | null;
  approval_workflow_id?: string | null;
  approval_workflow_instance_id?: string | null;
  archived_from_status?: FormTemplate['status'] | null;
  updated_at?: string;
}

export function formTemplateFromRow(row: FormTemplateRow): FormTemplate {
  return normalizeFormTemplate({
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status,
    schema: Array.isArray(row.form_schema?.fields) ? row.form_schema.fields : row.schema || [],
    sections: row.form_schema?.sections || row.settings?.sections || [],
    settings: {
      ...row.settings,
      pdfSchema:
        row.pdf_schema && Object.keys(row.pdf_schema).length
          ? row.pdf_schema
          : row.settings?.pdfSchema,
    },
    pdfBasePath: row.pdf_base_path || undefined,
    workspaceId: row.workspace_id,
    rootTemplateId: row.root_template_id || undefined,
    sourceTemplateId: row.source_template_id || undefined,
    versionNumber: row.version_number || 1,
    revisionNumber: row.revision_number || 1,
    publicationComment: row.publication_comment || '',
    publishedAt: row.published_at || undefined,
    updatedAt: row.updated_at || undefined,
  });
}

export function signatureFieldError(template: FormTemplate): string | null {
  return !template.schema.some((field) => field.type === 'signature_block')
    ? 'Agrega el campo Firma en Contenido antes de continuar.'
    : null;
}

export function publicationError(template: FormTemplate): string | null {
  if (!template.name.trim()) return 'Escribe el nombre del formulario.';
  if (template.settings.accessMode === 'public' && template.settings.allowedSignatureTypes.length > 0 && !template.settings.allowedSignatureTypes.includes('autografa_digital'))
    return 'El enlace público requiere firma autógrafa digital para solicitar la prueba de vida.';
  const missingSignature = signatureFieldError(template);
  if (missingSignature) return missingSignature;
  if (!template.schema.length) return 'Agrega al menos un campo antes de publicar.';
  if (template.schema.some((field) => !field.label.trim() || !field.slug.trim()))
    return 'Completa la etiqueta y el nombre interno de cada campo.';
  if (new Set(template.schema.map((field) => field.slug)).size !== template.schema.length)
    return 'Cada campo debe tener un nombre interno diferente.';
  if (template.settings.configureLinkExpiration && (!Number.isFinite(template.settings.expirationHours) || template.settings.expirationHours < 1 / 60 || template.settings.expirationHours > 720))
    return 'La vigencia del enlace debe estar entre 1 minuto y 720 horas.';
  return null;
}

export function formSaveError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'PGRST202' || code === '42703')
    return 'Los estados y el versionado requieren aplicar la migración de formularios en este entorno.';
  if (code === '42501') return 'No tienes permiso para guardar este formulario.';
  if (code === '23503')
    return 'El formulario tiene información vinculada y no se puede eliminar. Puedes archivarlo.';
  if (code === 'PGRST116')
    return 'El formulario cambió en otra sesión o ya no tienes acceso. Recarga antes de continuar.';
  return error instanceof Error
    ? error.message
    : 'No se pudo guardar el formulario. Tus cambios siguen en el editor.';
}

export type FormPublicationContext = {
  workspaceType: 'personal' | 'business';
  approvalWorkflow: { id: string; name: string; version: number } | null;
  permissions: {
    canSaveDraft: boolean;
    canPublish: boolean;
    canSubmitApproval: boolean;
    canCreateVersion: boolean;
  };
};

export async function submitFormForApproval(
  client: SupabaseClient,
  formId: string,
  workspaceId: string,
  workflowId: string
) {
  const { data: instanceId, error } = await client.rpc('submit_form_for_approval', {
    ws_id: workspaceId,
    target_form_id: formId,
    target_workflow_id: workflowId,
    requested_context: { form_id: formId },
    requested_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
  if (typeof instanceId !== 'string') throw new Error('No se confirmó la instancia de aprobación.');
  const result = await client.from('form_templates').select('*').eq('id', formId).single();
  if (result.error || !result.data) throw result.error || new Error('No se confirmó el envío a aprobación.');
  return formTemplateFromRow(result.data);
}

export async function persistFormDraft(
  client: SupabaseClient,
  template: FormTemplate,
  workspaceId: string,
  userId: string
) {
  if (template.status !== 'draft' || template.publishedAt)
    throw new Error('Crea una nueva versión para editar este formulario.');
  if (template.workspaceId && template.workspaceId !== workspaceId)
    throw new Error('El formulario pertenece a otro espacio de trabajo.');
  const payload = {
    name: template.name,
    description: template.description,
    schema: template.schema,
    settings: { ...template.settings, sections: template.sections },
    pdf_base_path: template.pdfBasePath || null,
    publication_comment: template.publicationComment || null,
  };
  let query;
  if (template.id) {
    query = client
      .from('form_templates')
      .update(payload)
      .eq('id', template.id)
      .eq('workspace_id', workspaceId)
      .eq('status', 'draft');
    if (template.updatedAt) query = query.eq('updated_at', template.updatedAt);
  } else {
    query = client
      .from('form_templates')
      .insert({ ...payload, status: 'draft', workspace_id: workspaceId, created_by: userId });
  }
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  if (!data) throw new Error('No se confirmó el guardado del formulario.');
  return formTemplateFromRow(data);
}

export async function publishFormDraft(client: SupabaseClient, template: FormTemplate) {
  const invalid = publicationError(template);
  if (invalid) throw new Error(invalid);
  if (!template.id || template.status !== 'draft' || !template.updatedAt)
    throw new Error('Guarda el borrador antes de publicar.');
  const { data, error } = await client
    .from('form_templates')
    .update({ status: 'published' })
    .eq('id', template.id)
    .eq('workspace_id', template.workspaceId)
    .eq('status', 'draft')
    .eq('updated_at', template.updatedAt)
    .select('*')
    .single();
  if (error) throw error;
  if (!data) throw new Error('No se confirmó la publicación.');
  return formTemplateFromRow(data);
}

export async function createFormVersion(client: SupabaseClient, sourceId: string) {
  const { data, error } = await client.rpc('create_form_template_version', { source_id: sourceId });
  if (error) throw error;
  const row = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!row?.id) throw new Error('No se pudo crear la nueva versión.');
  return formTemplateFromRow(row);
}

export async function createFormRevision(client: SupabaseClient, sourceId: string) {
  const { data, error } = await client.rpc('create_form_template_revision', { source_id: sourceId });
  if (error) throw error;
  const row = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!row?.id) throw new Error('No se pudo crear la revisión de la versión actual.');
  return formTemplateFromRow(row);
}

export async function switchFormDraftVersionMode(
  client: SupabaseClient,
  template: FormTemplate,
  mode: 'revision' | 'version',
  workspaceId: string,
  userId: string
) {
  if (!template.id || !template.rootTemplateId || template.status !== 'draft')
    throw new Error('Solo se puede cambiar la modalidad de un borrador de edición.');

  let sourceId = template.sourceTemplateId;
  if (!sourceId) {
    const { data, error } = await client
      .from('form_templates')
      .select('id')
      .eq('workspace_id', workspaceId)
      .or(`id.eq.${template.rootTemplateId},root_template_id.eq.${template.rootTemplateId}`)
      .not('published_at', 'is', null)
      .neq('status', 'in_review')
      .lt('version_number', template.versionNumber || 1)
      .order('version_number', { ascending: false })
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    sourceId = data?.id;
  }
  if (!sourceId) throw new Error('No se encontró la versión publicada de origen.');

  const created = mode === 'revision'
    ? await createFormRevision(client, sourceId)
    : await createFormVersion(client, sourceId);
  let replacement: FormTemplate;
  try {
    replacement = await persistFormDraft(client, {
      ...template,
      id: created.id,
      rootTemplateId: created.rootTemplateId,
      sourceTemplateId: created.sourceTemplateId,
      versionNumber: created.versionNumber,
      revisionNumber: created.revisionNumber,
      publishedAt: undefined,
      updatedAt: created.updatedAt,
    }, workspaceId, userId);
  } catch (cause) {
    await client.from('form_templates').delete().eq('id', created.id).eq('workspace_id', workspaceId).eq('status', 'draft');
    throw cause;
  }

  const { data: removed, error: removeError } = await client
    .from('form_templates')
    .delete()
    .eq('id', template.id)
    .eq('workspace_id', workspaceId)
    .eq('status', 'draft')
    .select('id');
  return { template: replacement, previousDraftRetained: Boolean(removeError || !removed?.length) };
}
