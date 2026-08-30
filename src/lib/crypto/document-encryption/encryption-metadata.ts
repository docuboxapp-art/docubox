import { createHash } from 'node:crypto';

export const DOCUMENT_ENCRYPTION_ALGORITHM = 'AES-256-GCM' as const;
export const DOCUMENT_ENCRYPTION_VERSION = 1 as const;
export const DOCUMENT_DEK_BYTES = 32;
export const DOCUMENT_NONCE_BYTES = 12;
export const DOCUMENT_AUTH_TAG_BYTES = 16;

export type DocumentArtifactKind =
  | 'document'
  | 'visual_pdf'
  | 'signed_pdf'
  | 'certified_pdf'
  | 'constancia'
  | 'evidence'
  | 'preview'
  | 'attachment';

export type DocumentEncryptionContext = {
  tenantId: string;
  documentId: string;
  documentVersionId: string;
  artifactKind: DocumentArtifactKind;
  encryptionVersion?: number;
};

export type PersistedDocumentEncryptionMetadata = {
  id?: string;
  tenant_id: string;
  document_id: string;
  document_version_id: string;
  artifact_kind: DocumentArtifactKind;
  storage_bucket: string;
  storage_path: string;
  status: 'active' | 'migrating' | 'superseded' | 'failed';
  encryption_version: number;
  encryption_algorithm: typeof DOCUMENT_ENCRYPTION_ALGORITHM;
  wrapped_dek: string;
  kms_provider: string;
  kms_key_id: string;
  kms_key_version: string;
  nonce: string;
  auth_tag: string;
  aad_sha256: string;
  ciphertext_size: number;
  plaintext_size: number;
  plaintext_sha256: string;
  ciphertext_sha256: string;
  original_file_name: string | null;
  original_mime_type: string;
  encrypted_at: string;
  rewrapped_at?: string | null;
};

export function buildDocumentAad(context: DocumentEncryptionContext) {
  const version = context.encryptionVersion ?? DOCUMENT_ENCRYPTION_VERSION;
  return Buffer.from(
    JSON.stringify({
      schema: 'docubox.document-encryption-aad',
      version,
      tenant_id: context.tenantId,
      document_id: context.documentId,
      document_version_id: context.documentVersionId,
      artifact_kind: context.artifactKind,
    }),
    'utf8'
  );
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function contextFromMetadata(metadata: PersistedDocumentEncryptionMetadata) {
  return {
    tenantId: metadata.tenant_id,
    documentId: metadata.document_id,
    documentVersionId: metadata.document_version_id,
    artifactKind: metadata.artifact_kind,
    encryptionVersion: metadata.encryption_version,
  } satisfies DocumentEncryptionContext;
}
