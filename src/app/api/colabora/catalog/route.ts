import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';
import { canUseCollaboration } from '@/lib/collaboration/domain';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = z.string().uuid().parse(url.searchParams.get('workspace_id'));
    const type = z
      .enum(['documents', 'forms', 'case_files', 'templates', 'members'])
      .parse(url.searchParams.get('type'));
    const { userClient, access } = await authorizeCollaborationRequest(request, workspaceId);
    if (
      ![
        'rooms.create',
        'requests.create',
        'reviews.create',
        'tasks.create',
        'tasks.assign',
        'collaboration_spaces.create',
        'collaboration_spaces.manage_members',
        'collaboration.manage_settings',
        'requests.view',
      ].some((permission) => canUseCollaboration(access, permission))
    )
      throw new OrganizationApiError(
        403,
        'permission_denied',
        'No tienes permiso para consultar este catálogo.'
      );
    const tables = {
      documents: { name: 'documentos', columns: 'id,nombre,documento_id,estado,updated_at' },
      forms: {
        name: 'form_templates',
        columns: 'id,name,status,version_number,revision_number,updated_at',
      },
      case_files: { name: 'case_files', columns: 'id,title,status,updated_at' },
      templates: { name: 'plantillas', columns: 'id,nombre,estado,updated_at' },
      members: {
        name: 'workspace_members',
        columns: 'id,user_id,role,user_profiles!workspace_members_user_id_fkey(full_name,email)',
      },
    };
    const config = tables[type];
    let query = userClient
      .from(config.name)
      .select(config.columns)
      .eq('workspace_id', workspaceId)
      .order(type === 'members' ? 'joined_at' : 'updated_at', { ascending: false })
      .limit(500);
    if (type === 'documents') query = query.is('deleted_at', null);
    if (type === 'forms') query = query.eq('status', 'published');
    if (type === 'members')
      query = query
        .eq('status', 'active')
        .or(`access_expires_at.is.null,access_expires_at.gt.${new Date().toISOString()}`);
    const result = await query;
    if (result.error) throw result.error;
    let data = result.data || [];
    if (type !== 'members' && !['owner', 'admin'].includes(access.membershipRole) && data.length) {
      const permissions = [
        'rooms.create',
        'requests.create',
        'reviews.create',
        'tasks.create',
        'collaboration_spaces.create',
        'requests.view',
      ].filter((permission) => canUseCollaboration(access, permission));
      const filter = await userClient.rpc('organization_filter_resource_ids', {
        ws_id: workspaceId,
        requested_permissions: permissions,
        resource_type: (
          {
            documents: 'document',
            forms: 'form',
            case_files: 'case_file',
            templates: 'template',
          } as const
        )[type],
        resource_ids: data.map((row) => (row as unknown as { id: string }).id),
      });
      if (filter.error)
        throw new OrganizationApiError(
          503,
          'organization_scope_unavailable',
          'No se pudo comprobar el alcance del catálogo. Intenta nuevamente.'
        );
      const allowed = new Set((filter.data as string[]) || []);
      data = data.filter((row) => allowed.has((row as unknown as { id: string }).id));
    }
    return Response.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
