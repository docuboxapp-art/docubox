import { z } from 'zod';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';

export const runtime = 'nodejs';

const querySchema = z.object({
  workspace_id: z.string().uuid(),
  type: z.enum(['documents']),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      workspace_id: url.searchParams.get('workspace_id'),
      type: url.searchParams.get('type'),
    });
    const { service } = await authorizeCollaborationRequest(
      request,
      query.workspace_id,
      'rooms.create'
    );
    if (query.type !== 'documents')
      throw new OrganizationApiError(400, 'catalog_not_supported', 'Catalogo no disponible.');
    const documents = await service
      .from('documentos')
      .select('id,nombre,estado,updated_at')
      .eq('workspace_id', query.workspace_id)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (documents.error) throw documents.error;
    return Response.json({ success: true, data: documents.data || [] });
  } catch (error) {
    return organizationApiFailure(error);
  }
}
