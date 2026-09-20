import { assertPublicApiDocument, authorizePublicApi, publicApiResponse } from '@/lib/public-api/server';

export const runtime = 'nodejs';

export async function GET(request: Request, route: { params: Promise<{ documentId: string }> }) {
  try {
    const auth = await authorizePublicApi(request, 'evidence.read');
    const { documentId } = await route.params;
    await assertPublicApiDocument(auth, documentId);
    const result = await auth.service
      .from('evidence_packages')
      .select('id,evidence_id,package_id,document_id,document_version_id,evidence_version,schema_version,status,document_final_sha256,evidence_root_sha256,package_digest_sha256,xml_sha256,generated_at,closed_at')
      .eq('workspace_id', auth.credential.workspace_id)
      .eq('document_id', documentId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) throw result.error;
    return Response.json({ data: result.data || null });
  } catch (cause) {
    return publicApiResponse(cause);
  }
}
