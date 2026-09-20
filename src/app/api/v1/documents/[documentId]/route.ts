import { assertPublicApiDocument, authorizePublicApi, publicApiResponse } from '@/lib/public-api/server';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const auth = await authorizePublicApi(request, 'documents.read');
    const { documentId } = await context.params;
    const document = await assertPublicApiDocument(auth, documentId);
    const { participantes: _participants, ...safeDocument } = document;
    return Response.json({ data: safeDocument });
  } catch (cause) {
    return publicApiResponse(cause);
  }
}
