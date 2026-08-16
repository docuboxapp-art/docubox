import { organizationApiFailure } from '@/lib/organization/server';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const { service, user, access } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      'collaboration.view_dashboard',
    );
    const now = new Date().toISOString();

    const [tasks, reviews, spaces, requests, activity, members] = await Promise.all([
      service.from('tareas')
        .select('id,title,estado,prioridad,due_date,is_blocked,is_overdue,assigned_to,document_name,collaboration_space_id')
        .eq('workspace_id', workspaceId)
        .not('estado', 'in', '(completada,cancelada,rechazada)')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(40),
      service.from('collaboration_review_rounds')
        .select('id,title,status,due_at,document_id,round_number')
        .eq('workspace_id', workspaceId)
        .not('status', 'in', '(approved,closed,cancelled)')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(12),
      service.from('collaboration_spaces')
        .select('id,name,status,space_type,confidentiality,updated_at')
        .eq('workspace_id', workspaceId)
        .in('status', ['draft', 'active', 'on_hold'])
        .order('updated_at', { ascending: false })
        .limit(8),
      service.from('collaboration_document_requests')
        .select('id,folio,title,status,recipient_name,due_at,updated_at')
        .eq('workspace_id', workspaceId)
        .not('status', 'in', '(completed,cancelled,expired)')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(8),
      service.from('collaboration_activity_events')
        .select('id,event_type,resource_type,resource_id,summary,occurred_at,actor_user_id')
        .eq('workspace_id', workspaceId)
        .order('occurred_at', { ascending: false })
        .limit(12),
      service.from('workspace_members')
        .select('id,user_id,role,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active'),
    ]);
    for (const result of [tasks, reviews, spaces, requests, activity, members]) {
      if (result.error) throw result.error;
    }

    const taskRows = tasks.data || [];
    const dueSoon = taskRows.filter((item) => item.due_date && item.due_date >= now
      && new Date(item.due_date).getTime() <= Date.now() + 72 * 60 * 60 * 1000).length;
    const overdue = taskRows.filter((item) => item.is_overdue || (item.due_date && item.due_date < now)).length;
    return Response.json({
      success: true,
      data: {
        counters: {
          assigned_to_me: taskRows.filter((item) => item.assigned_to === user.id).length,
          due_soon: dueSoon,
          overdue,
          blocked: taskRows.filter((item) => item.is_blocked || item.estado === 'bloqueada').length,
          reviews: (reviews.data || []).length,
          requests: (requests.data || []).length,
        },
        tasks: taskRows,
        reviews: reviews.data || [],
        spaces: spaces.data || [],
        requests: requests.data || [],
        activity: activity.data || [],
        members: members.data || [],
        access,
      },
    });
  } catch (error) {
    return organizationApiFailure(error);
  }
}

