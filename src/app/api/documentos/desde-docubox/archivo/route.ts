import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import {
  InternalSourceError,
  resolveInternalDocumentSource,
  type InternalSourceVariant,
} from '@/lib/documents/internal-source';
import {
  documentEncryptionPolicy,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function safeFileName(value: string) {
  return value.replace(/[\r\n"]/g, '_');
}

export async function GET(request: NextRequest) {
  try {
    const token = bearerToken(request);
    if (!token) return NextResponse.json({ error: 'Debes iniciar sesion.' }, { status: 401 });
    const auth = await createAnonClient().auth.getUser(token);
    if (auth.error || !auth.data.user) {
      return NextResponse.json({ error: 'La sesion no es valida.' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
    const documentId = request.nextUrl.searchParams.get('documentId') || '';
    const versionId = request.nextUrl.searchParams.get('versionId');
    const rawVariant = request.nextUrl.searchParams.get('variant') || 'original';
    const variant: InternalSourceVariant =
      rawVariant === 'certified' || rawVariant === 'version' ? rawVariant : 'original';
    const service = createServiceClient();
    const source = await resolveInternalDocumentSource(service, auth.data.user, {
      workspaceId,
      documentId,
      versionId,
      variant,
    });

    if (request.nextUrl.searchParams.get('mode') === 'url') {
      if (documentEncryptionPolicy().enabled) {
        const direct = new URL(request.url);
        direct.searchParams.delete('mode');
        return NextResponse.json(
          {
            url: `${direct.pathname}${direct.search}`,
            expiresIn: 300,
            sha256: source.sha256,
          },
          { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
        );
      }
      const signedUrl = await service.storage
        .from('documents')
        .createSignedUrl(source.storagePath, 300);
      if (signedUrl.error || !signedUrl.data?.signedUrl) {
        throw new InternalSourceError(
          404,
          'SOURCE_FILE_NOT_FOUND',
          'El archivo original no esta disponible.'
        );
      }
      return NextResponse.json(
        {
          url: signedUrl.data.signedUrl,
          expiresIn: 300,
          sha256: source.sha256,
        },
        {
          headers: { 'Cache-Control': 'private, no-store, max-age=0' },
        }
      );
    }

    let bytes: Uint8Array;
    if (documentEncryptionPolicy().enabled) {
      const decrypted = await readDocumentStorageObject({
        service,
        storageBucket: 'documents',
        storagePath: source.storagePath,
        expectedPlaintextSha256: source.sha256,
        userId: auth.data.user.id,
        requestId: request.headers.get('x-request-id'),
        accessEvent: 'DOCUMENT_VIEWED',
      });
      bytes = new Uint8Array(decrypted.plaintext);
    } else {
      const downloaded = await service.storage.from('documents').download(source.storagePath);
      if (downloaded.error || !downloaded.data) {
        throw new InternalSourceError(
          404,
          'SOURCE_FILE_NOT_FOUND',
          'El archivo de esta version no esta disponible.'
        );
      }
      bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    }

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': source.fileType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${safeFileName(source.fileName)}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Docubox-SHA256': source.sha256,
      },
    });
  } catch (error) {
    if (error instanceof InternalSourceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error('[DOCUBOX][desde-docubox] No se pudo descargar la version:', error);
    return NextResponse.json(
      { error: 'No se pudo recuperar esta version del documento.' },
      { status: 500 }
    );
  }
}
