import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
} from '@/lib/crypto/document-encryption';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  try {
    const { user, document, service } = await requireDocumentAccess(request, documentId, {
      ownerOrAdminOnly: true,
    });
    if (['completado', 'cancelado', 'rechazado'].includes(String(document.estado))) {
      return NextResponse.json(
        { error: 'El archivo de un documento cerrado no puede reemplazarse.' },
        { status: 409 }
      );
    }
    if (!document.workspace_id) {
      return NextResponse.json(
        { error: 'El documento debe pertenecer a un espacio de trabajo.' },
        { status: 422 }
      );
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Archivo invalido o demasiado grande.' }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const plaintextSha256 = createHash('sha256').update(bytes).digest('hex');
    const versions = await service
      .from('document_versions')
      .select('version_number')
      .eq('workspace_id', document.workspace_id)
      .eq('document_id', document.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versions.error) throw versions.error;
    const versionId = randomUUID();
    const versionNumber = Number(versions.data?.version_number || 0) + 1;
    const encrypted = documentEncryptionPolicy().enabled;
    const storagePath = encrypted
      ? `tenants/${document.workspace_id}/documents/${document.id}/versions/${versionId}/payload.enc`
      : `${document.workspace_id}/${document.id}/versions/${versionId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const insertedVersion = await service.from('document_versions').insert({
      id: versionId,
      workspace_id: document.workspace_id,
      document_id: document.id,
      version_number: versionNumber,
      status: 'draft',
      storage_path: storagePath,
      file_url: encrypted ? `/api/documentos/${document.id}/viewer-file` : null,
      mime_type: file.type || 'application/octet-stream',
      byte_size: bytes.byteLength,
      sha256: plaintextSha256,
      change_reason: 'Archivo reemplazado desde el visor',
      source_version_id: null,
      created_by: user.id,
      metadata: { source: 'viewer_replace_file', schema_version: 1 },
    });
    if (insertedVersion.error) throw insertedVersion.error;

    try {
      if (encrypted) {
        await encryptAndUploadDocumentObject({
          service,
          plaintext: bytes,
          tenantId: document.workspace_id,
          documentId: document.id,
          documentVersionId: versionId,
          artifactKind: 'document',
          storageBucket: 'documents',
          storagePath,
          originalFileName: file.name,
          originalMimeType: file.type,
          userId: user.id,
          requestId: request.headers.get('x-request-id'),
        });
      } else {
        const upload = await service.storage.from('documents').upload(storagePath, bytes, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });
        if (upload.error) throw upload.error;
      }
      const fileUrl = encrypted ? `/api/documentos/${document.id}/viewer-file` : storagePath;
      const updated = await service
        .from('documentos')
        .update({
          storage_path: storagePath,
          file_url: fileUrl,
          file_name: file.name,
          file_size: bytes.byteLength,
          file_type: file.type || 'application/octet-stream',
          file_hash_sha256: plaintextSha256,
        })
        .eq('id', document.id)
        .select('id')
        .maybeSingle();
      if (updated.error || !updated.data)
        throw updated.error || new Error('DOCUMENT_UPDATE_CONFLICT');
      return NextResponse.json({
        ok: true,
        file_url: fileUrl,
        file_size: bytes.byteLength,
        file_type: file.type || 'application/octet-stream',
        sha256: plaintextSha256,
        document_version_id: versionId,
      });
    } catch (error) {
      await service.storage.from('documents').remove([storagePath]);
      await service
        .from('document_encryption_metadata')
        .delete()
        .eq('document_version_id', versionId);
      await service.from('document_versions').delete().eq('id', versionId);
      throw error;
    } finally {
      bytes.fill(0);
    }
  } catch (error) {
    const access = documentAccessResponse(error);
    if (access.status !== 500) {
      return NextResponse.json(access.body, { status: access.status });
    }
    console.error('[replace-file] backend replacement failed', {
      code: error instanceof Error && 'code' in error ? String(error.code) : 'REPLACE_FILE_FAILED',
    });
    return NextResponse.json({ error: 'No fue posible reemplazar el archivo.' }, { status: 500 });
  }
}
