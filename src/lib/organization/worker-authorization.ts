import type { SupabaseClient } from '@supabase/supabase-js';

export class OrganizationWorkerAccessError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(
      retryable
        ? 'No se pudieron comprobar los permisos de ejecución.'
        : 'La ejecución ya no está autorizada por la organización.'
    );
  }
}

export async function authorizeOrganizationWorkerAction(
  service: SupabaseClient,
  input: {
    sourceId: string;
    sourceType: 'automation' | 'workflow';
    workspaceId: string;
    actionType: string;
    documentId?: string | null;
    assigneeId?: string | null;
  }
) {
  const { data, error } = await service.rpc('organization_authorize_automation_action', {
    source_id: input.sourceId,
    source_type: input.sourceType,
    action_type: input.actionType,
    document_id: input.documentId || null,
    event_actor_id: input.assigneeId || null,
  });
  if (error)
    throw new OrganizationWorkerAccessError('organization_worker_access_unavailable', true);
  if (
    data?.allowed !== true ||
    data.workspace_id !== input.workspaceId ||
    typeof data.principal_id !== 'string'
  )
    throw new OrganizationWorkerAccessError('organization_worker_access_denied', false);
  return data.principal_id as string;
}
