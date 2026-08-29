import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

const PUBLIC_FIELDS = [
  'id',
  'document_version_id',
  'document_certification_id',
  'provider',
  'psc_name',
  'environment',
  'operation_id',
  'folio',
  'status',
  'verification_status',
  'digest_algorithm',
  'document_digest',
  'pades_profile',
  'pades_revision',
  'nubarium_codigo_validacion',
  'nubarium_hash',
  'constancia_sha256',
  'constancia_path',
  'artifact_format',
  'issued_at',
  'verified_at',
  'certificate_subject',
  'certificate_issuer',
  'certificate_serial',
  'certificate_fingerprint',
  'certificate_valid_from',
  'certificate_valid_to',
  'certificate_key_usage',
  'certificate_extended_key_usage',
  'certificate_policy_oids',
  'tst_policy_oid',
  'trust_bundle_version',
  'trust_root_fingerprint',
  'chain_fingerprints',
  'production_trusted',
  'provider_metadata',
  'created_at',
  'updated_at',
  'error_detail',
].join(',');

type PublicNom151Record = {
  verification_status: string | null;
  environment: string | null;
  production_trusted: boolean | null;
  [key: string]: unknown;
};

export async function GET(req: NextRequest) {
  const documentId = new URL(req.url).searchParams.get('documento_id');
  if (!documentId) {
    return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
  }

  try {
    const { service } = await requireDocumentAccess(req, documentId);
    const pades = await service
      .from('document_certifications')
      .select('id,document_version_id,certified_pdf_sha256,pades_profile')
      .eq('document_id', documentId)
      .eq('pades_profile', 'PAdES-B-T')
      .eq('pdf_signature_status', 'valid')
      .eq('timestamp_status', 'valid')
      .eq('verification_status', 'valid')
      .order('pades_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pades.error) {
      return NextResponse.json({ error: pades.error.message }, { status: 500 });
    }
    if (!pades.data) {
      return NextResponse.json({
        data: null,
        processing: false,
        blocked: true,
        failure_code: 'pades_bt_not_verified',
        message: 'La NOM-151 se emitirá después de verificar el PDF final PAdES-B-T.',
      });
    }

    const issued = await service
      .from('nom151_constancias_doc')
      .select(PUBLIC_FIELDS)
      .eq('documento_id', documentId)
      .eq('document_certification_id', pades.data.id)
      .eq('document_version_id', pades.data.document_version_id)
      .eq('document_digest', String(pades.data.certified_pdf_sha256 || '').toLowerCase())
      .eq('status', 'issued')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (issued.error) {
      return NextResponse.json({ error: issued.error.message }, { status: 500 });
    }
    if (issued.data) {
      const issuedRecord = issued.data as unknown as PublicNom151Record;
      return NextResponse.json({
        data: issuedRecord,
        processing: false,
        verified: issuedRecord.verification_status === 'verified',
        production_verified:
          issuedRecord.verification_status === 'verified' &&
          issuedRecord.production_trusted === true,
      });
    }

    const processing = await service
      .from('nom151_constancias_doc')
      .select('id,status,verification_status,created_at')
      .eq('document_certification_id', pades.data.id)
      .eq('document_digest', String(pades.data.certified_pdf_sha256 || '').toLowerCase())
      .eq('status', 'processing')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (processing.data) {
      return NextResponse.json({ data: null, processing: true });
    }

    const failed = await service
      .from('nom151_constancias_doc')
      .select('id,status,verification_status,created_at,error_detail')
      .eq('document_certification_id', pades.data.id)
      .eq('document_digest', String(pades.data.certified_pdf_sha256 || '').toLowerCase())
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (failed.data) {
      return NextResponse.json({
        data: null,
        processing: false,
        failed: true,
        failure_code: failed.data.error_detail?.code || 'nom151_failed',
        message: 'La constancia NOM-151 no superó la emisión o verificación técnica.',
      });
    }

    return NextResponse.json({ data: null, processing: false, ready: true });
  } catch (error) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
