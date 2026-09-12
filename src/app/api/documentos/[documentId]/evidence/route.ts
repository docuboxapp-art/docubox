import { NextRequest, NextResponse } from 'next/server';
import { requireDocumentAccess, documentAccessResponse } from '@/lib/security/document-access';
import { getEvidenceV2ForDocument } from '@/lib/evidence-v2/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EvidenceStatusRow = {
  verification_summary?: { overall?: string } | null;
};

function uiState(finalization: string | null, packageRow: EvidenceStatusRow | null) {
  if (packageRow) {
    const overall = packageRow.verification_summary?.overall;
    return overall === 'valid' ? 'verified' : 'generated';
  }
  if (finalization === 'FINALIZATION_ERROR') return 'error';
  if (
    [
      'WAITING_FOR_PADES',
      'WAITING_FOR_TIMESTAMP',
      'WAITING_FOR_NOM151',
      'WAITING_FOR_OTS_STAMP',
    ].includes(finalization || '')
  )
    return 'waiting_certifications';
  if (
    [
      'GENERATING_EVIDENCE',
      'SIGNING_EVIDENCE',
      'STORING_EVIDENCE',
      'READY_FOR_EVIDENCE_XML',
    ].includes(finalization || '')
  )
    return 'generating';
  return 'preparing';
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentAccess(request, documentId);
    const packageRow = await getEvidenceV2ForDocument(service, documentId);
    if (packageRow) {
      return NextResponse.json(
        {
          evidenceVersion: 2,
          schemaVersion: packageRow.schema_version,
          state: uiState(null, packageRow),
          generatedAt: packageRow.generated_at,
          xmlSha256: packageRow.xml_sha256,
          evidenceRoot: packageRow.evidence_root_sha256,
          verification: packageRow.verification_summary,
          xmlAvailable: true,
          packageAvailable: Boolean(
            (packageRow.artifacts || []).some(
              (artifact: Record<string, unknown>) => artifact.artifact_type === 'pades_pdf'
            )
          ),
          technical: { packageId: packageRow.package_id, evidenceId: packageRow.evidence_id },
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    const finalization = await service
      .from('evidence_finalizations')
      .select('state,readiness,last_error_code,updated_at')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (finalization.error) throw finalization.error;
    if (finalization.data) {
      return NextResponse.json(
        {
          evidenceVersion: 2,
          schemaVersion: '2.1',
          state: uiState(finalization.data.state, null),
          readiness: finalization.data.readiness,
          errorCode: finalization.data.last_error_code,
          generatedAt: null,
          xmlAvailable: false,
          packageAvailable: false,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    if (document.xml_evidencia_path) {
      return NextResponse.json(
        {
          evidenceVersion: 1,
          schemaVersion: '1.0',
          state: 'generated',
          generatedAt: document.xml_generated_at,
          xmlSha256: document.xml_hash_sha256,
          xmlAvailable: true,
          packageAvailable: false,
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    return NextResponse.json(
      {
        evidenceVersion: 2,
        schemaVersion: '2.1',
        state: 'preparing',
        generatedAt: null,
        xmlAvailable: false,
        packageAvailable: false,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
