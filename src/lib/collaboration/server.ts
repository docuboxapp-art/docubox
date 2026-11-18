import type { SupabaseClient, User } from '@supabase/supabase-js';
import { authenticateOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';
import {
  assertOrganizationResourceAccess,
  assertOrganizationResourceCreation,
  assertOrganizationScopeReady,
  type OrganizationResourceRef,
  type OrganizationResourceType,
} from '@/lib/organization/resource-access.server';
import {
  canUseCollaboration,
  hasCollaborationEntitlement,
  normalizeCollaborationAccess,
  type CollaborationAccess,
} from './domain';

export interface AuthorizedCollaborationRequest {
  user: User;
  userClient: SupabaseClient;
  service: SupabaseClient;
  access: CollaborationAccess;
}

export async function assertCollaborationCreationScope(
  userClient: SupabaseClient,
  workspaceId: string,
  permission: string,
  type: OrganizationResourceType,
  actor: string,
  values: Record<string, unknown>
) {
  const ids =
    type === 'review'
      ? (values.reviewer_ids as string[]) || []
      : type === 'request'
        ? [String(values.responsible_user_id || actor)]
        : type === 'task'
          ? values.assigned_to
            ? [String(values.assigned_to)]
            : []
          : ['space', 'room', 'milestone', 'negotiation'].includes(type)
            ? [String(values.owner_id || actor)]
            : [];
  const context = {
    assignedUserIds: ids,
    assignedUnitIds: values.assigned_team_id ? [String(values.assigned_team_id)] : [],
    parentSpaceId: String(values.space_id || values.collaboration_space_id || '') || null,
  };
  await assertOrganizationResourceCreation(userClient, workspaceId, permission, type, context);
  if (type === 'task' && (ids.some((id) => id !== actor) || context.assignedUnitIds.length))
    await assertOrganizationResourceCreation(
      userClient,
      workspaceId,
      'tasks.assign',
      type,
      context
    );
  const references: Array<OrganizationResourceRef> = [];
  if (values.document_id) references.push({ type: 'document', id: String(values.document_id) });
  if (values.document_version_id)
    references.push({ type: 'version', id: String(values.document_version_id) });
  const sourceTypes: Record<string, OrganizationResourceType> = {
    document: 'document',
    form: 'form',
    form_template: 'form',
    form_response: 'form_response',
    template: 'template',
    case_file: 'case_file',
    task: 'task',
    space: 'space',
    review: 'review',
  };
  if (values.source_id && sourceTypes[String(values.source_type)])
    references.push({
      type: sourceTypes[String(values.source_type)],
      id: String(values.source_id),
    });
  for (const reference of references)
    await assertOrganizationResourceAccess(userClient, workspaceId, permission, reference);
  if (Array.isArray(values.items))
    for (const item of values.items as Array<Record<string, unknown>>) {
      if (item.form_template_id)
        await assertOrganizationResourceAccess(userClient, workspaceId, permission, {
          type: 'form',
          id: String(item.form_template_id),
        });
      if (item.document_id)
        await assertOrganizationResourceAccess(userClient, workspaceId, permission, {
          type: 'document',
          id: String(item.document_id),
        });
    }
}

export async function authorizeCollaborationRequest(
  request: Request,
  workspaceId: string,
  permission?: string,
  write = false,
  resource?: OrganizationResourceRef
): Promise<AuthorizedCollaborationRequest> {
  if (!workspaceId) {
    throw new OrganizationApiError(400, 'workspace_required', 'Selecciona una organizacion.');
  }

  const authenticated = await authenticateOrganizationRequest(request);
  const { data, error } = await authenticated.userClient.rpc('get_my_collaboration_access', {
    ws_id: workspaceId,
  });
  if (error) {
    throw new OrganizationApiError(
      503,
      'collaboration_access_unavailable',
      'No se pudo verificar el acceso a Colabora.'
    );
  }

  const access = normalizeCollaborationAccess(data);
  if (!access.eligible) {
    throw new OrganizationApiError(
      403,
      'organization_required',
      'Colabora requiere una cuenta Organizacion activa.'
    );
  }
  if (!access.accessible) {
    throw new OrganizationApiError(
      402,
      'addon_required',
      'Activa Docubox Colabora para continuar.'
    );
  }
  if (!canUseCollaboration(access, permission, write)) {
    const code = write && !access.writeAllowed ? 'collaboration_read_only' : 'permission_denied';
    throw new OrganizationApiError(
      403,
      code,
      write && !access.writeAllowed
        ? 'Colabora se encuentra en modo de solo lectura.'
        : 'No tienes permiso para realizar esta accion.'
    );
  }

  // Legacy databases must not silently return organization-wide rows for a limited role.
  if (!['owner', 'admin'].includes(access.membershipRole))
    await assertOrganizationScopeReady(authenticated.userClient, workspaceId);

  if (resource && permission)
    await assertOrganizationResourceAccess(
      authenticated.userClient,
      workspaceId,
      permission,
      resource
    );
  return { ...authenticated, access };
}

export function requireCollaborationEntitlement(
  access: CollaborationAccess,
  entitlementKey: string,
  write = false,
  options: { proFeature?: boolean; minimumLevel?: 'enabled' | 'basic' | 'advanced' } = {}
) {
  if (
    !hasCollaborationEntitlement(access, entitlementKey, {
      write,
      proFeature: options.proFeature,
      minimumLevel: options.minimumLevel,
    })
  ) {
    throw new OrganizationApiError(
      402,
      options.proFeature ? 'PRO_PLAN_REQUIRED' : 'ADDON_REQUIRED',
      options.proFeature
        ? 'Funcion no disponible en el plan actual. Contacta a tu administrador.'
        : 'Tu plan no incluye esta funcion de Colabora.'
    );
  }
}

export async function recordCollaborationAudit(
  service: SupabaseClient,
  values: {
    workspaceId: string;
    actorUserId: string;
    eventType: string;
    resourceType: string;
    resourceId?: string | null;
    summary: string;
    payload?: Record<string, unknown>;
    outcome?: string;
  }
) {
  const { error } = await service.from('organization_audit_events').insert({
    workspace_id: values.workspaceId,
    actor_user_id: values.actorUserId,
    event_type: values.eventType,
    resource_type: values.resourceType,
    resource_id: values.resourceId || null,
    summary: values.summary,
    payload: values.payload || {},
    outcome: values.outcome || 'success',
    severity: 'info',
    module: 'colabora',
  });
  if (error) throw error;
}
