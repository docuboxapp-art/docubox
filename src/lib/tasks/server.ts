import { createAnonClient, createServiceClient } from '@/lib/supabase/server';

export async function authorizeTaskRequest(request: Request, workspaceId: string) {
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const { data: auth, error } = await createAnonClient().auth.getUser(jwt);
  if (error || !auth.user) return null;
  const service = createServiceClient();
  const { data: membership } = await service.from('workspace_members')
    .select('role,status').eq('workspace_id', workspaceId).eq('user_id', auth.user.id).maybeSingle();
  if (!membership || membership.status !== 'active') return null;
  return { user: auth.user, role: membership.role as 'owner' | 'admin' | 'member', service };
}
