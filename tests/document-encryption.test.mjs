import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import test from 'node:test';

const cacheDirectory = join(
  process.cwd(),
  'node_modules',
  '.cache',
  'docubox-document-encryption-test'
);
const bundlePath = join(cacheDirectory, 'document-encryption.cjs');
const migrationSql = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260829232609_document_encryption_metadata.sql'),
  'utf8'
);
const canaryMigrationScript = readFileSync(
  join(process.cwd(), 'scripts', 'migrate-legacy-document-canary.ts'),
  'utf8'
);
const batchMigrationScript = readFileSync(
  join(process.cwd(), 'scripts', 'migrate-legacy-document-batch.ts'),
  'utf8'
);
const inventoryScript = readFileSync(
  join(process.cwd(), 'scripts', 'audit-document-encryption.ts'),
  'utf8'
);
const finalClosureAuditScript = readFileSync(
  join(process.cwd(), 'scripts', 'audit-final-encryption-closure.ts'),
  'utf8'
);
const finalClosureMigrationScript = readFileSync(
  join(process.cwd(), 'scripts', 'migrate-final-encryption-closure-batch.ts'),
  'utf8'
);
await mkdir(cacheDirectory, { recursive: true });
await build({
  entryPoints: [join(process.cwd(), 'src', 'lib', 'crypto', 'document-encryption', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundlePath,
  external: ['@google-cloud/kms'],
  logLevel: 'silent',
});
const {
  buildDocumentAad,
  DocumentEncryptionService,
  DocumentEncryptionError,
  GoogleCloudDocumentKeyProvider,
} = createRequire(import.meta.url)(bundlePath);

class MemoryKmsProvider {
  constructor(masterKey = randomBytes(32), keyVersion = 'memory-key/versions/1') {
    this.masterKey = masterKey;
    this.keyVersion = keyVersion;
    this.wrappedPlaintexts = [];
  }

  async wrapKey({ plaintextKey, aad }) {
    this.wrappedPlaintexts.push(Buffer.from(plaintextKey));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, nonce);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    return {
      wrappedKey: Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]),
      provider: 'memory-kms',
      keyId: 'memory-key',
      keyVersion: this.keyVersion,
    };
  }

  async unwrapKey({ wrappedKey, aad, keyId }) {
    assert.equal(keyId, 'memory-key');
    const bytes = Buffer.from(wrappedKey);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  }

  async getKeyMetadata() {
    return {
      provider: 'memory-kms',
      keyId: 'memory-key',
      keyVersion: this.keyVersion,
      algorithm: 'TEST-AES-GCM',
      protectionLevel: 'software',
      status: 'active',
    };
  }

  async healthCheck() {
    return { ready: true, missing: [], metadata: await this.getKeyMetadata() };
  }
}

function context(overrides = {}) {
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    documentId: '22222222-2222-4222-8222-222222222222',
    documentVersionId: '33333333-3333-4333-8333-333333333333',
    artifactKind: 'document',
    ...overrides,
  };
}

async function encryptedFixture(
  plaintext = Buffer.from('%PDF-1.7\nDocubox encrypted document test')
) {
  const provider = new MemoryKmsProvider();
  const service = new DocumentEncryptionService(provider);
  const result = await service.encryptDocument({
    plaintext,
    context: context(),
    storageBucket: 'documents',
    storagePath: 'tenant/document/version/payload.enc',
    originalFileName: 'documento-prueba.pdf',
    originalMimeType: 'application/pdf',
  });
  return { plaintext, provider, service, result };
}

test('AES-256-GCM envelope encryption round-trips bytes and never stores a PDF header', async () => {
  const fixture = await encryptedFixture();
  assert.notEqual(fixture.result.ciphertext.subarray(0, 5).toString(), '%PDF-');
  assert.equal(fixture.result.metadata.encryption_algorithm, 'AES-256-GCM');
  assert.equal(fixture.result.metadata.encryption_version, 1);
  assert.equal(fixture.result.metadata.nonce.length > 0, true);
  assert.equal(fixture.result.metadata.auth_tag.length > 0, true);
  assert.equal(
    fixture.result.metadata.plaintext_sha256,
    createHash('sha256').update(fixture.plaintext).digest('hex')
  );
  assert.notEqual(
    fixture.result.metadata.plaintext_sha256,
    fixture.result.metadata.ciphertext_sha256
  );
  assert.equal('plaintext_dek' in fixture.result.metadata, false);

  const decrypted = await fixture.service.decryptDocument({
    ciphertext: fixture.result.ciphertext,
    metadata: fixture.result.metadata,
  });
  assert.deepEqual(decrypted.plaintext, fixture.plaintext);
});

test('each encryption operation receives a unique DEK and nonce', async () => {
  const provider = new MemoryKmsProvider();
  const service = new DocumentEncryptionService(provider);
  const input = {
    plaintext: Buffer.from('same logical content'),
    context: context(),
    storageBucket: 'documents',
    storagePath: 'one.enc',
  };
  const first = await service.encryptDocument(input);
  const second = await service.encryptDocument({ ...input, storagePath: 'two.enc' });
  assert.notEqual(first.metadata.nonce, second.metadata.nonce);
  assert.notDeepEqual(provider.wrappedPlaintexts[0], provider.wrappedPlaintexts[1]);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
});

for (const mutation of ['ciphertext', 'nonce', 'authTag', 'aad']) {
  test(`decryption fails closed when ${mutation} is modified`, async () => {
    const fixture = await encryptedFixture();
    const metadata = structuredClone(fixture.result.metadata);
    const ciphertext = Buffer.from(fixture.result.ciphertext);
    if (mutation === 'ciphertext') {
      ciphertext[0] ^= 1;
      metadata.ciphertext_sha256 = createHash('sha256').update(ciphertext).digest('hex');
    }
    if (mutation === 'nonce') {
      const nonce = Buffer.from(metadata.nonce, 'base64');
      nonce[0] ^= 1;
      metadata.nonce = nonce.toString('base64');
    }
    if (mutation === 'authTag') {
      const tag = Buffer.from(metadata.auth_tag, 'base64');
      tag[0] ^= 1;
      metadata.auth_tag = tag.toString('base64');
    }
    if (mutation === 'aad') {
      metadata.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      metadata.aad_sha256 = createHash('sha256')
        .update(
          buildDocumentAad({
            ...context(),
            tenantId: metadata.tenant_id,
          })
        )
        .digest('hex');
    }
    await assert.rejects(
      () => fixture.service.decryptDocument({ ciphertext, metadata }),
      (error) =>
        error instanceof DocumentEncryptionError &&
        ['DOCUMENT_DECRYPTION_AUTH_FAILURE', 'DOCUMENT_KEY_UNWRAP_FAILED'].includes(error.code)
    );
  });
}

test('wrong KEK cannot unwrap a document DEK', async () => {
  const fixture = await encryptedFixture();
  const wrongService = new DocumentEncryptionService(new MemoryKmsProvider());
  await assert.rejects(() =>
    wrongService.decryptDocument({
      ciphertext: fixture.result.ciphertext,
      metadata: fixture.result.metadata,
    })
  );
});

test('empty and large payloads preserve byte-for-byte integrity', async () => {
  for (const plaintext of [Buffer.alloc(0), randomBytes(8 * 1024 * 1024)]) {
    const fixture = await encryptedFixture(plaintext);
    const decrypted = await fixture.service.decryptDocument({
      ciphertext: fixture.result.ciphertext,
      metadata: fixture.result.metadata,
    });
    assert.deepEqual(decrypted.plaintext, plaintext);
  }
});

test('Google document KMS provider uses an injected client and symmetric key resource', async () => {
  const masterKey = randomBytes(32);
  const keyResource =
    'projects/example/locations/us-east1/keyRings/docubox/cryptoKeys/document-encryption';
  const keyVersion = `${keyResource}/cryptoKeyVersions/7`;
  const client = {
    async getCryptoKey(request) {
      assert.equal(request.name, keyResource);
      return [
        {
          primary: {
            name: keyVersion,
            algorithm: 'GOOGLE_SYMMETRIC_ENCRYPTION',
            protectionLevel: 'HSM',
            state: 'ENABLED',
          },
        },
      ];
    },
    async encrypt(request) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', masterKey, nonce);
      cipher.setAAD(Buffer.from(request.additionalAuthenticatedData));
      const body = Buffer.concat([cipher.update(request.plaintext), cipher.final()]);
      return [{ name: keyVersion, ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), body]) }];
    },
    async decrypt(request) {
      const wrapped = Buffer.from(request.ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', masterKey, wrapped.subarray(0, 12));
      decipher.setAAD(Buffer.from(request.additionalAuthenticatedData));
      decipher.setAuthTag(wrapped.subarray(12, 28));
      return [
        { plaintext: Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]) },
      ];
    },
  };
  const provider = new GoogleCloudDocumentKeyProvider(
    {
      projectId: 'example',
      serviceAccountEmail: 'docubox@example.test',
      keyResource,
      requiredProtectionLevel: 'hsm',
      timeoutMs: 1000,
    },
    client
  );
  const aad = Buffer.from('bound context');
  const plaintextKey = randomBytes(32);
  const wrapped = await provider.wrapKey({ plaintextKey, aad });
  const unwrapped = await provider.unwrapKey({
    wrappedKey: wrapped.wrappedKey,
    aad,
    keyId: wrapped.keyId,
    keyVersion: wrapped.keyVersion,
  });
  assert.deepEqual(unwrapped, plaintextKey);
  const metadata = await provider.getKeyMetadata();
  assert.equal(metadata.protectionLevel, 'hsm');
  assert.equal(metadata.algorithm, 'GOOGLE_SYMMETRIC_ENCRYPTION');
});

test('rewrap changes only wrapped key metadata and preserves ciphertext', async () => {
  const fixture = await encryptedFixture();
  const newProvider = new MemoryKmsProvider(randomBytes(32), 'memory-key/versions/2');
  const rewrapped = await fixture.service.rewrapDocumentKey({
    metadata: fixture.result.metadata,
    newProvider,
  });
  const rewrappedMetadata = { ...fixture.result.metadata, ...rewrapped };
  const decrypted = await new DocumentEncryptionService(newProvider).decryptDocument({
    ciphertext: fixture.result.ciphertext,
    metadata: rewrappedMetadata,
  });
  assert.deepEqual(decrypted.plaintext, fixture.plaintext);
  assert.equal(rewrappedMetadata.ciphertext_sha256, fixture.result.metadata.ciphertext_sha256);
  assert.notEqual(rewrappedMetadata.wrapped_dek, fixture.result.metadata.wrapped_dek);
});

test('production schema migration fails closed and disables incompatible legacy DEK helpers', () => {
  assert.match(migrationSql, /legacy_document_encryption_metadata_not_empty/);
  assert.match(
    migrationSql,
    /DROP TRIGGER IF EXISTS trg_sync_dek_counts ON public\.document_participant_deks/
  );
  assert.match(migrationSql, /DROP VIEW IF EXISTS public\.v_documents_missing_participant_deks/);
  for (const signature of [
    'generate_participant_dek_wrap(uuid,uuid,text,uuid,text,text,text,jsonb)',
    'sync_encryption_metadata_dek_counts()',
    'is_workspace_member_for_encryption(uuid)',
    'kms_rewrap_deks_batch()',
    'notify_new_participant_dek_needed()',
  ]) {
    assert.match(
      migrationSql,
      new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${signature.replace(/[()]/g, '\\$&')} FROM PUBLIC, anon, authenticated`
      )
    );
  }
  assert.match(
    migrationSql,
    /REVOKE ALL ON public\.document_encryption_metadata FROM anon, authenticated/
  );
  assert.doesNotMatch(migrationSql, /plaintext_dek|kms_private_key/i);
  assert.doesNotMatch(
    migrationSql,
    /(?:ALTER|DROP|CREATE)\s+(?:TABLE|POLICY).*\b(?:auth|storage)\./i
  );
});

test('legacy canary preserves plaintext until application access is proven', () => {
  assert.match(
    canaryMigrationScript,
    /const documentId = input\?\.documentId \|\| requiredOption\('document'\)/
  );
  assert.match(
    canaryMigrationScript,
    /const versionId = input\?\.versionId \|\| requiredOption\('version'\)/
  );
  assert.match(canaryMigrationScript, /CANARY_VERSION_ASSOCIATION_INVALID/);
  assert.match(canaryMigrationScript, /CANARY_SOURCE_SHA256_MISMATCH/);
  assert.match(canaryMigrationScript, /CANARY_CIPHERTEXT_HAS_PDF_HEADER/);
  assert.match(canaryMigrationScript, /CANARY_DECRYPTED_SHA256_MISMATCH/);
  assert.match(canaryMigrationScript, /CANARY_ATOMIC_SWITCH_CONFLICT/);
  assert.match(canaryMigrationScript, /CANARY_AUTHORIZED_PREVIEW_DOWNLOAD_NOT_VERIFIED/);
  assert.match(canaryMigrationScript, /CANARY_UNAUTHORIZED_ACCESS_NOT_VERIFIED/);
  assert.match(canaryMigrationScript, /LEGACY_DOCUMENT_ENCRYPTION_CANARY_ROLLED_BACK/);

  const accessGate = canaryMigrationScript.indexOf(
    "if (!eventTypes.has('DOCUMENT_VIEWED') || !eventTypes.has('DOCUMENT_DOWNLOADED'))"
  );
  const deleteSource = canaryMigrationScript.indexOf(
    "storage.from('documents').remove([payload.source_path])"
  );
  assert.ok(accessGate >= 0);
  assert.ok(deleteSource > accessGate);
});

test('legacy batch migration remains gated, idempotent and fail closed', () => {
  assert.match(batchMigrationScript, /const limit = Math\.min\(3,/);
  assert.match(batchMigrationScript, /process\.argv\.includes\('--execute'\)/);
  assert.match(batchMigrationScript, /SKIP_ALREADY_ENCRYPTED/);
  assert.match(batchMigrationScript, /MIGRATION_POINTER_SWITCH_CONFLICT/);
  assert.match(batchMigrationScript, /UNAUTHORIZED_APPLICATION_ACCESS_NOT_DENIED/);
  assert.match(batchMigrationScript, /WRONG_TENANT_APPLICATION_ACCESS_NOT_DENIED/);
  assert.match(batchMigrationScript, /application_revalidated: true/);
  assert.match(batchMigrationScript, /LEGACY_ENCRYPTION_FAILED/);

  const encrypt = batchMigrationScript.indexOf('encryptAndUploadDocumentObject({');
  const decrypt = batchMigrationScript.indexOf('MIGRATION_DECRYPT_VERIFICATION_FAILED');
  const switchPointer = batchMigrationScript.indexOf('await switchPointer(service, item)');
  const application = batchMigrationScript.lastIndexOf(
    'await verifyApplicationAccess(service, item, id, actorResult.data.user)'
  );
  const deleteSource = batchMigrationScript.indexOf(
    "storage.from('documents').remove([item.source_path])"
  );
  assert.ok(encrypt >= 0);
  assert.ok(decrypt > encrypt);
  assert.ok(switchPointer > decrypt);
  assert.ok(application > switchPointer);
  assert.ok(deleteSource > application);
});

test('physical inventory resolves legacy objects without mutating storage', () => {
  for (const classification of [
    'PLAINTEXT_ELIGIBLE',
    'PLAINTEXT_NOT_ELIGIBLE',
    'HISTORICAL_ARTIFACT',
    'ORPHAN',
    'DUPLICATE',
    'UNKNOWN_REQUIRES_REVIEW',
  ]) {
    assert.match(inventoryScript, new RegExp(classification));
  }
  assert.match(inventoryScript, /READ_ONLY_PHYSICAL_INVENTORY/);
  assert.doesNotMatch(inventoryScript, /\.from\([^)]*\)\s*\.(?:remove|update|insert|upsert)\(/s);
});

test('final closure forensics classifies every orphan and historical artifact read-only', () => {
  for (const classification of [
    'ORPHAN_HISTORICAL_REQUIRED',
    'ORPHAN_DUPLICATE',
    'ORPHAN_MANUAL_REVIEW_REQUIRED',
    'HISTORICAL_ENCRYPTION_REQUIRED',
    'MANUAL_REVIEW_REQUIRED',
  ]) {
    assert.match(finalClosureAuditScript, new RegExp(classification));
  }
  assert.match(finalClosureAuditScript, /READ_ONLY_FINAL_ENCRYPTION_FORENSICS/);
  assert.doesNotMatch(
    finalClosureAuditScript,
    /\.from\([^)]*\)\s*\.(?:remove|update|insert|upsert)\(/s
  );
});

test('final closure migration is bounded, idempotent and removes plaintext last', () => {
  assert.match(finalClosureMigrationScript, /const limit = Math\.min\(3,/);
  assert.match(finalClosureMigrationScript, /SKIP_ALREADY_ENCRYPTED/);
  assert.match(finalClosureMigrationScript, /REFERENCE_COMPARE_AND_SET_CONFLICT/);
  assert.match(finalClosureMigrationScript, /FINAL_ENCRYPTION_ARTIFACT_FAILED/);

  const encrypt = finalClosureMigrationScript.indexOf('encryptAndUploadDocumentObject({');
  const verify = finalClosureMigrationScript.indexOf(
    'const verified = await verifyEncryptedTarget'
  );
  const switchReferences = finalClosureMigrationScript.lastIndexOf(
    'for (const reference of item.live_references)'
  );
  const removePlaintext = finalClosureMigrationScript.indexOf(
    "storage.from('documents').remove([item.source_path])"
  );
  assert.ok(encrypt >= 0);
  assert.ok(verify > encrypt);
  assert.ok(switchReferences > verify);
  assert.ok(removePlaintext > switchReferences);
  assert.match(
    finalClosureMigrationScript,
    /sourceDeleted = true;\s+await confirmStorageObjectAbsent\(service, 'documents', item\.source_path\)/
  );
  assert.match(finalClosureMigrationScript, /\.list\(folder, \{/);
  assert.match(finalClosureMigrationScript, /entry\.name === fileName/);
  assert.doesNotMatch(finalClosureMigrationScript, /const absent = await service\.storage/);
});
