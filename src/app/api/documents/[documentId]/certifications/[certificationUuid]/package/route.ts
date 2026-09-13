import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getCertificationArtifact } from '@/lib/certification/engine';
import { CertificationError } from '@/lib/certification/types';
import { requireDocumentContentAccess } from '@/lib/security/document-content-access';
import { DocumentAccessError } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string; certificationUuid: string }> }) {
  try {
    const { documentId, certificationUuid } = await params;
    const access = await requireDocumentContentAccess(request, documentId);
    const { bytes, certification } = await getCertificationArtifact(createServiceClient(), documentId, certificationUuid, access.user.id, 'package');
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="paquete_certificacion_${certification.document_folio}.zip"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof DocumentAccessError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const failure = error instanceof CertificationError ? error : new CertificationError('PACKAGE_DOWNLOAD_FAILED', 'No fue posible descargar el paquete tecnico.', 500);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
  }
}
