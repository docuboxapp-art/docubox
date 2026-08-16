import type { SupabaseClient, User } from '@supabase/supabase-js';
import { authenticateOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';
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

export async function authorizeCollaborationRequest(
  request: Request,
  workspaceId: string,
  permission?: string,
  write = false
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

  return { ...authenticated, access };
}

export function requireCollaborationEntitlement(
  access: CollaborationAccess,
  entitlementKey: string,
  write = false,
  options: { proFeature?: boolean; minimumLevel?: 'enabled' | 'basic' | 'advanced' } = {},
) {
  if (!hasCollaborationEntitlement(access, entitlementKey, {
    write,
    proFeature: options.proFeature,
    minimumLevel: options.minimumLevel,
  })) {
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
