import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { createNom151Certificate } from '@/lib/documents/nom151-certificate';
import { getPublicAppUrl } from '@/lib/publicAppUrl';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

export const runtime = 'nodejs';

function value(input: unknown, fallback = 'No disponible') {
  const normalized = String(input ?? '').replace(/[\r\n]+/g, ' ').trim();
  return normalized || fallback;
}

function formatDate(input: unknown) {
  if (!input) return 'No disponible';
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return value(input);
  return `${new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(date)} UTC`;
}

function maskEmail(input: unknown) {
  const email = value(input, '');
  const index = email.indexOf('@');
  if (index < 1) return email || 'No disponible';
  return `${email.slice(0, Math.min(2, index))}${'*'.repeat(Math.max(3, index - 2))}${email.slice(index)}`;
}

export async function GET(request: NextRequest) {
  const documentId = request.nextUrl.searchParams.get('documento_id');
  if (!documentId) return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });

  try {
    const { document, service } = await requireDocumentAccess(request, documentId);
    const { data: pades, error: padesError } = await service
      .from('document_certifications')
      .select('id,document_version_id,certified_pdf_sha256')
      .eq('document_id', documentId)
      .eq('pades_profile', 'PAdES-B-T')
      .eq('pdf_signature_status', 'valid')
      .eq('timestamp_status', 'valid')
      .eq('verification_status', 'valid')
      .order('pades_verified_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (padesError) throw padesError;
    if (!pades) {
      return NextResponse.json(
        { error: 'El PDF PAdES-B-T vigente todavía no está verificado.' },
        { status: 409 },
      );
    }
    const { data: certificate, error } = await service
      .from('nom151_constancias_doc')
      .select('id,status,verification_status,provider,psc_name,environment,operation_id,folio,document_digest,nubarium_codigo_validacion,nubarium_hash,constancia_sha256,pdf_sha256_local,nubarium_request_payload,nubarium_response_payload,issued_at,created_at,updated_at')
      .eq('documento_id', documentId)
      .eq('document_certification_id', pades.id)
      .eq('document_version_id', pades.document_version_id)
      .eq('document_digest', String(pades.certified_pdf_sha256 || '').toLowerCase())
      .eq('status', 'issued')
      .eq('verification_status', 'verified')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!certificate) {
      return NextResponse.json({ error: 'No existe una constancia NOM-151 verificada para el PDF PAdES-B-T vigente.' }, { status: 404 });
    }

    const requestPayload = (certificate.nubarium_request_payload || {}) as Record<string, unknown>;
    const responsePayload = (certificate.nubarium_response_payload || {}) as Record<string, unknown>;
    const signers = Array.isArray(requestPayload.firmantes)
      ? requestPayload.firmantes as Array<Record<string, unknown>>
      : [];
    const folio = value(document.documento_id || document.folio_interno || document.id);
    const verificationUrl = `${getPublicAppUrl()}/verificar-documento?folio=${encodeURIComponent(folio)}`;
    const pscUrl = 'https://validatuconstancia.pscworld.com/';

    let logoBytes: Uint8Array | undefined;
    try {
      logoBytes = new Uint8Array(await readFile(path.join(process.cwd(), 'public/assets/images/docubox-logo-2026.png')));
    } catch {
      logoBytes = undefined;
    }

    const bytes = await createNom151Certificate({
      logoBytes,
      validationCode: value(certificate.nubarium_codigo_validacion),
      issuedAt: formatDate(certificate.issued_at || certificate.created_at),
      status: certificate.environment === 'production'
        ? 'Verificada'
        : `Verificada · ${value(certificate.environment, 'entorno no clasificado')}`,
      documentName: value(document.nombre || document.file_name),
      documentId: value(document.id),
      folio,
      documentStatus: value(document.estado),
      documentHash: value(certificate.document_digest || certificate.pdf_sha256_local),
      documentSize: requestPayload.pdf_size_bytes
        ? `${Number(requestPayload.pdf_size_bytes).toLocaleString('es-MX')} bytes`
        : document.file_size
          ? `${Number(document.file_size).toLocaleString('es-MX')} bytes`
          : 'No disponible',
      provider: value(certificate.psc_name || certificate.provider, 'Nubarium'),
      endpoint: 'Integración backend Docubox con Nubarium',
      signers: signers.map((signer) => ({
        name: value(signer.nombreCompleto || signer.nombre, 'Firmante'),
        email: maskEmail(signer.correoElectronico || signer.email),
      })),
      providerStatus: value(responsePayload.estatus || responsePayload.status, 'OK'),
      messageKey: `${value(responsePayload.claveMensaje ?? responsePayload.clave_mensaje ?? 0)} (0 = \u00e9xito)`,
      providerHash: value(certificate.nubarium_hash),
      asn1Hash: value(certificate.constancia_sha256),
      standard: 'NOM-151-SCFI-2016',
      certificateType: 'Conservaci\u00f3n de mensajes de datos (.asn1)',
      algorithm: 'SHA-256',
      verificationUrl,
      pscUrl,
      representationNotice: 'Representación informativa Docubox. El artefacto original emitido por el PSC es el archivo .asn1 asociado.',
    });
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="constancia-nom151-${documentId.slice(0, 8)}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error) {
    const accessError = documentAccessResponse(error);
    if (accessError.status !== 500) return NextResponse.json(accessError.body, { status: accessError.status });
    console.error('[DOCUBOX][nom151-pdf] No se pudo generar la constancia:', error);
    return NextResponse.json({ error: 'No se pudo generar la constancia NOM-151.' }, { status: 500 });
  }
}
