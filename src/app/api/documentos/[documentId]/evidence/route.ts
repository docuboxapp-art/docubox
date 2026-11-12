import { NextRequest, NextResponse } from 'next/server';
import { requireDocumentAccess, documentAccessResponse } from '@/lib/security/document-access';
import { getEvidenceV2ForDocument } from '@/lib/evidence-v2/service';
import { enqueueEvidenceFinalization, processEvidenceFinalization } from '@/lib/evidence-v2/orchestrator';
import { issueNom151ForVerifiedPadesBt } from '@/lib/nom151/service';
import { synchronizeEvidenceSupplementsForDocument } from '@/lib/evidence-v2/supplements';
import { evidenceUiState } from '@/lib/evidence-v2/finalization-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service } = await requireDocumentAccess(request, documentId, { additionalAccess: 'evidence' });
    const packageRow = await getEvidenceV2ForDocument(service, documentId);
    if (packageRow) {
      return NextResponse.json(
        {
          evidenceVersion: 2,
          schemaVersion: packageRow.schema_version,
          state: evidenceUiState(null, packageRow.verification_summary?.overall || ''),
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
      .select('state,readiness,last_error_code,attempt_count,next_attempt_at,updated_at')
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
          state: evidenceUiState(finalization.data.state, null),
          readiness: finalization.data.readiness,
          errorCode:
            finalization.data.last_error_code ||
            (finalization.data.state === 'EVIDENCE_READY' ||
            finalization.data.state === 'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS'
              ? 'EVIDENCE_PACKAGE_MISSING'
              : null),
          finalization: {
            state: finalization.data.state,
            attemptCount: finalization.data.attempt_count,
            nextAttemptAt: finalization.data.next_attempt_at,
          },
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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await context.params;
    const { document, service, user } = await requireDocumentAccess(request, documentId);
    if (document.estado !== 'completado') {
      return NextResponse.json(
        { error: 'La evidencia se genera cuando el documento está completado.' },
        { status: 409 }
      );
    }

    const certification = await service
      .from('document_certifications')
      .select('certification_uuid,certified_pdf_sha256,pades_pdf_hash_after_signature')
      .eq('document_id', documentId)
      .eq('status', 'COMPLETED')
      .eq('execution_status', 'completed')
      .eq('pades_profile', 'PAdES-B-T')
      .eq('pdf_signature_status', 'valid')
      .eq('certificate_status', 'valid')
      .eq('timestamp_status', 'valid')
      .eq('verification_status', 'valid')
      .order('pades_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (certification.error) throw certification.error;
    if (
      !certification.data?.certification_uuid ||
      !certification.data.certified_pdf_sha256 ||
      String(certification.data.certified_pdf_sha256).toLowerCase() !==
        String(certification.data.pades_pdf_hash_after_signature || '').toLowerCase()
    ) {
      return NextResponse.json(
        { error: 'El PDF final PAdES-B-T aún no está verificado.' },
        { status: 409 }
      );
    }

    const finalization = await enqueueEvidenceFinalization(service, {
      documentId,
      actorId: user.id,
      certificationId: certification.data.certification_uuid,
    });
    if (finalization.state === 'EVIDENCE_READY') {
      return NextResponse.json({ state: finalization.state });
    }
    if (finalization.state === 'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS') {
      await issueNom151ForVerifiedPadesBt(service, { documentId, requestedBy: user.id });
      await synchronizeEvidenceSupplementsForDocument(service, documentId);
      return NextResponse.json({ state: 'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS' });
    }

    const result = await processEvidenceFinalization(service, { documentId });
    return NextResponse.json(
      { state: result?.state || finalization.state },
      { status: result?.state === 'EVIDENCE_READY' ? 200 : 202 }
    );
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
