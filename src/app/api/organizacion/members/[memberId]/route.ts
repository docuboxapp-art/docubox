import { randomUUID } from 'crypto';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';
import { createNotificationServer } from '@/lib/notificationsInApp';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ memberId: string }> };

const memberColumns = [
  'id',
  'workspace_id',
  'user_id',
  'role',
  'status',
  'job_title',
  'mfa_required',
  'biometric_required',
  'access_expires_at',
  'joined_at',
  'suspended_at',
  'offboarded_at',
  'last_access_at',
  'user_profiles(id,full_name,email,avatar_url,telefono,mfa_enabled,mfa_method,mfa_enrolled_at,created_at)',
].join(',');

function log(event: string, values: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      scope: 'organization.member-detail',
      event,
      at: new Date().toISOString(),
      ...values,
    })
  );
}

function includesPermission(permissions: string[], permission: string) {
  return permissions.includes(permission);
}

function safeError(cause: any, fallback: string) {
  const message = String(cause?.message || '');
  const known: Record<string, string> = {
    organization_permission_denied: 'No tienes permiso para realizar esta acción.',
    organization_member_not_found: 'No se encontró el miembro.',
    organization_owner_role_is_protected: 'El rol del propietario está protegido.',
    organization_owner_access_is_protected: 'El acceso del propietario está protegido.',
    organization_cannot_suspend_self: 'No puedes suspender tu propia cuenta.',
    organization_admin_assignment_requires_owner:
      'Solo el propietario puede asignar el rol de administrador.',
    organization_role_scope_invalid: 'Uno de los roles no pertenece a esta organización.',
    organization_unit_scope_invalid: 'Uno de los equipos no pertenece a esta organización.',
  };
  const key = Object.keys(known).find((candidate) => message.includes(candidate));
  return new OrganizationApiError(
    key ? 400 : 500,
    key || 'member_operation_failed',
    key ? known[key] : fallback
  );
}

export async function GET(request: Request, { params }: RouteContext) {
  const started = Date.now();
  const requestId = randomUUID();
  try {
    const { memberId } = await params;
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { user, userClient, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'members.read'
    );

    const [targetResult, viewerResult, permissionResult] = await Promise.all([
      service
        .from('workspace_members')
        .select(memberColumns)
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      service
        .from('workspace_members')
        .select('id,role,status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle(),
      userClient.rpc('get_my_organization_permissions', { ws_id: workspaceId }),
    ]);
    if (targetResult.error) throw targetResult.error;
    if (!targetResult.data)
      throw new OrganizationApiError(404, 'member_not_found', 'No se encontró el miembro.');
    if (permissionResult.error) throw permissionResult.error;

    const target = targetResult.data as any;
    const permissions = (permissionResult.data || []).map(
      (item: any) => item.permission_key as string
    );
    const viewerRole = viewerResult.data?.role || 'member';
    const elevated = viewerRole === 'owner' || viewerRole === 'admin';
    const canReadSecurity = elevated || includesPermission(permissions, 'security.read');
    const canReadAuthorities = elevated || includesPermission(permissions, 'authorities.read');
    const canReadAudit = elevated || includesPermission(permissions, 'audit.read');

    const rolesPromise = service
      .from('organization_member_roles')
      .select('role_id,assigned_at,organization_roles(id,name,description,system_key,is_system)')
      .eq('workspace_id', workspaceId)
      .eq('member_id', memberId)
      .order('assigned_at');
    const unitsPromise = service
      .from('organization_unit_members')
      .select('unit_id,is_lead,joined_at,organization_units(id,name,description,parent_id,status)')
      .eq('member_id', memberId)
      .order('joined_at');
    const availableRolesPromise = service
      .from('organization_roles')
      .select('id,name,description,system_key,is_system')
      .eq('workspace_id', workspaceId)
      .order('is_system', { ascending: false })
      .order('name');
    const availableUnitsPromise = service
      .from('organization_units')
      .select('id,name,description,parent_id,status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .order('name');

    const [roles, units, availableRoles, availableUnits] = await Promise.all([
      rolesPromise,
      unitsPromise,
      availableRolesPromise,
      availableUnitsPromise,
    ]);
    for (const result of [roles, units, availableRoles, availableUnits]) {
      if (result.error) throw result.error;
    }

    let authorities: any[] = [];
    if (canReadAuthorities) {
      const result = await service
        .from('organization_authorities')
        .select(
          'id,authority_type,modality,scope,valid_from,valid_until,status,monetary_limit,currency,document_types,areas,required_representatives,identity_required,created_at'
        )
        .eq('workspace_id', workspaceId)
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });
      if (result.error) throw result.error;
      authorities = result.data || [];
    }

    let audit: any[] = [];
    if (canReadAudit) {
      const result = await service
        .from('organization_audit_events')
        .select(
          'id,event_type,resource_type,resource_id,summary,outcome,severity,module,origin,occurred_at,actor_user_id'
        )
        .eq('workspace_id', workspaceId)
        .or(`resource_id.eq.${memberId},actor_user_id.eq.${target.user_id}`)
        .order('occurred_at', { ascending: false })
        .limit(100);
      if (result.error) throw result.error;
      audit = result.data || [];
    }

    let security: Record<string, unknown> | null = null;
    if (canReadSecurity) {
      const [sessionsResult, totpResult, credentialsResult, securityEventsResult] =
        await Promise.all([
          userClient.rpc('get_organization_security_sessions', { ws_id: workspaceId }),
          service
            .from('user_totp_settings')
            .select('is_enabled,confirmed_at,last_used_at,locked_until,updated_at')
            .eq('user_id', target.user_id)
            .maybeSingle(),
          service
            .from('webauthn_credentials')
            .select(
              'id,device_name,device_type,device_category,os,browser,context,registered_from,is_active,created_at,last_used_at'
            )
            .eq('user_id', target.user_id)
            .order('created_at', { ascending: false }),
          service
            .from('auth_security_events')
            .select('id,event_type,description,ip_address,created_at')
            .eq('user_id', target.user_id)
            .order('created_at', { ascending: false })
            .limit(30),
        ]);
      if (sessionsResult.error) throw sessionsResult.error;
      if (totpResult.error) throw totpResult.error;
      if (credentialsResult.error) throw credentialsResult.error;
      if (securityEventsResult.error) throw securityEventsResult.error;
      security = {
        totp: totpResult.data || null,
        credentials: credentialsResult.data || [],
        sessions: (sessionsResult.data || []).filter(
          (session: any) => session.member_id === memberId
        ),
        events: securityEventsResult.data || [],
      };
    }

    let work: Record<string, unknown> | null = null;
    if (elevated) {
      const [documentsResult, tasksResult] = await Promise.all([
        service
          .from('documentos')
          .select('id,documento_id,nombre,estado,updated_at')
          .eq('workspace_id', workspaceId)
          .eq('owner_id', target.user_id)
          .order('updated_at', { ascending: false })
          .limit(25),
        service
          .from('tareas')
          .select('id,title,tipo,prioridad,estado,due_date,document_id,updated_at')
          .eq('workspace_id', workspaceId)
          .eq('assigned_to', target.user_id)
          .order('updated_at', { ascending: false })
          .limit(25),
      ]);
      if (documentsResult.error) throw documentsResult.error;
      if (tasksResult.error) throw tasksResult.error;
      work = { documents: documentsResult.data || [], tasks: tasksResult.data || [] };
    }

    const capabilities = {
      updateMember: elevated || includesPermission(permissions, 'members.update'),
      suspendMember: elevated || includesPermission(permissions, 'members.suspend'),
      offboardMember: elevated || includesPermission(permissions, 'members.offboard'),
      manageRoles: elevated || includesPermission(permissions, 'roles.manage'),
      manageTeams: elevated || includesPermission(permissions, 'teams.manage'),
      readSecurity: canReadSecurity,
      manageSecurity: elevated || includesPermission(permissions, 'security.manage'),
      readAuthorities: canReadAuthorities,
      readAudit: canReadAudit,
      readWork: elevated,
    };

    log('read.completed', {
      request_id: requestId,
      workspace_id: workspaceId,
      member_id: memberId,
      duration_ms: Date.now() - started,
    });
    return Response.json({
      success: true,
      data: {
        member: target,
        roles: roles.data || [],
        units: units.data || [],
        available_roles: availableRoles.data || [],
        available_units: availableUnits.data || [],
        authorities,
        security,
        work,
        audit,
        capabilities,
      },
      request_id: requestId,
    });
  } catch (cause) {
    log('read.failed', { request_id: requestId, duration_ms: Date.now() - started });
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const started = Date.now();
  const requestId = randomUUID();
  try {
    const { memberId } = await params;
    const body = await request.json();
    const action = String(body.action || '');
    const workspaceId = String(body.workspace_id || '');
    let actorUserId: string | null = null;

    if (action === 'update_member') {
      const { user, service } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'members.update'
      );
      actorUserId = user.id;
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'members.update');
      const accessExpiresAt = body.access_expires_at ? new Date(body.access_expires_at) : null;
      if (accessExpiresAt && Number.isNaN(accessExpiresAt.getTime())) {
        throw new OrganizationApiError(
          400,
          'invalid_access_expiration',
          'La fecha de expiración no es válida.'
        );
      }
      const target = await service
        .from('workspace_members')
        .select('id,role')
        .eq('workspace_id', workspaceId)
        .eq('id', memberId)
        .maybeSingle();
      if (target.error) throw target.error;
      if (!target.data)
        throw new OrganizationApiError(404, 'member_not_found', 'No se encontró el miembro.');
      const result = await service
        .from('workspace_members')
        .update({
          job_title: String(body.job_title || '').trim() || null,
          access_expires_at: accessExpiresAt?.toISOString() || null,
          mfa_required: Boolean(body.mfa_required),
          biometric_required: Boolean(body.biometric_required),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', memberId);
      if (result.error) throw result.error;
      const audit = await service.from('organization_audit_events').insert({
        workspace_id: workspaceId,
        actor_user_id: user.id,
        event_type: 'member.profile.updated',
        resource_type: 'workspace_member',
        resource_id: memberId,
        summary: 'Configuración del miembro actualizada',
        payload: {
          mfa_required: Boolean(body.mfa_required),
          biometric_required: Boolean(body.biometric_required),
          has_access_expiration: Boolean(accessExpiresAt),
        },
        module: 'members',
      });
      if (audit.error) throw audit.error;
    } else if (action === 'set_status') {
      const { user, userClient } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'members.suspend'
      );
      actorUserId = user.id;
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'members.suspend');
      const result = await userClient.rpc('set_organization_member_access_status', {
        ws_id: workspaceId,
        target_member_id: memberId,
        requested_status: String(body.status || ''),
      });
      if (result.error) throw safeError(result.error, 'No se pudo actualizar el acceso.');
    } else if (action === 'set_roles') {
      const { user, userClient } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'roles.manage'
      );
      actorUserId = user.id;
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'roles.manage');
      const roleIds = Array.isArray(body.role_ids) ? body.role_ids.map(String) : [];
      const result = await userClient.rpc('set_organization_member_roles', {
        ws_id: workspaceId,
        target_member_id: memberId,
        requested_role_ids: roleIds,
      });
      if (result.error) throw safeError(result.error, 'No se pudieron actualizar los roles.');
    } else if (action === 'set_units') {
      const { user, userClient } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'teams.manage'
      );
      actorUserId = user.id;
      const unitIds = Array.isArray(body.unit_ids) ? body.unit_ids.map(String) : [];
      const result = await userClient.rpc('set_organization_member_units', {
        ws_id: workspaceId,
        target_member_id: memberId,
        requested_unit_ids: unitIds,
      });
      if (result.error) throw safeError(result.error, 'No se pudieron actualizar los equipos.');
    } else if (action === 'revoke_sessions') {
      const { user, userClient } = await authorizeOrganizationRequest(
        request,
        workspaceId,
        'security.manage'
      );
      actorUserId = user.id;
      await requireOrganizationReauthentication(request, workspaceId, user.id, 'security.manage');
      const result = await userClient.rpc('revoke_organization_member_sessions', {
        ws_id: workspaceId,
        target_member_id: memberId,
        revocation_reason: String(body.reason || ''),
      });
      if (result.error) throw safeError(result.error, 'No se pudieron revocar las sesiones.');
      log('sessions.revoked', {
        request_id: requestId,
        workspace_id: workspaceId,
        member_id: memberId,
        revoked_count: result.data,
      });
    } else {
      throw new OrganizationApiError(400, 'invalid_action', 'Acción inválida.');
    }

    const target = await createServiceClient()
      .from('workspace_members')
      .select('user_id,workspaces(name)')
      .eq('workspace_id', workspaceId)
      .eq('id', memberId)
      .maybeSingle();
    if (target.data?.user_id && target.data.user_id !== actorUserId) {
      const messages: Record<
        string,
        { title: string; description: string; priority: 'alta' | 'media' }
      > = {
        update_member: {
          title: 'Tu acceso organizacional cambió',
          description: 'Se actualizaron los requisitos o la vigencia de tu acceso.',
          priority: 'media',
        },
        set_status: {
          title: 'Estado de acceso actualizado',
          description: `Tu acceso a ${(target.data.workspaces as any)?.name || 'la organización'} cambió a ${String(body.status || '')}.`,
          priority: 'alta',
        },
        set_roles: {
          title: 'Roles actualizados',
          description: 'Tus roles y permisos dentro de la organización fueron actualizados.',
          priority: 'alta',
        },
        set_units: {
          title: 'Equipos actualizados',
          description: 'Cambió tu asignación de equipos o áreas dentro de la organización.',
          priority: 'media',
        },
        revoke_sessions: {
          title: 'Sesiones revocadas',
          description: 'Un administrador cerró tus sesiones organizacionales por seguridad.',
          priority: 'alta',
        },
      };
      const notification = messages[action];
      if (notification) {
        await createNotificationServer({
          userId: target.data.user_id,
          type: action === 'set_status' || action === 'revoke_sessions' ? 'alert' : 'info',
          title: notification.title,
          description: notification.description,
          priority: notification.priority,
          metadata: {
            workspace_id: workspaceId,
            member_id: memberId,
            event: `organization_member_${action}`,
          },
        });
      }
    }

    log('write.completed', {
      request_id: requestId,
      workspace_id: workspaceId,
      member_id: memberId,
      action,
      duration_ms: Date.now() - started,
    });
    return Response.json({ success: true, request_id: requestId });
  } catch (cause) {
    log('write.failed', { request_id: requestId, duration_ms: Date.now() - started });
    return organizationApiFailure(cause);
  }
}
