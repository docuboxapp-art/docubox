import type { SupabaseClient } from '@supabase/supabase-js';
import { OrganizationApiError } from '@/lib/organization/server';

export type OrganizationResourceType =
  | 'task'
  | 'document'
  | 'form'
  | 'form_response'
  | 'template'
  | 'case_file'
  | 'space'
  | 'request'
  | 'request_item'
  | 'request_file'
  | 'review'
  | 'version'
  | 'comment'
  | 'room'
  | 'automation'
  | 'milestone'
  | 'negotiation'
  | 'committee'
  | 'closing';
export type OrganizationResourceRef = { type: OrganizationResourceType; id: string };

export async function assertOrganizationScopeReady(
  userClient: SupabaseClient,
  workspaceId: string
) {
  const result = await userClient.rpc('organization_resource_scope_version', {
    ws_id: workspaceId,
  });
  if (result.error || result.data !== 1)
    throw new OrganizationApiError(
      503,
      'organization_scope_unavailable',
      'No se pudo comprobar la configuración de alcances de la organización.'
    );
}

export async function assertOrganizationResourceAccess(
  userClient: SupabaseClient,
  workspaceId: string,
  permission: string,
  resource: OrganizationResourceRef
) {
  const result = await userClient.rpc('organization_can_access_resource', {
    ws_id: workspaceId,
    requested_permission: permission,
    resource_type: resource.type,
    resource_id: resource.id,
  });
  if (result.error)
    throw new OrganizationApiError(
      503,
      'organization_scope_unavailable',
      'No se pudo comprobar el alcance del permiso. Intenta nuevamente.'
    );
  if (result.data !== true)
    throw new OrganizationApiError(
      403,
      'organization_resource_out_of_scope',
      'Este elemento está fuera del alcance de tu rol.'
    );
}

export async function assertOrganizationResourceCreation(
  userClient: SupabaseClient,
  workspaceId: string,
  permission: string,
  type: OrganizationResourceType,
  context: {
    assignedUserIds?: string[];
    assignedUnitIds?: string[];
    parentSpaceId?: string | null;
  } = {}
) {
  const result = await userClient.rpc('organization_can_create_resource', {
    ws_id: workspaceId,
    requested_permission: permission,
    resource_type: type,
    assigned_user_ids: context.assignedUserIds || [],
    assigned_unit_ids: context.assignedUnitIds || [],
    parent_space_id: context.parentSpaceId || null,
  });
  if (result.error)
    throw new OrganizationApiError(
      503,
      'organization_scope_unavailable',
      'No se pudo comprobar el alcance del permiso. Intenta nuevamente.'
    );
  if (result.data !== true)
    throw new OrganizationApiError(
      403,
      'organization_resource_out_of_scope',
      'La asignación o el espacio están fuera del alcance de tu rol.'
    );
}
