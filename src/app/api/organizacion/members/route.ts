import { authorizeOrganizationRequest, organizationApiFailure } from '@/lib/organization/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get('workspace_id') || '';
    const { service } = await authorizeOrganizationRequest(request, workspaceId, 'members.read');
    const [members, invitations, roles, units] = await Promise.all([
      service
        .from('workspace_members')
        .select(
          'id,user_id,role,status,job_title,mfa_required,biometric_required,access_expires_at,joined_at,user_profiles(full_name,email,avatar_url)'
        )
        .eq('workspace_id', workspaceId)
        .order('joined_at'),
      service
        .from('organization_invitations')
        .select(
          'id,email,status,delivery_status,delivery_error_code,role_id,unit_id,expires_at,sent_at,last_sent_at,send_count,accepted_at,created_at,organization_roles(name,system_key),organization_units(name)'
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(250),
      service
        .from('organization_roles')
        .select('id,name,system_key')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('name'),
      service
        .from('organization_units')
        .select('id,name')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('name'),
    ]);
    for (const result of [members, invitations, roles, units]) {
      if (result.error) throw result.error;
    }
    return Response.json(
      {
        success: true,
        data: members.data || [],
        invitations: invitations.data || [],
        roles: roles.data || [],
        units: units.data || [],
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
