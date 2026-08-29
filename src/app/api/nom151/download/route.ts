import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/:*?<>|]/g, '_');
}

export async function GET(request: NextRequest) {
  const documentoId = request.nextUrl.searchParams.get('documento_id');
  if (!documentoId) {
    return NextResponse.json({ error: 'documento_id requerido' }, { status: 400 });
  }

  try {
    const { document, service } = await requireDocumentAccess(request, documentoId);
    const { data: pades, error: padesError } = await service
      .from('document_certifications')
      .select('id,document_version_id,certified_pdf_sha256')
      .eq('document_id', documentoId)
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
      .select('constancia_path,created_at')
      .eq('documento_id', documentoId)
      .eq('document_certification_id', pades.id)
      .eq('document_version_id', pades.document_version_id)
      .eq('document_digest', String(pades.certified_pdf_sha256 || '').toLowerCase())
      .eq('status', 'issued')
      .eq('verification_status', 'verified')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const storagePath = String(certificate?.constancia_path || '').trim();
    if (!storagePath) {
      return NextResponse.json(
        { error: 'La versión PAdES-B-T vigente todavía no tiene una constancia NOM-151 verificada.' },
        { status: 404 },
      );
    }

    const downloaded = await service.storage.from('nom151-constancias').download(storagePath);
    if (downloaded.error || !downloaded.data) {
      console.error('[DOCUBOX][nom151-download] No se pudo leer el archivo .asn1:', downloaded.error?.message);
      return NextResponse.json(
        { error: 'El archivo .asn1 emitido no est\u00e1 disponible en el almacenamiento privado.' },
        { status: 404 },
      );
    }

    const documentLabel = String(document.documento_id || document.nombre || documentoId);
    const filename = safeFileName(`constancia-nom151-${documentLabel}.asn1`);
    return new NextResponse(await downloaded.data.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(downloaded.data.size),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error: unknown) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
