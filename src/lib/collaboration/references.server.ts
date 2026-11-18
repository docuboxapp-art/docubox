import type { SupabaseClient } from '@supabase/supabase-js';
import { OrganizationApiError } from '@/lib/organization/server';

export async function assertCollaborationReference(
  service: SupabaseClient,
  workspaceId: string,
  table: string,
  id: unknown,
  column = 'id'
) {
  if (!id) return;
  const allowed = [
    'workspace_members',
    'organization_units',
    'collaboration_spaces',
    'documentos',
    'document_versions',
    'case_files',
    'form_templates',
    'form_responses',
    'plantillas',
    'tareas',
    'collaboration_review_rounds',
  ];
  if (!allowed.includes(table))
    throw new OrganizationApiError(422, 'invalid_reference', 'Referencia no disponible.');
  let query = service
    .from(table)
    .select(table === 'workspace_members' ? 'user_id,status,access_expires_at' : 'id')
    .eq('workspace_id', workspaceId)
    .eq(column, id);
  if (table === 'workspace_members') query = query.eq('status', 'active');
  if (table === 'documentos') query = query.is('deleted_at', null);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  const row = result.data as unknown as { access_expires_at?: string } | null;
  if (
    !row ||
    (table === 'workspace_members' &&
      row.access_expires_at &&
      Date.parse(row.access_expires_at) <= Date.now())
  )
    throw new OrganizationApiError(
      422,
      'catalog_relation_scope',
      'Selecciona recursos y miembros activos de esta organización.'
    );
}

export async function assertCollaborationCreationReferences(
  service: SupabaseClient,
  ws: string,
  values: Record<string, unknown>
) {
  const lookups: Array<[string, unknown, string?]> = [
    ['collaboration_spaces', values.space_id || values.collaboration_space_id],
    ['workspace_members', values.owner_id, 'user_id'],
    ['workspace_members', values.assigned_to, 'user_id'],
    ['workspace_members', values.responsible_user_id, 'user_id'],
    ['organization_units', values.assigned_team_id],
    ['documentos', values.document_id],
    ['document_versions', values.document_version_id],
  ];
  if (Array.isArray(values.reviewer_ids))
    for (const id of new Set(values.reviewer_ids))
      lookups.push(['workspace_members', id, 'user_id']);
  await Promise.all(
    lookups
      .filter(([, id]) => id)
      .map(([table, id, column]) => assertCollaborationReference(service, ws, table, id, column))
  );
  if (values.source_id) {
    const tables: Record<string, string> = {
      document: 'documentos',
      form: 'form_templates',
      form_template: 'form_templates',
      form_response: 'form_responses',
      template: 'plantillas',
      case_file: 'case_files',
      task: 'tareas',
      user: 'workspace_members',
      space: 'collaboration_spaces',
      review: 'collaboration_review_rounds',
    };
    const table = tables[String(values.source_type)];
    if (!table)
      throw new OrganizationApiError(
        422,
        'source_required',
        'Selecciona un origen válido para la tarea.'
      );
    await assertCollaborationReference(
      service,
      ws,
      table,
      values.source_id,
      values.source_type === 'user' ? 'user_id' : 'id'
    );
  }
}
