import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getPublicCertificationArtifact } from '@/lib/certification/engine';
import { CertificationError } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ verificationUuid: string; artifactName: string }> },
) {
  try {
    const { verificationUuid, artifactName } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(verificationUuid)) {
      throw new CertificationError('CERTIFICATION_NOT_FOUND', 'Certificacion no encontrada.', 404);
    }
    const artifact = await getPublicCertificationArtifact(createServiceClient(), verificationUuid, artifactName);
    return new NextResponse(Buffer.from(artifact.bytes), {
      headers: {
        'Content-Type': artifact.contentType,
        'Content-Disposition': `attachment; filename="${artifactName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    const failure = error instanceof CertificationError
      ? error
      : new CertificationError('ARTIFACT_DOWNLOAD_FAILED', 'No fue posible descargar el artefacto.', 500);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.httpStatus });
  }
}
