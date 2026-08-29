import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireApiUser } from '@/lib/certification/auth';
import { getCertificationArtifact } from '@/lib/certification/engine';
import { CertificationError, type CertificationArtifactKind } from '@/lib/certification/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const artifactDefinitions: Record<
  Exclude<CertificationArtifactKind, 'certificate' | 'package' | 'certified-pdf'>,
  {
    contentType: string;
    filename: (folio: string) => string;
  }
> = {
  'verification-report': {
    contentType: 'application/json; charset=utf-8',
    filename: (folio) => `reporte_verificacion_${folio}.json`,
  },
  'timestamp-token': {
    contentType: 'application/octet-stream',
    filename: (folio) => `estampa_rfc3161_${folio}.tst`,
  },
  'signing-certificate': {
    contentType: 'application/x-pem-file',
    filename: (folio) => `certificado_firmante_${folio}.pem`,
  },
  'certificate-chain': {
    contentType: 'application/x-pem-file',
    filename: (folio) => `cadena_certificados_${folio}.pem`,
  },
  'evidence-manifest': {
    contentType: 'application/json; charset=utf-8',
    filename: (folio) => `manifiesto_evidencia_${folio}.json`,
  },
};

function isArtifactKind(value: string): value is keyof typeof artifactDefinitions {
  return Object.prototype.hasOwnProperty.call(artifactDefinitions, value);
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ documentId: string; certificationUuid: string; artifact: string }> }
) {
  try {
    const user = await requireApiUser(request);
    const { documentId, certificationUuid, artifact } = await params;
    if (!isArtifactKind(artifact)) {
      throw new CertificationError(
        'CERTIFICATION_ARTIFACT_INVALID',
        'El artefacto solicitado no es valido.',
        404
      );
    }
    const { bytes, certification } = await getCertificationArtifact(
      createServiceClient(),
      documentId,
      certificationUuid,
      user.id,
      artifact
    );
    const definition = artifactDefinitions[artifact];
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': definition.contentType,
        'Content-Disposition': `attachment; filename="${definition.filename(certification.document_folio)}"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    const failure =
      error instanceof CertificationError
        ? error
        : new CertificationError(
            'CERTIFICATION_ARTIFACT_DOWNLOAD_FAILED',
            'No fue posible descargar el artefacto tecnico.',
            500
          );
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.httpStatus }
    );
  }
}
