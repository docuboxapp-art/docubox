import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

type ServiceClient = ReturnType<typeof createServiceClient>;

export async function finalDeliverableReady(
  service: ServiceClient,
  documentId: string,
  certificationId?: string
): Promise<boolean> {
  const documentResult = await service
    .from('documentos')
    .select('sealed_pdf_path,sealed_pdf_hash')
    .eq('id', documentId)
    .single();
  if (documentResult.error) throw documentResult.error;
  const document = documentResult.data;
  if (!document.sealed_pdf_path || !document.sealed_pdf_hash) return false;

  let certificationQuery = service
    .from('document_certifications')
    .select(
      'id,document_version_id,certified_pdf_sha256,pades_pdf_hash_after_signature,provider_metadata'
    )
    .eq('document_id', documentId)
    .eq('status', 'COMPLETED')
    .eq('execution_status', 'completed')
    .eq('pades_profile', 'PAdES-B-T')
    .eq('integrity_status', 'valid')
    .eq('pdf_signature_status', 'valid')
    .eq('certificate_status', 'valid')
    .eq('timestamp_status', 'valid')
    .eq('verification_status', 'valid');
  if (certificationId)
    certificationQuery = certificationQuery.eq('certification_uuid', certificationId);
  const certificationResult = await certificationQuery
    .order('pades_verified_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (certificationResult.error) throw certificationResult.error;
  const certification = certificationResult.data;
  const digest = String(certification?.certified_pdf_sha256 || '').toLowerCase();
  const finalPath = String(
    (
      certification?.provider_metadata as {
        product_integration?: { pades_bt?: { final_pdf_path?: string } };
      } | null
    )?.product_integration?.pades_bt?.final_pdf_path || ''
  );
  if (
    !certification?.document_version_id ||
    !digest ||
    digest !== String(document.sealed_pdf_hash).toLowerCase() ||
    digest !== String(certification.pades_pdf_hash_after_signature || '').toLowerCase() ||
    finalPath !== document.sealed_pdf_path
  )
    return false;

  const nomResult = await service
    .from('nom151_constancias_doc')
    .select('id,verification_status')
    .eq('documento_id', documentId)
    .eq('document_certification_id', certification.id)
    .eq('document_version_id', certification.document_version_id)
    .eq('document_digest', digest)
    .eq('status', 'issued')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (nomResult.error) throw nomResult.error;
  return nomResult.data?.verification_status === 'verified';
}

export function finalDeliverablePendingResponse() {
  return NextResponse.json(
    {
      error:
        'El entregable final estará disponible cuando la constancia NOM-151 esté emitida y verificada.',
      code: 'NOM151_FINAL_DELIVERABLE_PENDING',
    },
    { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
  );
}
