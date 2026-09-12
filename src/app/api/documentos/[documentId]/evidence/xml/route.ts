import { NextRequest, NextResponse } from 'next/server';
import { sha256Hex } from '@/lib/certification/canonical';
import { requireDocumentAccess, documentAccessResponse } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeName(value: string) {
  return value.replace(/[\r\n"\\/:*?<>|]/g, '_');
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentAccess(request, documentId);
    const packageResult = await service
      .from('evidence_packages')
      .select('package_id,xml_storage_bucket,xml_storage_path,xml_sha256')
      .eq('document_id', documentId)
      .not('closed_at', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (packageResult.error) throw packageResult.error;
    const bucket =
      packageResult.data?.xml_storage_bucket || (document.xml_evidencia_path ? 'evidence' : null);
    const path = packageResult.data?.xml_storage_path || document.xml_evidencia_path;
    const expectedHash = packageResult.data?.xml_sha256 || document.xml_hash_sha256;
    if (!bucket || !path)
      return NextResponse.json(
        { error: 'El XML de evidencia todavía se está preparando.' },
        { status: 404 }
      );
    const download = await service.storage.from(bucket).download(path);
    if (download.error || !download.data)
      throw download.error || new Error('EVIDENCE_XML_STORAGE_MISSING');
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (expectedHash && sha256Hex(bytes) !== String(expectedHash).toLowerCase()) {
      return NextResponse.json(
        {
          error: 'El XML no superó la verificación de integridad.',
          code: 'EVIDENCE_XML_HASH_MISMATCH',
        },
        { status: 409 }
      );
    }
    const label = safeName(
      String(document.documento_id || packageResult.data?.package_id || documentId)
    );
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="evidencia-${label}.xml"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
