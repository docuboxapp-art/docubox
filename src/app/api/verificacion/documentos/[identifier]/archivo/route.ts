import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';
import { findActivePublicLink } from '@/lib/public-verification/repository';

function safeFileName(value: unknown) {
  return String(value || 'documento.pdf').replace(/[\r\n"\\/:*?<>|]/g, '_');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  try {
    if (!(await enforcePublicRateLimit(request, 'public-document-file', 20))) {
      return NextResponse.json({ error: 'Demasiadas solicitudes.' }, { status: 429 });
    }
  } catch {
    return NextResponse.json(
      { error: 'El servicio de verificacion no esta disponible temporalmente.' },
      { status: 503 }
    );
  }
  const { identifier: rawIdentifier } = await params;
  const identifier = decodeURIComponent(rawIdentifier || '').trim();
  const token = request.nextUrl.searchParams.get('token')?.trim() || '';
  if (!identifier || identifier.length > 120 || !token || token.length > 160) {
    return NextResponse.json({ error: 'Identificador invalido.' }, { status: 400 });
  }

  const service = createServiceClient();
  const publicLink = await findActivePublicLink(service, token);
  if (
    !publicLink ||
    publicLink.document_id !== identifier ||
    publicLink.visibility_level !== 'document'
  ) {
    return NextResponse.json(
      { error: 'El enlace publico no permite acceder al archivo.' },
      { status: 404 }
    );
  }
  const select =
    'id,documento_id,nombre,estado,es_publico,file_name,file_type,sealed_pdf_path,sealed_pdf_hash';
  const { data: document } = await service
    .from('documentos')
    .select(select)
    .eq('id', publicLink.document_id)
    .eq('estado', 'completado')
    .eq('es_publico', true)
    .maybeSingle();
  if (!document) {
    return NextResponse.json({ error: 'Documento publico no encontrado.' }, { status: 404 });
  }

  const finalPath = String(document.sealed_pdf_path || '').trim();
  if (!finalPath || !document.sealed_pdf_hash) {
    return NextResponse.json(
      { error: 'El PDF final firmado aun no esta disponible.' },
      { status: 409 }
    );
  }
  try {
    const file = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath: finalPath,
      expectedPlaintextSha256: document.sealed_pdf_hash,
      requestId: request.headers.get('x-request-id'),
      accessEvent: 'DOCUMENT_VIEWED',
    });
    const filename = safeFileName(document.file_name || `${document.documento_id}.pdf`);
    return new NextResponse(Buffer.from(file.plaintext), {
      headers: {
        'Content-Type': file.mimeType || document.file_type || 'application/pdf',
        'Content-Length': String(file.plaintext.byteLength),
        'Content-Disposition': `${request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  } catch (error) {
    console.error('[public-document-file] delivery failed', {
      code:
        error instanceof Error && 'code' in error ? String(error.code) : 'DOCUMENT_DELIVERY_FAILED',
    });
    return NextResponse.json({ error: 'No fue posible entregar el documento.' }, { status: 409 });
  }
}
