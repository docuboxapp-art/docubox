import { z } from 'zod';
import { authorizeCollaborationRequest } from '@/lib/collaboration/server';
import { organizationApiFailure } from '@/lib/organization/server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const workspaceId = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get('workspace_id'));
    const { userClient } = await authorizeCollaborationRequest(
      request,
      workspaceId,
      'requests.view'
    );
    const result = await userClient.rpc('colabora_forms_overview', { ws: workspaceId });
    if (result.error) throw result.error;
    return Response.json(
      { success: true, data: result.data || [] },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return organizationApiFailure(error);
  }
}
