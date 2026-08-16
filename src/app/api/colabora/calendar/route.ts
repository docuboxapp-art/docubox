import { organizationApiFailure } from '@/lib/organization/server';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';

export const runtime = 'nodejs';

type CalendarRow = Record<string, unknown> & {
  id: string;
  source_type: string;
  title: string;
  starts_at: string | null;
  due_at: string | null;
  status: string;
};

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      'collaboration_spaces.view'
    );
    const [milestones, tasks, reviews, requests] = await Promise.all([
      service
        .from('collaboration_milestones')
        .select('id,title,description,status,starts_at,due_at,space_id,owner_id')
        .eq('workspace_id', workspaceId),
      service
        .from('tareas')
        .select('id,title,description,estado,due_date,collaboration_space_id,assigned_to')
        .eq('workspace_id', workspaceId)
        .not('due_date', 'is', null),
      service
        .from('collaboration_review_rounds')
        .select('id,title,status,due_at,document_id,requested_by')
        .eq('workspace_id', workspaceId)
        .not('due_at', 'is', null),
      service
        .from('collaboration_document_requests')
        .select('id,title,status,due_at,space_id,responsible_user_id')
        .eq('workspace_id', workspaceId)
        .not('due_at', 'is', null),
    ]);
    for (const result of [milestones, tasks, reviews, requests]) {
      if (result.error) throw result.error;
    }
    const rows: CalendarRow[] = [
      ...(milestones.data || []).map((item) => ({
        ...item,
        source_type: 'milestone',
      })),
      ...(tasks.data || []).map((item) => ({
        id: item.id,
        source_type: 'task',
        title: item.title,
        description: item.description,
        status: item.estado,
        starts_at: null,
        due_at: item.due_date,
        space_id: item.collaboration_space_id,
        owner_id: item.assigned_to,
      })),
      ...(reviews.data || []).map((item) => ({
        ...item,
        source_type: 'review',
        starts_at: null,
        owner_id: item.requested_by,
      })),
      ...(requests.data || []).map((item) => ({
        ...item,
        source_type: 'document_request',
        starts_at: null,
        owner_id: item.responsible_user_id,
      })),
    ].sort((a, b) => {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });
    return Response.json({ success: true, data: rows.slice(0, 500) });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
