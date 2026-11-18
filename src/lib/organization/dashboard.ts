import type { SupabaseClient } from '@supabase/supabase-js';

export type OrganizationDashboardSummary = {
  members: number | null;
  teams: number | null;
  pendingInvitations: number | null;
  customRoles: number | null;
  recentEvents: Array<{
    id: string;
    summary: string;
    event_type: string;
    occurred_at: string;
  }> | null;
  organization: {
    legal_name: string | null;
    rfc: string | null;
    contact_email: string | null;
    verification_status: string | null;
    kyb_status: string | null;
  } | null;
};

export const emptyOrganizationDashboard: OrganizationDashboardSummary = {
  members: null,
  teams: null,
  pendingInvitations: null,
  customRoles: null,
  recentEvents: null,
  organization: null,
};

/** Reads stay subject to the signed-in user's RLS and current workspace. */
export async function loadOrganizationDashboard(
  client: SupabaseClient,
  workspaceId: string,
  canAccess: (permission: string) => boolean,
  signal: AbortSignal
) {
  const unavailable = { data: null, count: null, error: null };
  const [organization, members, teams, invitations, roles, audit] = await Promise.all([
    client
      .from('workspaces')
      .select('legal_name,rfc,contact_email,verification_status,kyb_status')
      .eq('id', workspaceId)
      .abortSignal(signal)
      .maybeSingle(),
    canAccess('members.read')
      ? client
          .from('workspace_members')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .abortSignal(signal)
      : unavailable,
    canAccess('teams.read')
      ? client
          .from('organization_units')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .abortSignal(signal)
      : unavailable,
    canAccess('members.read')
      ? client
          .from('organization_invitations')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .abortSignal(signal)
      : unavailable,
    canAccess('roles.read')
      ? client
          .from('organization_roles')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('status', 'active')
          .eq('is_system', false)
          .abortSignal(signal)
      : unavailable,
    canAccess('audit.read')
      ? client
          .from('organization_audit_events')
          .select('id,summary,event_type,occurred_at')
          .eq('workspace_id', workspaceId)
          .order('occurred_at', { ascending: false })
          .limit(5)
          .abortSignal(signal)
      : unavailable,
  ]);
  const summary: OrganizationDashboardSummary = {
    organization: organization.error ? null : organization.data,
    members: members.error ? null : members.count,
    teams: teams.error ? null : teams.count,
    pendingInvitations: invitations.error ? null : invitations.count,
    customRoles: roles.error ? null : roles.count,
    recentEvents: audit.error || !canAccess('audit.read') ? null : audit.data || [],
  };
  return {
    summary,
    incomplete: [organization, members, teams, invitations, roles, audit].some((result) =>
      Boolean(result.error)
    ),
  };
}
