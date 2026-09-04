import type { SupabaseClient } from '@supabase/supabase-js';
import { createDocumentEncryptionService, documentEncryptionPolicy } from './config';
import {
  sha256Hex,
  type DocumentArtifactKind,
  type PersistedDocumentEncryptionMetadata,
} from './encryption-metadata';
import { DocumentEncryptionError } from './errors';

type SecurityEvent = {
  tenantId?: string | null;
  documentId?: string | null;
  documentVersionId?: string | null;
  userId?: string | null;
  eventType:
    | 'DOCUMENT_ENCRYPTED'
    | 'DOCUMENT_DECRYPTED'
    | 'DOCUMENT_VIEWED'
    | 'DOCUMENT_DOWNLOADED'
    | 'DOCUMENT_ENCRYPTION_FAILED'
    | 'DOCUMENT_DECRYPTION_FAILED'
    | 'DOCUMENT_INTEGRITY_FAILURE'
    | 'DOCUMENT_KEY_UNWRAP_FAILED'
    | 'DOCUMENT_KEY_ROTATED'
    | 'LEGACY_PLAINTEXT_ACCESS';
  result?: 'success' | 'failure';
  reason?: string | null;
  source?: string;
  requestId?: string | null;
  metrics?: Record<string, number>;
};

export async function recordDocumentEncryptionEvent(service: SupabaseClient, event: SecurityEvent) {
  const inserted = await service.from('document_encryption_security_events').insert({
    tenant_id: event.tenantId || null,
    document_id: event.documentId || null,
    document_version_id: event.documentVersionId || null,
    user_id: event.userId || null,
    event_type: event.eventType,
    result: event.result || 'success',
    reason: event.reason || null,
    source: event.source || 'backend',
    request_id: event.requestId || null,
    metrics: event.metrics || {},
  });
  if (inserted.error) {
    console.error('[document-encryption] security event write failed', {
      eventType: event.eventType,
      code: inserted.error.code || 'EVENT_WRITE_FAILED',
    });
  }
}

export async function encryptAndUploadDocumentObject(input: {
  service: SupabaseClient;
  plaintext: Uint8Array;
  tenantId: string;
  documentId: string;
  documentVersionId: string;
  artifactKind: DocumentArtifactKind;
  storageBucket: string;
  storagePath: string;
  originalFileName?: string | null;
  originalMimeType?: string | null;
  userId?: string | null;
  requestId?: string | null;
}) {
  const encryption = createDocumentEncryptionService();
  try {
    const existing = await input.service
      .from('document_encryption_metadata')
      .select('*')
      .eq('storage_bucket', input.storageBucket)
      .eq('storage_path', input.storagePath)
      .eq('status', 'active')
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const metadata = existing.data as PersistedDocumentEncryptionMetadata;
      if (
        metadata.tenant_id !== input.tenantId ||
        metadata.document_id !== input.documentId ||
        metadata.document_version_id !== input.documentVersionId ||
        metadata.artifact_kind !== input.artifactKind ||
        metadata.plaintext_sha256 !== sha256Hex(input.plaintext)
      ) {
        throw new DocumentEncryptionError(
          'DOCUMENT_ENCRYPTION_STORAGE_FAILED',
          'La ruta cifrada ya pertenece a otro contenido o contexto.',
          409
        );
      }
      const verified = await readDocumentStorageObject({
        service: input.service,
        storageBucket: input.storageBucket,
        storagePath: input.storagePath,
        expectedPlaintextSha256: metadata.plaintext_sha256,
        userId: input.userId,
        requestId: input.requestId,
      });
      const matches = Buffer.from(verified.plaintext).equals(Buffer.from(input.plaintext));
      verified.plaintext.fill(0);
      if (!matches) {
        throw new DocumentEncryptionError(
          'DOCUMENT_INTEGRITY_FAILURE',
          'El objeto cifrado idempotente no coincide byte por byte.',
          409
        );
      }
      return {
        ciphertext: Buffer.alloc(0),
        metadata,
        metadataId: metadata.id,
        metrics: { encrypt_ms: 0, kms_wrap_ms: 0 },
        alreadyExisted: true,
      };
    }
    const encrypted = await encryption.encryptDocument({
      plaintext: input.plaintext,
      context: {
        tenantId: input.tenantId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        artifactKind: input.artifactKind,
      },
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      originalFileName: input.originalFileName,
      originalMimeType: input.originalMimeType,
    });
    const upload = await input.service.storage
      .from(input.storageBucket)
      .upload(input.storagePath, encrypted.ciphertext, {
        contentType: 'application/octet-stream',
        cacheControl: 'private, max-age=0',
        upsert: false,
      });
    if (upload.error) {
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_STORAGE_FAILED',
        'No fue posible almacenar el documento cifrado.',
        500,
        { cause: upload.error }
      );
    }
    const persisted = await input.service
      .from('document_encryption_metadata')
      .insert(encrypted.metadata)
      .select('id')
      .single();
    if (persisted.error || !persisted.data) {
      await input.service.storage.from(input.storageBucket).remove([input.storagePath]);
      throw new DocumentEncryptionError(
        'DOCUMENT_ENCRYPTION_STORAGE_FAILED',
        'No fue posible persistir la metadata de cifrado.',
        500,
        { cause: persisted.error }
      );
    }
    await recordDocumentEncryptionEvent(input.service, {
      tenantId: input.tenantId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      userId: input.userId,
      eventType: 'DOCUMENT_ENCRYPTED',
      source: 'document-storage',
      requestId: input.requestId,
      metrics: encrypted.metrics,
    });
    return { ...encrypted, metadataId: persisted.data.id, alreadyExisted: false };
  } catch (error) {
    await recordDocumentEncryptionEvent(input.service, {
      tenantId: input.tenantId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      userId: input.userId,
      eventType: 'DOCUMENT_ENCRYPTION_FAILED',
      result: 'failure',
      reason: error instanceof DocumentEncryptionError ? error.code : 'DOCUMENT_ENCRYPTION_FAILED',
      source: 'document-storage',
      requestId: input.requestId,
    });
    throw error;
  }
}

export async function readDocumentStorageObject(input: {
  service: SupabaseClient;
  storageBucket: string;
  storagePath: string;
  expectedPlaintextSha256?: string | null;
  userId?: string | null;
  requestId?: string | null;
  accessEvent?: 'DOCUMENT_DECRYPTED' | 'DOCUMENT_VIEWED' | 'DOCUMENT_DOWNLOADED';
}) {
  const metadataResult = await input.service
    .from('document_encryption_metadata')
    .select('*')
    .eq('storage_bucket', input.storageBucket)
    .eq('storage_path', input.storagePath)
    .eq('status', 'active')
    .maybeSingle();
  if (metadataResult.error) throw metadataResult.error;

  const downloaded = await input.service.storage
    .from(input.storageBucket)
    .download(input.storagePath);
  if (downloaded.error || !downloaded.data) {
    throw new DocumentEncryptionError(
      'DOCUMENT_ENCRYPTION_STORAGE_FAILED',
      'No fue posible recuperar el objeto documental.',
      500,
      { cause: downloaded.error }
    );
  }
  const storedBytes = Buffer.from(await downloaded.data.arrayBuffer());
  const metadata = metadataResult.data as PersistedDocumentEncryptionMetadata | null;
  if (!metadata) {
    const policy = documentEncryptionPolicy();
    if (!policy.legacyAllowed) {
      storedBytes.fill(0);
      throw new DocumentEncryptionError(
        'DOCUMENT_LEGACY_PLAINTEXT_BLOCKED',
        'El documento legacy está pendiente de migración a almacenamiento cifrado.',
        409
      );
    }
    if (
      input.expectedPlaintextSha256 &&
      sha256Hex(storedBytes) !== input.expectedPlaintextSha256.toLowerCase()
    ) {
      storedBytes.fill(0);
      throw new DocumentEncryptionError(
        'DOCUMENT_INTEGRITY_FAILURE',
        'El documento legacy no coincide con su huella registrada.',
        409
      );
    }
    await recordDocumentEncryptionEvent(input.service, {
      userId: input.userId,
      eventType: 'LEGACY_PLAINTEXT_ACCESS',
      source: 'document-storage',
      requestId: input.requestId,
    });
    return {
      plaintext: storedBytes,
      encrypted: false as const,
      metadata: null,
      mimeType: downloaded.data.type || 'application/octet-stream',
      fileName: null,
    };
  }

  try {
    const decrypted = await createDocumentEncryptionService().decryptDocument({
      ciphertext: storedBytes,
      metadata,
    });
    storedBytes.fill(0);
    if (
      input.expectedPlaintextSha256 &&
      metadata.plaintext_sha256 !== input.expectedPlaintextSha256.toLowerCase()
    ) {
      decrypted.plaintext.fill(0);
      throw new DocumentEncryptionError(
        'DOCUMENT_INTEGRITY_FAILURE',
        'La huella logica solicitada no coincide con la version cifrada.',
        409
      );
    }
    await recordDocumentEncryptionEvent(input.service, {
      tenantId: metadata.tenant_id,
      documentId: metadata.document_id,
      documentVersionId: metadata.document_version_id,
      userId: input.userId,
      eventType: input.accessEvent || 'DOCUMENT_DECRYPTED',
      source: 'document-storage',
      requestId: input.requestId,
      metrics: decrypted.metrics,
    });
    return {
      plaintext: decrypted.plaintext,
      encrypted: true as const,
      metadata,
      mimeType: metadata.original_mime_type,
      fileName: metadata.original_file_name,
    };
  } catch (error) {
    storedBytes.fill(0);
    const reason =
      error instanceof DocumentEncryptionError ? error.code : 'DOCUMENT_DECRYPTION_FAILED';
    await recordDocumentEncryptionEvent(input.service, {
      tenantId: metadata.tenant_id,
      documentId: metadata.document_id,
      documentVersionId: metadata.document_version_id,
      userId: input.userId,
      eventType:
        reason === 'DOCUMENT_INTEGRITY_FAILURE'
          ? 'DOCUMENT_INTEGRITY_FAILURE'
          : reason === 'DOCUMENT_KEY_UNWRAP_FAILED'
            ? 'DOCUMENT_KEY_UNWRAP_FAILED'
            : 'DOCUMENT_DECRYPTION_FAILED',
      result: 'failure',
      reason,
      source: 'document-storage',
      requestId: input.requestId,
    });
    throw error;
  }
}
