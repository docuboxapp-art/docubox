import { NextRequest, NextResponse } from 'next/server';
import { requireDocumentAccess, documentAccessResponse } from '@/lib/security/document-access';
import { getEvidenceV2ForDocument, getManagementSnapshot } from '@/lib/evidence-v2/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Historical compatibility endpoint. New UI uses /evidence and /evidence/xml. */
export async function GET(request: NextRequest, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { documentId } = await context.params;
    const { service } = await requireDocumentAccess(request, documentId);
    const mode = request.nextUrl.searchParams.get('download');
    if (mode === 'management') return NextResponse.json(await getManagementSnapshot(service, documentId));
    if (mode) {
      const destination = mode === 'package'
        ? `/api/documentos/${encodeURIComponent(documentId)}/evidence/package`
        : `/api/documentos/${encodeURIComponent(documentId)}/evidence/xml`;
      return NextResponse.redirect(new URL(destination, request.url), 307);
    }
    const packageData = await getEvidenceV2ForDocument(service, documentId);
    if (!packageData) return NextResponse.json({ package: null });
    const { id: _id, xml_storage_bucket: _bucket, xml_storage_path: _path, ...safe } = packageData;
    return NextResponse.json({ package: safe }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST() {
  return NextResponse.json(
    { error: 'Evidence V2.1 se genera automáticamente al cierre.', code: 'EVIDENCE_AUTOMATIC_ONLY' },
    { status: 405, headers: { Allow: 'GET' } }
  );
}
