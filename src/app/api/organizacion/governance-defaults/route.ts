import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const updateSchema = z.object({
  workspace_id: z.string().uuid(),
  kind: z.enum(['workflow', 'signature_policy']),
  resource_id: z.string().uuid().nullable(),
});

const configuration = {
  workflow: {
    permission: 'workflows.manage',
    setting: 'default_workflow_id',
    table: 'organization_approval_workflows',
    resourceType: 'organization_approval_workflow',
  },
  signature_policy: {
    permission: 'signature_policies.manage',
    setting: 'default_signature_policy_id',
    table: 'organization_signature_policies',
    resourceType: 'organization_signature_policy',
  },
} as const;

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
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
    const settings = (result.data?.organization_settings || {}) as Record<string, unknown>;
    return Response.json({
      success: true,
      defaults: {
        workflow_id: settings.default_workflow_id || null,
        signature_policy_id: settings.default_signature_policy_id || null,
      },
    });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PATCH(request: Request) {
  const correlationId = randomUUID();
  try {
    const input = updateSchema.parse(await request.json());
    const config = configuration[input.kind];
    const { user, userClient, service } = await authorizeOrganizationRequest(
      request,
      input.workspace_id,
      config.permission
    );
    await requireOrganizationReauthentication(
      request,
      input.workspace_id,
      user.id,
      config.permission
    );

    let resource: Record<string, unknown> | null = null;
    if (input.resource_id) {
      const result = await service
        .from(config.table)
        .select('id,name,version,status')
        .eq('workspace_id', input.workspace_id)
        .eq('id', input.resource_id)
        .eq('status', 'published')
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        throw new OrganizationApiError(
          409,
          'published_resource_required',
          'Selecciona una versión publicada y vigente.'
        );
      }
      resource = result.data;
    }

    const updated = await userClient.rpc('set_organization_governance_default', {
      ws_id: input.workspace_id,
      requested_kind: input.kind,
      requested_resource_id: input.resource_id,
      requested_correlation_id: correlationId,
    });
    if (updated.error) {
      if (updated.error.message.includes('published_resource_required')) {
        throw new OrganizationApiError(
          409,
          'published_resource_required',
          'Selecciona una versión publicada y vigente.'
        );
      }
      throw updated.error;
    }

    return Response.json({ success: true, resource, result: updated.data });
  } catch (cause) {
    if (cause instanceof z.ZodError) {
      return organizationApiFailure(
        new OrganizationApiError(400, 'invalid_request', 'La configuración no es válida.')
      );
    }
    return organizationApiFailure(cause);
  }
}
