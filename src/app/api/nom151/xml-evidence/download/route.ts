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
    const storagePath = String(document.xml_evidencia_path || '').trim();

    if (!storagePath) {
      return NextResponse.json(
        { error: 'El XML de evidencia todavia no ha sido generado.' },
        { status: 404 },
      );
    }

    const downloaded = await service.storage.from('evidence').download(storagePath);
    if (downloaded.error || !downloaded.data) {
      console.error('[DOCUBOX][xml-evidence] No se pudo leer el XML:', downloaded.error?.message);
      return NextResponse.json(
        { error: 'El XML generado no esta disponible en el almacenamiento privado.' },
        { status: 404 },
      );
    }

    const documentLabel = String(document.documento_id || document.nombre || documentoId);
    const fileName = safeFileName(`evidencia_${documentLabel}.xml`);

    return new NextResponse(await downloaded.data.arrayBuffer(), {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Length': String(downloaded.data.size),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: unknown) {
    const response = documentAccessResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
