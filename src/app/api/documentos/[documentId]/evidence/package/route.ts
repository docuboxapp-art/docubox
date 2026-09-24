import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse } from '@/lib/security/document-access';
import { requireDocumentContentAccess } from '@/lib/security/document-content-access';
import { createEvidencePackageZipStream } from '@/lib/evidence-v2/evidence-package';
import { finalDeliverablePendingResponse, finalDeliverableReady } from '@/lib/nom151/final-deliverable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function safeName(value: string) {
  return value.replace(/[\r\n"\\/:*?<>|]/g, '_');
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentContentAccess(request, documentId);
    if (!(await finalDeliverableReady(service, documentId))) {
      return finalDeliverablePendingResponse();
    }
    const result = await createEvidencePackageZipStream(service, documentId);
    const folio = safeName(String(document.documento_id || result.package.package_id));
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="paquete-evidencia-${folio}.zip"`,
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
