import { decryptAes256Gcm, encryptAes256Gcm, generateDocumentDek } from './algorithms/aes-256-gcm';
import {
  buildDocumentAad,
  contextFromMetadata,
  DOCUMENT_ENCRYPTION_ALGORITHM,
  DOCUMENT_ENCRYPTION_VERSION,
  sha256Hex,
  type DocumentEncryptionContext,
  type PersistedDocumentEncryptionMetadata,
} from './encryption-metadata';
import { DocumentEncryptionError } from './errors';
import type { DocumentKeyManagementProvider } from './kms/provider';

export class DocumentEncryptionService {
  constructor(private readonly keyManagement: DocumentKeyManagementProvider) {}

  async encryptDocument(input: {
    plaintext: Uint8Array;
    context: DocumentEncryptionContext;
    storageBucket: string;
    storagePath: string;
    originalFileName?: string | null;
    originalMimeType?: string | null;
  }) {
    const started = performance.now();
    const aad = buildDocumentAad(input.context);
    const dek = generateDocumentDek();
    try {
      const wrappedStarted = performance.now();
      const wrapped = await this.keyManagement.wrapKey({ plaintextKey: dek, aad });
      const kmsWrapMs = performance.now() - wrappedStarted;
      const encrypted = encryptAes256Gcm(input.plaintext, dek, aad);
      const encryptedAt = new Date().toISOString();
      const metadata: PersistedDocumentEncryptionMetadata = {
        tenant_id: input.context.tenantId,
        document_id: input.context.documentId,
        document_version_id: input.context.documentVersionId,
        artifact_kind: input.context.artifactKind,
        storage_bucket: input.storageBucket,
        storage_path: input.storagePath,
        status: 'active',
        encryption_version: input.context.encryptionVersion ?? DOCUMENT_ENCRYPTION_VERSION,
        encryption_algorithm: DOCUMENT_ENCRYPTION_ALGORITHM,
        wrapped_dek: wrapped.wrappedKey.toString('base64'),
        kms_provider: wrapped.provider,
        kms_key_id: wrapped.keyId,
        kms_key_version: wrapped.keyVersion,
        nonce: encrypted.nonce.toString('base64'),
        auth_tag: encrypted.authTag.toString('base64'),
        aad_sha256: sha256Hex(aad),
        ciphertext_size: encrypted.ciphertext.byteLength,
        plaintext_size: input.plaintext.byteLength,
        plaintext_sha256: sha256Hex(input.plaintext),
        ciphertext_sha256: sha256Hex(encrypted.ciphertext),
        original_file_name: input.originalFileName || null,
        original_mime_type: input.originalMimeType || 'application/octet-stream',
        encrypted_at: encryptedAt,
      };
      return {
        ciphertext: encrypted.ciphertext,
        metadata,
        metrics: {
          encrypt_ms: performance.now() - started,
          kms_wrap_ms: kmsWrapMs,
        },
      };
    } finally {
      dek.fill(0);
    }
  }

  async decryptDocument(input: {
    ciphertext: Uint8Array;
    metadata: PersistedDocumentEncryptionMetadata;
  }) {
    const started = performance.now();
    const metadata = input.metadata;
    if (
      metadata.encryption_version !== DOCUMENT_ENCRYPTION_VERSION ||
      metadata.encryption_algorithm !== DOCUMENT_ENCRYPTION_ALGORITHM
    ) {
      throw new DocumentEncryptionError(
        'DOCUMENT_UNSUPPORTED_ENCRYPTION_VERSION',
        'La version de cifrado del documento no esta soportada.',
        409
      );
    }
    if (
      input.ciphertext.byteLength !== Number(metadata.ciphertext_size) ||
      sha256Hex(input.ciphertext) !== metadata.ciphertext_sha256
    ) {
      throw new DocumentEncryptionError(
        'DOCUMENT_INTEGRITY_FAILURE',
        'El ciphertext almacenado no coincide con su metadata de integridad.',
        409
      );
    }
    const aad = buildDocumentAad(contextFromMetadata(metadata));
    if (sha256Hex(aad) !== metadata.aad_sha256) {
      throw new DocumentEncryptionError(
        'DOCUMENT_INTEGRITY_FAILURE',
        'El contexto criptografico del documento no coincide con su metadata.',
        409
      );
    }
    const unwrapStarted = performance.now();
    let dek: Buffer;
    try {
      dek = await this.keyManagement.unwrapKey({
        wrappedKey: Buffer.from(metadata.wrapped_dek, 'base64'),
        aad,
        keyId: metadata.kms_key_id,
        keyVersion: metadata.kms_key_version,
      });
    } catch (error) {
      if (error instanceof DocumentEncryptionError) throw error;
      throw new DocumentEncryptionError(
        'DOCUMENT_KEY_UNWRAP_FAILED',
        'No fue posible recuperar la llave del documento.',
        503,
        { cause: error }
      );
    }
    const kmsUnwrapMs = performance.now() - unwrapStarted;
    try {
      const plaintext = decryptAes256Gcm({
        ciphertext: input.ciphertext,
        dek,
        aad,
        nonce: Buffer.from(metadata.nonce, 'base64'),
        authTag: Buffer.from(metadata.auth_tag, 'base64'),
      });
      if (
        plaintext.byteLength !== Number(metadata.plaintext_size) ||
        sha256Hex(plaintext) !== metadata.plaintext_sha256
      ) {
        plaintext.fill(0);
        throw new DocumentEncryptionError(
          'DOCUMENT_INTEGRITY_FAILURE',
          'El documento descifrado no coincide con su huella logica.',
          409
        );
      }
      return {
        plaintext,
        metrics: {
          decrypt_ms: performance.now() - started,
          kms_unwrap_ms: kmsUnwrapMs,
        },
      };
    } finally {
      dek.fill(0);
    }
  }

  async rewrapDocumentKey(input: {
    metadata: PersistedDocumentEncryptionMetadata;
    newProvider: DocumentKeyManagementProvider;
  }) {
    const aad = buildDocumentAad(contextFromMetadata(input.metadata));
    const dek = await this.keyManagement.unwrapKey({
      wrappedKey: Buffer.from(input.metadata.wrapped_dek, 'base64'),
      aad,
      keyId: input.metadata.kms_key_id,
      keyVersion: input.metadata.kms_key_version,
    });
    try {
      const wrapped = await input.newProvider.wrapKey({ plaintextKey: dek, aad });
      return {
        wrapped_dek: wrapped.wrappedKey.toString('base64'),
        kms_provider: wrapped.provider,
        kms_key_id: wrapped.keyId,
        kms_key_version: wrapped.keyVersion,
        rewrapped_at: new Date().toISOString(),
      };
    } finally {
      dek.fill(0);
    }
  }
}
