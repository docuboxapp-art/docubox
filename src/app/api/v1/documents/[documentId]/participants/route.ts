import { assertPublicApiDocument, authorizePublicApi, publicApiResponse } from '@/lib/public-api/server';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const auth = await authorizePublicApi(request, 'documents.read');
    const { documentId } = await context.params;
    const document = await assertPublicApiDocument(auth, documentId);
    const references = await auth.service
      .from('document_participant_references')
      .select('id,participant_user_id,participant_email,participant_name,participant_type,status,created_at,updated_at')
      .eq('workspace_id', auth.credential.workspace_id)
      .eq('document_id', documentId)
      .order('created_at');
    if (references.error) throw references.error;
    const legacy = Array.isArray(document.participantes) ? document.participantes : [];
    return Response.json({
      data: references.data?.length
        ? references.data
        : legacy.map((item: Record<string, unknown>) => ({
            id: item.id || null,
            participant_name: item.name || item.nombre || null,
            participant_email: item.email || null,
            participant_type: item.tipoParticipacion || null,
            status: item.status || (item.firmaCompletada ? 'completed' : 'pending'),
            legacy_reference: true,
          })),
    });
  } catch (cause) {
    return publicApiResponse(cause);
  }
}
