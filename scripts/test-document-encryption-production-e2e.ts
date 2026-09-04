import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

const confirmation = required('DOCUMENT_ENCRYPTION_PRODUCTION_E2E_CONFIRM');
assert(confirmation === 'I_UNDERSTAND_TEST_ARTIFACT', 'PRODUCTION_E2E_CONFIRMATION_INVALID');

const service = createClient(
  required('NEXT_PUBLIC_SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const workspaceId = '3f465c1f-ee48-403c-b74d-a9338859c6d2';
const { data: sourceDocument, error: sourceDocumentError } = await service
  .from('documentos')
  .select('id, owner_id')
  .eq('workspace_id', workspaceId)
  .is('deleted_at', null)
  .limit(1)
  .maybeSingle();
if (sourceDocumentError || !sourceDocument?.id || !sourceDocument.owner_id) {
  throw sourceDocumentError || new Error('E2E_SOURCE_DOCUMENT_NOT_FOUND');
}

const { data: sourceVersion, error: sourceVersionError } = await service
  .from('document_versions')
  .select('id')
  .eq('document_id', sourceDocument.id)
  .eq('workspace_id', workspaceId)
  .order('version_number', { ascending: false })
  .limit(1)
  .maybeSingle();
if (sourceVersionError || !sourceVersion?.id) {
  throw sourceVersionError || new Error('E2E_SOURCE_VERSION_NOT_FOUND');
}

const documentId = sourceDocument.id;
const versionId = sourceVersion.id;
const storageBucket = 'documents';
const storagePath = `e2e-encryption/${workspaceId}/${documentId}/${versionId}/${randomUUID()}/payload.enc`;
const plaintext = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'utf8'
);
const plaintextHash = sha256(plaintext);
let metadataId: string | null = null;
const ownerId = sourceDocument.owner_id;

try {
  const {
    encryptAndUploadDocumentObject,
    readDocumentStorageObject,
    createDocumentEncryptionService,
  } = await import('../src/lib/crypto/document-encryption/index.ts');

  const encrypted = await encryptAndUploadDocumentObject({
    service,
    plaintext,
    tenantId: workspaceId,
    documentId,
    documentVersionId: versionId,
    artifactKind: 'document',
    storageBucket,
    storagePath,
    originalFileName: 'docubox-encryption-e2e.pdf',
    originalMimeType: 'application/pdf',
    userId: ownerId,
    requestId: `production-e2e:${documentId}`,
  });
  metadataId = encrypted.metadataId;
  assert(encrypted.metadata.plaintext_sha256 === plaintextHash, 'PLAINTEXT_HASH_NOT_PERSISTED');

  const direct = await service.storage.from(storageBucket).download(storagePath);
  if (direct.error || !direct.data)
    throw direct.error || new Error('DIRECT_CIPHERTEXT_DOWNLOAD_FAILED');
  const ciphertext = Buffer.from(await direct.data.arrayBuffer());
  assert(ciphertext.subarray(0, 5).toString('ascii') !== '%PDF-', 'DIRECT_STORAGE_EXPOSES_PDF');
  assert(sha256(ciphertext) === encrypted.metadata.ciphertext_sha256, 'CIPHERTEXT_HASH_MISMATCH');

  const downloaded = await readDocumentStorageObject({
    service,
    storageBucket,
    storagePath,
    expectedPlaintextSha256: plaintextHash,
    userId: ownerId,
    requestId: `production-e2e-authorized:${documentId}`,
    accessEvent: 'DOCUMENT_DOWNLOADED',
  });
  assert(Buffer.from(downloaded.plaintext).equals(plaintext), 'AUTHORIZED_DOWNLOAD_MISMATCH');
  downloaded.plaintext.fill(0);

  const encryption = createDocumentEncryptionService();
  const metadata = encrypted.metadata;
  const expectFailure = async (
    label: string,
    alteredMetadata = metadata,
    alteredCiphertext = ciphertext
  ) => {
    try {
      await encryption.decryptDocument({
        ciphertext: alteredCiphertext,
        metadata: alteredMetadata,
      });
      throw new Error(`${label}_DID_NOT_FAIL`);
    } catch (error) {
      if (error instanceof Error && error.message === `${label}_DID_NOT_FAIL`) throw error;
    }
  };

  const alteredCiphertext = Buffer.from(ciphertext);
  alteredCiphertext[0] ^= 1;
  await expectFailure('CIPHERTEXT_ALTERED', metadata, alteredCiphertext);
  await expectFailure('NONCE_ALTERED', {
    ...metadata,
    nonce: Buffer.from('altered').toString('base64'),
  });
  await expectFailure('AAD_ALTERED', { ...metadata, tenant_id: randomUUID() });
  await expectFailure('WRAPPED_DEK_ALTERED', {
    ...metadata,
    wrapped_dek: Buffer.from('altered-wrapped-dek').toString('base64'),
  });
  await expectFailure('KMS_RESOURCE_MISMATCH', {
    ...metadata,
    kms_key_id: `${metadata.kms_key_id}-wrong`,
  });

  console.info('Production document encryption E2E');
  console.info('-----------------------------------');
  console.info(`Document test artifact: ${documentId}`);
  console.info(`Plaintext SHA-256: ${plaintextHash}`);
  console.info(`Ciphertext SHA-256: ${encrypted.metadata.ciphertext_sha256}`);
  console.info('Storage direct prefix is not %PDF-: true');
  console.info('Authorized decrypt byte equality: true');
  console.info('Ciphertext altered denied: true');
  console.info('Nonce altered denied: true');
  console.info('AAD altered denied: true');
  console.info('Wrapped DEK altered denied: true');
  console.info('KMS resource mismatch denied: true');
  console.info('DOCUMENT ENCRYPTION PRODUCTION E2E VERIFIED');
} finally {
  plaintext.fill(0);
  if (metadataId) {
    const removedMetadata = await service
      .from('document_encryption_metadata')
      .delete()
      .eq('id', metadataId);
    if (removedMetadata.error) {
      console.error('E2E metadata cleanup failed', removedMetadata.error.code || 'UNKNOWN');
      process.exitCode = 1;
    }
  }
  const removedObject = await service.storage.from(storageBucket).remove([storagePath]);
  if (removedObject.error) {
    console.error('E2E storage cleanup failed', removedObject.error.message);
    process.exitCode = 1;
  }
}
