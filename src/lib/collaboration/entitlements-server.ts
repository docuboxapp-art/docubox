import type { SupabaseClient } from '@supabase/supabase-js';

const writableStatuses = new Set(['trialing', 'active', 'past_due']);
const readableStatuses = new Set([
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'expired',
]);

export async function hasCurrentCollaborationEntitlement(
  service: SupabaseClient,
  workspaceId: string,
  entitlementKey: string,
  write = false
) {
  const { data, error } = await service
    .from('organization_entitlements')
    .select('status,starts_at,ends_at,read_only_at')
    .eq('workspace_id', workspaceId)
    .eq('entitlement_key', entitlementKey)
    .maybeSingle();
  if (error || !data) return false;

  const now = Date.now();
  if (data.starts_at && new Date(data.starts_at).getTime() > now) return false;
  if (write) {
    return (
      writableStatuses.has(data.status) &&
      !data.read_only_at &&
      (!data.ends_at || new Date(data.ends_at).getTime() > now)
    );
  }
  return readableStatuses.has(data.status);
}
