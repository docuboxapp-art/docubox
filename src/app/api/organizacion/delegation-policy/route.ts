import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';
import { normalizeOrganizationDelegationPolicy } from '@/lib/organization/delegation-policy';
import { PHASE_D_FLAGS, isPhaseDFeatureEnabled } from '@/lib/organization/phase-d';

export const runtime = 'nodejs';

const updateSchema = z.object({
  workspace_id: z.string().uuid(),
  mode: z.enum(['DISABLED', 'ORGANIZATION_ONLY', 'AUTHORIZED_MEMBERS']),
  allowed_member_ids: z.array(z.string().uuid()).max(250).default([]),
  allowed_roles: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
});

export async function GET(request: Request) {
  try {
    const workspaceId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get('workspace_id') || '');
    const { service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'organization.read'
    );
    const result = await service
      .from('workspaces')
      .select('organization_settings')
      .eq('id', workspaceId)
      .single();
    if (result.error) throw result.error;
    return Response.json({
      success: true,
      data: normalizeOrganizationDelegationPolicy(result.data?.organization_settings),
    });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateSchema.parse(await request.json());
    const { user, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      'delegation.manage'
    );
    if (!(await isPhaseDFeatureEnabled(service, PHASE_D_FLAGS.delegation))) {
      throw new OrganizationApiError(409, 'feature_disabled', 'La delegación no está habilitada.');
    }
    if (
      input.mode === 'AUTHORIZED_MEMBERS' &&
      input.allowed_member_ids.length === 0 &&
      input.allowed_roles.length === 0
    ) {
      throw new OrganizationApiError(
        400,
        'delegation_policy_empty',
        'Selecciona al menos un miembro o rol autorizado.'
      );
    }
    const result = await service.rpc('set_organization_delegation_policy', {
      p_workspace_id: input.workspace_id,
      p_actor_user_id: user.id,
      p_mode: input.mode,
      p_allowed_member_ids: input.allowed_member_ids,
      p_allowed_roles: input.allowed_roles,
    });
    if (result.error) throw result.error;
    return Response.json({ success: true, data: result.data });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return organizationApiFailure(
        new OrganizationApiError(400, 'invalid_request', 'La política no es válida.')
      );
    }
    return organizationApiFailure(cause);
  }
}
