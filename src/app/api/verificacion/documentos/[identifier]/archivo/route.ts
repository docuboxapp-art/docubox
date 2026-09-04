import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveLegacyDocumentStoragePath } from '@/lib/documents/internal-source';
import { readDocumentStorageObject } from '@/lib/crypto/document-encryption';
import { enforcePublicRateLimit } from '@/lib/public-verification/gateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeFileName(value: unknown) {
  return String(value || 'documento.pdf').replace(/[\r\n"\\/:*?<>|]/g, '_');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  if (!enforcePublicRateLimit(request, 'public-document-file', 20)) {
    return NextResponse.json({ error: 'Demasiadas solicitudes.' }, { status: 429 });
  }
  const { identifier: rawIdentifier } = await params;
  const identifier = decodeURIComponent(rawIdentifier || '').trim();
  if (!identifier || identifier.length > 120) {
    return NextResponse.json({ error: 'Identificador invalido.' }, { status: 400 });
  }

  const service = createServiceClient();
  const select =
    'id,documento_id,nombre,estado,es_publico,file_name,file_type,storage_path,file_url,file_hash_sha256,sealed_pdf_path,sealed_pdf_hash';
  const base = () =>
    service.from('documentos').select(select).eq('estado', 'completado').eq('es_publico', true);
  let document = UUID_PATTERN.test(identifier)
    ? (await base().eq('id', identifier).maybeSingle()).data
    : (await base().eq('documento_id', identifier).maybeSingle()).data;
  if (!document && !UUID_PATTERN.test(identifier)) {
    document = (await base().eq('folio_interno', identifier).maybeSingle()).data;
  }
  if (!document) {
    return NextResponse.json({ error: 'Documento publico no encontrado.' }, { status: 404 });
  }

  const finalPath = String(document.sealed_pdf_path || '').trim();
  const storagePath =
    finalPath || resolveLegacyDocumentStoragePath(document.storage_path, document.file_url);
  if (!storagePath) {
    return NextResponse.json({ error: 'Archivo no disponible.' }, { status: 404 });
  }
  try {
    const file = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath,
      expectedPlaintextSha256: finalPath ? document.sealed_pdf_hash : document.file_hash_sha256,
      requestId: request.headers.get('x-request-id'),
      accessEvent: 'DOCUMENT_VIEWED',
    });
    const filename = safeFileName(document.file_name || `${document.documento_id}.pdf`);
    return new NextResponse(Buffer.from(file.plaintext), {
      headers: {
        'Content-Type': file.mimeType || document.file_type || 'application/pdf',
        'Content-Length': String(file.plaintext.byteLength),
        'Content-Disposition': `inline; filename="${filename}"`,
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
