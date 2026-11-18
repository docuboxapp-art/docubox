import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { assertOrganizationScopeReady } from '@/lib/organization/resource-access.server';
import {
  organizationRoleScopeSchema,
  isResourceScopedPermission,
} from '@/lib/organization/resource-scope';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';

export const runtime = 'nodejs';
const optionalUuid = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().uuid().nullable().optional()
);

const unitSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2).max(120),
  internal_key: z.string().trim().max(80).nullable().optional(),
  unit_type: z.enum(['area', 'department', 'team', 'branch', 'business_unit']),
  description: z.string().trim().max(1000).nullable().optional(),
  parent_id: optionalUuid,
  leader_member_id: optionalUuid,
  deputy_member_id: optionalUuid,
  cost_center_id: optionalUuid,
});

const roleSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    scope_type: z.enum(['organization', 'units', 'team', 'own', 'assigned', 'custom']),
    scope_config: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .superRefine((value, context) => {
    const parsed = organizationRoleScopeSchema.safeParse(value);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  })
  .transform((value) => ({ ...value, ...organizationRoleScopeSchema.parse(value) }));

async function audit(service: SupabaseClient, values: Record<string, unknown>) {
  const result = await service.from('organization_audit_events').insert(values);
  if (result.error) throw result.error;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const resource = url.searchParams.get('resource') || 'units';
    if (!['units', 'roles'].includes(resource))
      throw new OrganizationApiError(422, 'invalid_resource', 'Selecciona equipos o roles.');
    const permission = resource === 'roles' ? 'roles.read' : 'teams.read';
    const { service, userClient } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      permission
    );
    const management = await userClient.rpc('has_organization_permission', {
      ws_id: workspaceId,
      requested_permission: resource === 'roles' ? 'roles.manage' : 'teams.manage',
    });
    if (management.error)
      throw new OrganizationApiError(
        503,
        'permissions_unavailable',
        'No se pudieron comprobar los permisos.'
      );
    const capabilities = { canManage: management.data === true };

    if (resource === 'roles') {
      const [roles, permissions, assignments, scopeUnits] = await Promise.all([
        service
          .from('organization_roles')
          .select(
            'id,name,description,system_key,is_system,status,scope_type,scope_config,created_at,updated_at,organization_role_permissions(permission_id)'
          )
          .eq('workspace_id', workspaceId)
          .order('status')
          .order('is_system', { ascending: false })
          .order('name'),
        service
          .from('organization_permissions')
          .select('id,permission_key,name,description,category')
          .order('category')
          .order('name'),
        service.from('organization_member_roles').select('role_id').eq('workspace_id', workspaceId),
        service
          .from('organization_units')
          .select('id,name,unit_type')
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .order('name'),
      ]);
      if (roles.error) throw roles.error;
      if (permissions.error) throw permissions.error;
      if (assignments.error) throw assignments.error;
      if (scopeUnits.error) throw scopeUnits.error;
      const counts = (assignments.data || []).reduce<Record<string, number>>((result, item) => {
        result[item.role_id] = (result[item.role_id] || 0) + 1;
        return result;
      }, {});
      return Response.json({
        success: true,
        data: roles.data || [],
        permissions: permissions.data || [],
        member_counts: counts,
        scope_units: scopeUnits.data || [],
        capabilities,
      });
    }

    const [units, members, centers] = await Promise.all([
      service
        .from('organization_units')
        .select(
          'id,name,description,internal_key,unit_type,parent_id,leader_member_id,deputy_member_id,cost_center_id,status,policy_overrides,created_at,updated_at'
        )
        .eq('workspace_id', workspaceId)
        .order('status')
        .order('name'),
      service
        .from('workspace_members')
        .select('id,role,status,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('joined_at'),
      service
        .from('organization_cost_centers')
        .select('id,code,name,status')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('name'),
    ]);
    if (units.error) throw units.error;
    if (members.error) throw members.error;
    if (centers.error) throw centers.error;
    const allowedUnitIds = new Set((units.data || []).map((unit) => unit.id));
    const memberships = allowedUnitIds.size
      ? await service
          .from('organization_unit_members')
          .select('unit_id,member_id,is_lead,joined_at')
          .in('unit_id', [...allowedUnitIds])
      : { data: [], error: null };
    if (memberships.error) throw memberships.error;
    return Response.json({
      success: true,
      data: units.data || [],
      members: members.data || [],
      cost_centers: centers.data || [],
      memberships: (memberships.data || []).filter((item) => allowedUnitIds.has(item.unit_id)),
      capabilities,
    });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = String(body.workspace_id || '');
    const action = String(body.action || '');

    if (action === 'save_unit') {
      const { userClient } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'teams.manage'
      );
      const values = unitSchema.parse(body.unit || {});
      const memberIds =
        body.member_ids === undefined
          ? null
          : z.array(z.string().uuid()).max(1000).parse(body.member_ids);
      const result = await userClient.rpc('save_organization_unit_bundle', {
        ws_id: workspaceId,
        unit_data: values,
        requested_member_ids: memberIds,
      });
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(404, 'unit_not_found', 'No se encontró la unidad.');
      return Response.json({ success: true, id: result.data, request_id: requestId });
    }

    if (action === 'archive_unit') {
      const { user, service } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'teams.manage'
      );
      const unitId = z.string().uuid().parse(body.unit_id);
      const children = await service
        .from('organization_units')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('parent_id', unitId)
        .eq('status', 'active');
      if (children.error) throw children.error;
      if ((children.count || 0) > 0)
        throw new OrganizationApiError(
          409,
          'unit_has_active_children',
          'Mueve o archiva las unidades dependientes antes de continuar.'
        );
      const result = await service
        .from('organization_units')
        .update({ status: 'inactive', archived_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', unitId)
        .eq('status', 'active')
        .select('id')
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(404, 'unit_not_found', 'No se encontró una unidad activa.');
      await audit(service, {
        workspace_id: workspaceId,
        actor_user_id: user.id,
        event_type: 'organization.unit.archived',
        resource_type: 'organization_unit',
        resource_id: unitId,
        summary: 'Unidad organizacional archivada',
        correlation_id: requestId,
        module: 'teams',
        severity: 'high',
      });
      return Response.json({ success: true, request_id: requestId });
    }

    if (action === 'set_unit_members') {
      const { userClient } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'teams.manage'
      );
      const unitId = z.string().uuid().parse(body.unit_id);
      const memberIds = z
        .array(z.string().uuid())
        .max(1000)
        .parse(body.member_ids || []);
      const result = await userClient.rpc('set_organization_unit_members', {
        ws_id: workspaceId,
        target_unit_id: unitId,
        requested_member_ids: memberIds,
      });
      if (result.error) throw result.error;
      return Response.json({ success: true, request_id: requestId });
    }

    if (action === 'save_role') {
      const { user, userClient, service } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'roles.manage'
      );
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'roles.manage');
      const values = roleSchema.parse(body.role || {});
      if (values.scope_type !== 'organization')
        await assertOrganizationScopeReady(userClient, workspaceId);
      const permissionIds =
        body.permission_ids === undefined
          ? null
          : z.array(z.string().uuid()).max(300).parse(body.permission_ids);
      const unitIds = 'unit_ids' in values.scope_config ? values.scope_config.unit_ids : [];
      if (unitIds.length) {
        const units = await service
          .from('organization_units')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .in('id', unitIds);
        if (units.error) throw units.error;
        if (new Set(units.data?.map((unit) => unit.id)).size !== unitIds.length)
          throw new OrganizationApiError(
            422,
            'organization_scope_invalid',
            'Selecciona unidades activas de esta organización.'
          );
      }
      if (values.scope_type !== 'organization' && permissionIds?.length) {
        const selection = await service
          .from('organization_permissions')
          .select('id,permission_key')
          .in('id', permissionIds);
        if (selection.error) throw selection.error;
        if (
          selection.data?.some(
            (permission) => !isResourceScopedPermission(permission.permission_key)
          )
        )
          throw new OrganizationApiError(
            422,
            'organization_scope_permission_invalid',
            'Los permisos administrativos requieren el alcance Toda la organización.'
          );
      }
      const result = await userClient.rpc('save_organization_role_bundle', {
        ws_id: workspaceId,
        role_data: values,
        requested_permission_ids: permissionIds,
      });
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(404, 'role_not_found', 'No se encontró el rol.');
      return Response.json({ success: true, id: result.data, request_id: requestId });
    }

    if (action === 'set_role_permissions') {
      const { user, userClient, service } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'roles.manage'
      );
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'roles.manage');
      const roleId = z.string().uuid().parse(body.role_id);
      const permissionIds = z
        .array(z.string().uuid())
        .max(300)
        .parse(body.permission_ids || []);
      const catalog = permissionIds.length
        ? await service
            .from('organization_permissions')
            .select('id,permission_key')
            .in('id', permissionIds)
        : { data: [], error: null };
      if (catalog.error) throw catalog.error;
      if (
        new Set(catalog.data?.map((permission) => permission.id)).size !==
        new Set(permissionIds).size
      )
        throw new OrganizationApiError(
          422,
          'invalid_permissions',
          'Selecciona permisos válidos del catálogo.'
        );
      const result = await userClient.rpc('set_organization_role_permissions', {
        ws_id: workspaceId,
        target_role_id: roleId,
        permission_keys: catalog.data?.map((permission) => permission.permission_key) || [],
      });
      if (result.error) throw result.error;
      return Response.json({ success: true, request_id: requestId });
    }

    if (action === 'archive_role') {
      const { user, service } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'roles.manage'
      );
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'roles.manage');
      const roleId = z.string().uuid().parse(body.role_id);
      const role = await service
        .from('organization_roles')
        .select('id,is_system,status')
        .eq('workspace_id', workspaceId)
        .eq('id', roleId)
        .maybeSingle();
      if (role.error) throw role.error;
      if (!role.data)
        throw new OrganizationApiError(404, 'role_not_found', 'No se encontró el rol.');
      if (role.data.is_system)
        throw new OrganizationApiError(
          409,
          'system_role_protected',
          'Los roles de sistema no se pueden archivar.'
        );
      const assignments = await service
        .from('organization_member_roles')
        .select('member_id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('role_id', roleId);
      if (assignments.error) throw assignments.error;
      if ((assignments.count || 0) > 0)
        throw new OrganizationApiError(
          409,
          'role_has_members',
          'Reasigna los miembros antes de archivar este rol.'
        );
      const result = await service
        .from('organization_roles')
        .update({ status: 'archived', archived_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', roleId);
      if (result.error) throw result.error;
      await audit(service, {
        workspace_id: workspaceId,
        actor_user_id: user.id,
        event_type: 'organization.role.archived',
        resource_type: 'organization_role',
        resource_id: roleId,
        summary: 'Rol organizacional archivado',
        correlation_id: requestId,
        module: 'roles',
        severity: 'high',
      });
      return Response.json({ success: true, request_id: requestId });
    }

    throw new OrganizationApiError(400, 'invalid_action', 'Acción inválida.');
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return Response.json(
        {
          success: false,
          code: 'validation_error',
          error: 'Revisa los datos capturados.',
          details: cause.issues,
        },
        { status: 400 }
      );
    }
    return organizationApiFailure(cause);
  }
}
