import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CaseRuntimeError, isUuid } from './runtime.server';
export async function requireCaseWorkspace(
  service: SupabaseClient,
  workspaceId: unknown,
  actorId: string
) {
  if (!isUuid(workspaceId))
    throw new CaseRuntimeError('CASE_INPUT_INVALID', 'Selecciona un espacio de trabajo.', 422);
  const m = await service
    .from('workspace_members')
    .select('role,status,access_expires_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', actorId)
    .eq('status', 'active')
    .maybeSingle();
  if (m.error) throw m.error;
  if (!m.data || (m.data.access_expires_at && Date.parse(m.data.access_expires_at) <= Date.now()))
    throw new CaseRuntimeError('CASE_ACCESS_DENIED', 'No tienes acceso activo al espacio.', 403);
  return m.data;
}
