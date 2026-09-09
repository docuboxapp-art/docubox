import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { isEvidenceV2Enabled } from '@/lib/evidence-v2/feature-flags';
import {
  EvidenceV2ServiceError,
  generateEvidenceV2ForDocument,
  getEvidenceV2ForDocument,
  getManagementSnapshot,
} from '@/lib/evidence-v2/service';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EvidenceArtifactResponse extends Record<string, unknown> {
  storage_bucket?: string | null;
  storage_path?: string | null;
}

interface EvidencePackageResponse extends Record<string, unknown> {
  id?: string;
  xml_storage_bucket?: string | null;
  xml_storage_path?: string | null;
  public_verification_token?: string | null;
  artifacts?: EvidenceArtifactResponse[] | null;
}

function enabledError() {
  return NextResponse.json(
    { error: 'Evidence Package v2 no está habilitado.', code: 'EVIDENCE_V2_DISABLED' },
    { status: 404 }
  );
}

function publicVerificationUrl(token: string) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  return `${base}/verificar-evidencia/${encodeURIComponent(token)}`;
}

function responsePackage(value: EvidencePackageResponse | null) {
  if (!value) return null;
  const { id: _databaseId, xml_storage_bucket: _bucket, xml_storage_path: _path, ...safe } = value;
  return {
    ...safe,
    public_verification_url: value.public_verification_token
      ? publicVerificationUrl(value.public_verification_token)
      : null,
    artifacts: (value.artifacts || []).map((artifact) => {
      const {
        storage_bucket: _artifactBucket,
        storage_path: _artifactPath,
        ...artifactSafe
      } = artifact;
      return artifactSafe;
    }),
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  if (!isEvidenceV2Enabled()) return enabledError();
  try {
    const { documentId } = await context.params;
    const { user, service } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    const result = await generateEvidenceV2ForDocument(service, {
      documentId,
      actorId: user.id,
    });
    const packageData = await getEvidenceV2ForDocument(service, documentId);
    return NextResponse.json({
      ok: true,
      alreadyGenerated: result.alreadyGenerated,
      package: responsePackage(packageData),
    });
  } catch (error) {
    return errorResponse(error, 'No fue posible generar Evidence Package v2.');
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  if (!isEvidenceV2Enabled()) return enabledError();
  try {
    const { documentId } = await context.params;
    const { service } = await requireDocumentAccess(request, documentId);
    const mode = new URL(request.url).searchParams.get('download');
    if (mode === 'management') {
      const snapshot = await getManagementSnapshot(service, documentId);
      return NextResponse.json(snapshot, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    const packageData = await getEvidenceV2ForDocument(service, documentId);
    if (!packageData) return NextResponse.json({ package: null });
    if (!mode) {
      return NextResponse.json(
        { package: responsePackage(packageData) },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const xmlDownload = await service.storage
      .from(packageData.xml_storage_bucket)
      .download(packageData.xml_storage_path);
    if (xmlDownload.error || !xmlDownload.data) {
      throw xmlDownload.error || new Error('EVIDENCE_V2_STORAGE_READ_FAILED');
    }
    const xmlBytes = new Uint8Array(await xmlDownload.data.arrayBuffer());
    if (mode === '1' || mode === 'xml') {
      return new NextResponse(xmlBytes, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="docubox-evidence-${packageData.package_id}.xml"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    if (mode !== 'package') {
      return NextResponse.json({ error: 'Tipo de descarga no válido.' }, { status: 400 });
    }

    const zip = new JSZip();
    zip.file('evidence.xml', xmlBytes);
    const manifest = {
      package_id: packageData.package_id,
      evidence_version: packageData.evidence_version,
      document_final_sha256: packageData.document_final_sha256,
      evidence_root_sha256: packageData.evidence_root_sha256,
      xml_sha256: packageData.xml_sha256,
      generated_at: packageData.generated_at,
      artifacts: [] as Array<Record<string, unknown>>,
    };
    for (const artifact of packageData.artifacts || []) {
      const downloaded = await service.storage
        .from(artifact.storage_bucket)
        .download(artifact.storage_path);
      if (downloaded.error || !downloaded.data) {
        throw downloaded.error || new Error(`EVIDENCE_V2_ARTIFACT_MISSING:${artifact.id}`);
      }
      const extension =
        artifact.artifact_type === 'pades_pdf'
          ? 'pdf'
          : artifact.artifact_type === 'opentimestamps_proof'
            ? 'ots'
            : artifact.artifact_type === 'rfc3161_token'
              ? 'tst'
              : artifact.artifact_type === 'efirma_signature_bundle'
                ? 'json'
                : artifact.artifact_type === 'autograph_signature_image'
                  ? 'png'
                  : artifact.artifact_type === 'autograph_signature_strokes'
                    ? 'json'
                    : 'asn1';
      const fileName = `artifacts/${artifact.artifact_type}-${artifact.id}.${extension}`;
      zip.file(fileName, new Uint8Array(await downloaded.data.arrayBuffer()));
      manifest.artifacts.push({
        type: artifact.artifact_type,
        status: artifact.artifact_status,
        sha256: artifact.object_sha256,
        file: fileName,
        provider: artifact.provider,
        metadata: artifact.metadata,
      });
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="docubox-evidence-v2-${packageData.package_id}.zip"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return errorResponse(error, 'No fue posible recuperar Evidence Package v2.');
  }
}

function errorResponse(error: unknown, fallback: string) {
  const access = documentAccessResponse(error);
  if (access.status !== 500) return NextResponse.json(access.body, { status: access.status });
  if (error instanceof EvidenceV2ServiceError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('[evidence-v2] Request failed', error instanceof Error ? error.message : 'unknown');
  return NextResponse.json(
    { error: fallback, code: 'EVIDENCE_V2_REQUEST_FAILED' },
    { status: 500 }
  );
}
