import { z } from 'zod';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
} from '@/lib/collaboration/server';
import { organizationApiFailure, OrganizationApiError } from '@/lib/organization/server';

export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const input = z
      .object({ workspace_id: z.string().uuid(), action: z.enum(['complete', 'cancel', 'reopen']) })
      .strict()
      .parse(await request.json());
    const { userClient, service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'collaboration_spaces.create',
      true,
      { type: 'milestone', id }
    );
    const current = await userClient
      .from('collaboration_milestones')
      .select('id,status,space_id')
      .eq('workspace_id', input.workspace_id)
      .eq('id', id)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data)
      throw new OrganizationApiError(404, 'milestone_not_found', 'El hito no está en tu alcance.');
    const closed = ['completed', 'cancelled'].includes(current.data.status);
    if (input.action === 'reopen' ? !closed : closed)
      throw new OrganizationApiError(
        409,
        'milestone_conflict',
        'El hito cambió de estado. Recarga antes de continuar.'
      );
    if (current.data.space_id) {
      const space = await userClient
        .from('collaboration_spaces')
        .select('status')
        .eq('workspace_id', input.workspace_id)
        .eq('id', current.data.space_id)
        .maybeSingle();
      if (space.error) throw space.error;
      if (!space.data || ['closed', 'archived'].includes(space.data.status))
        throw new OrganizationApiError(409, 'space_closed', 'El espacio ya no admite cambios.');
    }
    const status =
      input.action === 'complete'
        ? 'completed'
        : input.action === 'cancel'
          ? 'cancelled'
          : 'upcoming';
    const changed = await service
      .from('collaboration_milestones')
      .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('workspace_id', input.workspace_id)
      .eq('id', id)
      .eq('status', current.data.status)
      .select('id,status')
      .maybeSingle();
    if (changed.error) throw changed.error;
    if (!changed.data)
      throw new OrganizationApiError(
        409,
        'milestone_conflict',
        'Otra persona actualizó el hito. Recarga antes de continuar.'
      );
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: `collaboration.milestone_${input.action}`,
      resourceType: 'milestone',
      resourceId: id,
      summary: 'Se actualizó el estado de un hito.',
    });
    return Response.json({ success: true, data: changed.data });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
