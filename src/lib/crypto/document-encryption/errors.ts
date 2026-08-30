export type DocumentEncryptionErrorCode =
  | 'DOCUMENT_ENCRYPTION_FAILED'
  | 'DOCUMENT_DECRYPTION_FAILED'
  | 'DOCUMENT_KEY_WRAP_FAILED'
  | 'DOCUMENT_KEY_UNWRAP_FAILED'
  | 'DOCUMENT_INTEGRITY_FAILURE'
  | 'DOCUMENT_DECRYPTION_AUTH_FAILURE'
  | 'DOCUMENT_ENCRYPTION_METADATA_MISSING'
  | 'DOCUMENT_UNSUPPORTED_ENCRYPTION_VERSION'
  | 'DOCUMENT_ENCRYPTION_NOT_CONFIGURED'
  | 'DOCUMENT_ENCRYPTION_PROVIDER_UNSUPPORTED'
  | 'DOCUMENT_ENCRYPTION_STORAGE_FAILED';

export class DocumentEncryptionError extends Error {
  constructor(
    public readonly code: DocumentEncryptionErrorCode,
    message: string,
    public readonly status = 500,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'DocumentEncryptionError';
  }
}
