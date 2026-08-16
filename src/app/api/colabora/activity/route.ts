import { z } from 'zod';
import { organizationApiFailure } from '@/lib/organization/server';
import {
  authorizeCollaborationRequest,
  recordCollaborationAudit,
} from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const inputSchema = z.object({
  workspace_id: z.string().uuid(),
  action: z.literal('mark_read'),
  event_ids: z.array(z.string().uuid()).max(300).optional(),
});

export async function PATCH(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    const { service, user } = await authorizeCollaborationRequest(
      request,
      input.workspace_id,
      'collaboration.view_dashboard',
      true
    );
    let query = service
      .from('collaboration_activity_events')
      .select('id,read_by')
      .eq('workspace_id', input.workspace_id)
      .limit(300);
    if (input.event_ids?.length) query = query.in('id', input.event_ids);
    const events = await query;
    if (events.error) throw events.error;
    const updates = await Promise.all(
      (events.data || [])
        .filter((event) => !(event.read_by || []).includes(user.id))
        .map((event) =>
          service
            .from('collaboration_activity_events')
            .update({ read_by: [...(event.read_by || []), user.id] })
            .eq('workspace_id', input.workspace_id)
            .eq('id', event.id)
        )
    );
    const failed = updates.find((update) => update.error);
    if (failed?.error) throw failed.error;
    await recordCollaborationAudit(service, {
      workspaceId: input.workspace_id,
      actorUserId: user.id,
      eventType: 'collaboration.activity_marked_read',
      resourceType: 'activity_feed',
      summary: 'Se marcaron eventos del feed como leidos.',
      payload: { count: updates.length },
    });
    return Response.json({ success: true, updated: updates.length });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
