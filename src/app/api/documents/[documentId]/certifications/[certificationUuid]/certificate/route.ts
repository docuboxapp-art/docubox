import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireApiUser } from '@/lib/certification/auth';
import { getCertificationArtifact } from '@/lib/certification/engine';
import { CertificationError } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string; certificationUuid: string }> }) {
  try {
    const user = await requireApiUser(request);
    const { documentId, certificationUuid } = await params;
    const { bytes, certification } = await getCertificationArtifact(createServiceClient(), documentId, certificationUuid, user.id, 'certificate');
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="constancia_integridad_${certification.document_folio}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    const failure = error instanceof CertificationError ? error : new CertificationError('CERTIFICATE_DOWNLOAD_FAILED', 'No fue posible descargar la constancia.', 500);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
  }
}

