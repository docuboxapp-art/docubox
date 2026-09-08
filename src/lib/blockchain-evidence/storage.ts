import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  documentEncryptionPolicy,
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '@/lib/crypto/document-encryption';

export const BLOCKCHAIN_EVIDENCE_BUCKET = 'blockchain-evidence';

export async function storeBlockchainArtifact(input: {
  service: SupabaseClient;
  bytes: Uint8Array;
  tenantId: string;
  documentId: string;
  documentVersionId: string;
  path: string;
  mimeType: string;
  kind?: 'evidence' | 'constancia';
  userId?: string | null;
}) {
  if (documentEncryptionPolicy().enabled) {
    await encryptAndUploadDocumentObject({
      service: input.service,
      plaintext: input.bytes,
      tenantId: input.tenantId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      artifactKind: input.kind || 'evidence',
      storageBucket: BLOCKCHAIN_EVIDENCE_BUCKET,
      storagePath: input.path,
      originalMimeType: input.mimeType,
      userId: input.userId,
    });
    return;
  }
  const upload = await input.service.storage
    .from(BLOCKCHAIN_EVIDENCE_BUCKET)
    .upload(input.path, input.bytes, {
      contentType: input.mimeType,
      cacheControl: 'private, max-age=0',
      upsert: false,
    });
  if (upload.error) throw upload.error;
}

export async function readBlockchainArtifact(
  service: SupabaseClient,
  path: string,
  expectedHash?: string | null
) {
  if (documentEncryptionPolicy().enabled) {
    const result = await readDocumentStorageObject({
      service,
      storageBucket: BLOCKCHAIN_EVIDENCE_BUCKET,
      storagePath: path,
      expectedPlaintextSha256: expectedHash,
    });
    return new Uint8Array(result.plaintext);
  }
  const result = await service.storage.from(BLOCKCHAIN_EVIDENCE_BUCKET).download(path);
  if (result.error || !result.data)
    throw result.error || new Error('BLOCKCHAIN_ARTIFACT_NOT_FOUND');
  return new Uint8Array(await result.data.arrayBuffer());
}
