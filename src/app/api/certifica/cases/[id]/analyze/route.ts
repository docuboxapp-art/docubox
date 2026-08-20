import { authorizeOrganizationRequest, OrganizationApiError } from '@/lib/organization/server';
import { appendCertificationEvent, certificaApiFailure, requireCertification, sha256 } from '@/lib/certifica/server';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = (await request.json()) as { workspace_id?: string };
    const workspaceId = input.workspace_id || '';
    const { service, user } = await authorizeOrganizationRequest(request, workspaceId, 'certifications.create');
    const certification = await requireCertification(service, id, workspaceId);
    if (!certification.original_storage_path || !certification.original_sha256) throw new OrganizationApiError(409, 'original_required', 'Carga el documento original antes de analizarlo.');
    const downloaded = await service.storage.from('certification-originals').download(certification.original_storage_path);
    if (downloaded.error || !downloaded.data) throw new OrganizationApiError(503, 'original_unavailable', 'No se pudo leer el original privado.');
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    const actualHash = sha256(bytes);
    if (actualHash !== certification.original_sha256) {
      await service.from('certification_cases').update({ status: 'rejected', file_classification: 'modified_after_signature', error_code: 'original_integrity_mismatch' }).eq('id', id);
      throw new OrganizationApiError(409, 'original_integrity_mismatch', 'La huella del original no coincide. La operacion fue bloqueada.');
    }
    const pdfText = certification.original_mime_type === 'application/pdf' ? bytes.toString('latin1') : '';
    const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
    const hasByteRange = isPdf && /\/ByteRange\s*\[/.test(pdfText);
    const hasSignature = hasByteRange && /\/Contents\s*</.test(pdfText);
    const classification = certification.original_mime_type === 'application/pdf' && !isPdf
      ? 'unsupported_or_corrupt'
      : hasSignature ? 'electronically_signed' : 'unsigned';
    const warnings = [
      ...(Array.isArray(certification.warnings) ? certification.warnings : []),
      ...(hasSignature ? ['Se detecto una firma PDF. La validacion criptografica completa requiere el motor PAdES configurado.'] : []),
    ];
    const status = classification === 'unsupported_or_corrupt' ? 'requires_review' : 'ready';
    const analysis = {
      sha256_verified: true,
      pdf_signature_markers: hasSignature,
      detected_format: certification.original_mime_type,
      analyzed_at: new Date().toISOString(),
      analyzer_version: 'docubox-certifica/1.0',
    };
    const updated = await service.from('certification_cases').update({ status, file_classification: classification, analysis_summary: analysis, warnings, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
    if (updated.error) throw updated.error;
    await service.from('certification_integrity_checks').insert({ certification_id: id, workspace_id: workspaceId, expected_sha256: certification.original_sha256, calculated_sha256: actualHash, status: 'match', checked_by: user.id, details: { stage: 'analysis' } });
    await appendCertificationEvent({ service, certificationId: id, workspaceId, actorId: user.id, eventType: 'certification.analyzed', payload: { classification, status, hash_verified: true } });
    return Response.json({ success: true, case: updated.data });
  } catch (error) {
    return certificaApiFailure(error);
  }
}

