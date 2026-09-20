import { authorizePublicApi, publicApiResponse } from '@/lib/public-api/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await authorizePublicApi(request, 'documents.read');
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const status = url.searchParams.get('status');
    let query = context.service
      .from('documentos')
      .select('id,nombre,descripcion,estado,fecha_vencimiento,created_at,updated_at')
      .eq('workspace_id', context.credential.workspace_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('estado', status);
    const result = await query;
    if (result.error) throw result.error;
    return Response.json({ data: result.data || [], meta: { limit } });
  } catch (cause) {
    return publicApiResponse(cause);
  }
}
