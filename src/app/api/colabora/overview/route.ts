import { organizationApiFailure } from '@/lib/organization/server';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';
import { canUseCollaboration } from '@/lib/collaboration/domain';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id') || '';
    const {
      userClient: service,
      user,
      access,
    } = await authorizeCollaborationRequest(request, workspaceId, 'collaboration.view_dashboard');
    const now = new Date().toISOString();
    const allowed = (permission: string) => canUseCollaboration(access, permission);
    const empty = { data: [], count: 0, error: null };
    const activeTasks = () =>
      service
        .from('tareas')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .not('estado', 'in', '(completada,cancelada,rechazada)');
    const countTasks = (query: ReturnType<typeof activeTasks>) =>
      allowed('tasks.view') ? query : Promise.resolve(empty);
    const [mine, dueSoon, overdue, blocked] = await Promise.all([
      countTasks(activeTasks().eq('assigned_to', user.id)),
      countTasks(
        activeTasks()
          .gte('due_date', now)
          .lte('due_date', new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString())
      ),
      countTasks(activeTasks().or(`is_overdue.eq.true,due_date.lt.${now}`)),
      countTasks(activeTasks().or('is_blocked.eq.true,estado.eq.bloqueada')),
    ]);

    const [tasks, reviews, spaces, requests, activity, members] = await Promise.all([
      allowed('tasks.view')
        ? service
            .from('tareas')
            .select(
              'id,title,estado,prioridad,due_date,is_blocked,is_overdue,assigned_to,document_name,collaboration_space_id'
            )
            .eq('workspace_id', workspaceId)
            .not('estado', 'in', '(completada,cancelada,rechazada)')
            .order('due_date', { ascending: true, nullsFirst: false })
            .limit(40)
        : Promise.resolve(empty),
      allowed('reviews.view')
        ? service
            .from('collaboration_review_rounds')
            .select('id,title,status,due_at,document_id,round_number', { count: 'exact' })
            .eq('workspace_id', workspaceId)
            .not('status', 'in', '(approved,closed,cancelled)')
            .order('due_at', { ascending: true, nullsFirst: false })
            .limit(12)
        : Promise.resolve(empty),
      allowed('collaboration_spaces.view')
        ? service
            .from('collaboration_spaces')
            .select('id,name,status,space_type,confidentiality,updated_at')
            .eq('workspace_id', workspaceId)
            .in('status', ['draft', 'active', 'on_hold'])
            .order('updated_at', { ascending: false })
            .limit(8)
        : Promise.resolve(empty),
      allowed('requests.view')
        ? service
            .from('collaboration_document_requests')
            .select('id,folio,title,status,recipient_name,due_at,updated_at', { count: 'exact' })
            .eq('workspace_id', workspaceId)
            .not('status', 'in', '(completed,cancelled,expired)')
            .order('due_at', { ascending: true, nullsFirst: false })
            .limit(8)
        : Promise.resolve(empty),
      service
        .from('collaboration_activity_events')
        .select('id,event_type,resource_type,resource_id,summary,occurred_at,actor_user_id')
        .eq('workspace_id', workspaceId)
        .order('occurred_at', { ascending: false })
        .limit(12),
      service
        .from('workspace_members')
        .select('id,user_id,role,user_profiles(full_name,email)')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active'),
    ]);
    for (const result of [
      tasks,
      reviews,
      spaces,
      requests,
      activity,
      members,
      mine,
      dueSoon,
      overdue,
      blocked,
    ]) {
      if (result.error) throw result.error;
    }

    const taskRows = tasks.data || [];
    return Response.json({
      success: true,
      data: {
        counters: {
          assigned_to_me: mine.count || 0,
          due_soon: dueSoon.count || 0,
          overdue: overdue.count || 0,
          blocked: blocked.count || 0,
          reviews: reviews.count || 0,
          requests: requests.count || 0,
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
