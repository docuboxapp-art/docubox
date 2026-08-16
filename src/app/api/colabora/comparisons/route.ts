import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
  requireCollaborationEntitlement,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const comparisonSchema = z.object({
  workspace_id: z.string().uuid(),
  document_id: z.string().uuid(),
  left_version_id: z.string().uuid(),
  right_version_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = comparisonSchema.parse(await request.json());
    if (input.left_version_id === input.right_version_id) {
      throw new OrganizationApiError(
        400,
        'distinct_versions_required',
        'Selecciona dos versiones diferentes.'
      );
    }

    const { service, user, access } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'versions.compare',
      true
    );
    requireCollaborationEntitlement(access, 'collaboration_advanced_reviews', true);

    const { data: versions, error: versionsError } = await service
      .from('document_versions')
      .select('id,document_id,version_number')
      .eq('workspace_id', input.workspace_id)
      .eq('document_id', input.document_id)
      .in('id', [input.left_version_id, input.right_version_id]);
    if (versionsError) throw versionsError;
    if ((versions || []).length !== 2) {
      throw new OrganizationApiError(
        404,
        'versions_not_found',
        'No se encontraron ambas versiones dentro del documento seleccionado.'
      );
    }

    const { data: usageResult, error: usageError } = await service.rpc(
      'record_collaboration_usage',
      {
        ws_id: input.workspace_id,
        requested_entitlement_key: 'collaboration_advanced_reviews',
        requested_meter_key: 'comparisons',
        requested_quantity: 1,
        requested_idempotency_key: input.idempotency_key,
        requested_resource_type: 'document_version_comparison',
        requested_resource_id: input.document_id,
        requested_metadata: {
          left_version_id: input.left_version_id,
          right_version_id: input.right_version_id,
          actor_user_id: user.id,
        },
      }
    );
    if (usageError) throw usageError;
    const usageEvent = usageResult as { event_id?: string; created?: boolean } | null;

    if (usageEvent?.created !== false) {
      await recordCollaborationAudit(service, {
        workspaceId: input.workspace_id,
        actorUserId: user.id,
        eventType: 'collaboration.versions_compared',
        resourceType: 'document',
        resourceId: input.document_id,
        summary: 'Se compararon dos versiones documentales.',
        payload: {
          left_version_id: input.left_version_id,
          right_version_id: input.right_version_id,
          usage_event_id: usageEvent?.event_id,
          idempotency_key: input.idempotency_key,
        },
      });
    }

    return Response.json({
      success: true,
      data: {
        usage_event_id: usageEvent?.event_id,
        idempotent: usageEvent?.created === false,
      },
    });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
