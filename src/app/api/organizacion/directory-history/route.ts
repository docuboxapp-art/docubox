import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = z.string().uuid().parse(url.searchParams.get('workspace_id'));
    const personId = z.string().uuid().parse(url.searchParams.get('person_id'));
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(10000)
      .parse(url.searchParams.get('page') || 0);
    const { service, userClient } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'directory.read'
    );
    const permission = await userClient.rpc('has_organization_permission', {
      ws_id: workspaceId,
      requested_permission: 'documents.read',
    });
    if (permission.error)
      throw new OrganizationApiError(
        503,
        'permissions_unavailable',
        'No se pudieron comprobar los permisos.'
      );
    if (!permission.data)
      throw new OrganizationApiError(
        403,
        'permission_denied',
        'Se requiere permiso para consultar los documentos de la organización.'
      );
    const person = await service
      .from('organization_directory_people')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', personId)
      .maybeSingle();
    if (person.error) throw person.error;
    if (!person.data)
      throw new OrganizationApiError(
        404,
        'person_not_found',
        'No se encontró a la persona en esta organización.'
      );
    const result = await userClient.rpc('get_organization_person_document_history', {
      ws_id: workspaceId,
      target_person_id: personId,
      page_offset: page * 50,
      page_size: 50,
    });
    if (result.error) throw result.error;
    return Response.json(
      { success: true, data: result.data || [], total: Number(result.data?.[0]?.total_count || 0) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    if (cause instanceof z.ZodError)
      return Response.json(
        { success: false, error: 'Revisa la persona y la página seleccionadas.' },
        { status: 422 }
      );
    return organizationApiFailure(cause);
  }
}
