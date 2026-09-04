import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import nextEnv from '@next/env';
import {
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '../src/lib/crypto/document-encryption/index.ts';
import {
  InternalSourceError,
  resolveInternalDocumentSource,
} from '../src/lib/documents/internal-source.ts';

nextEnv.loadEnvConfig(process.cwd());

type ManifestItem = {
  document_id: string;
  document_version_id: string;
  tenant_id: string;
  actor_user_id: string;
  source_bucket: 'documents';
  source_path: string;
  physical_sha256: string;
  registered_sha256: string;
  byte_size: number;
  artifact_kind: 'document' | 'visual_pdf' | 'signed_pdf';
  target_encrypted_path: string;
  status: 'MIGRATION_ELIGIBLE';
  pointer_sources: Array<'documentos' | 'document_versions'>;
};

type Inventory = {
  mode: string;
  migration_manifest: ManifestItem[];
};

type MigrationState = {
  migration_id: string;
  document_id: string;
  document_version_id: string;
  source_path: string;
  encrypted_path: string;
  artifact_kind: ManifestItem['artifact_kind'];
  plaintext_sha256: string;
  ciphertext_sha256: string;
  kms_provider: string;
  kms_key_version: string;
  result: string;
};

type EncryptedMetadata = {
  id?: string;
  ciphertext_sha256: string;
  kms_provider: string;
  kms_key_version: string;
  [key: string]: unknown;
};

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function requiredOption(name: string) {
  const value = option(name)?.trim();
  if (!value) throw new Error(`${name.toUpperCase()}_REQUIRED`);
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes).subarray(0, 5).toString('ascii') === '%PDF-';
}

function migrationId(item: ManifestItem) {
  const hex = createHash('sha256')
    .update(
      `docubox.legacy-encryption.v1\n${item.document_id}\n${item.document_version_id}\n${item.artifact_kind}\n${item.source_path}\n${item.physical_sha256}`
    )
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

async function appendAudit(
  service: SupabaseClient,
  item: ManifestItem,
  id: string,
  eventType: string,
  summary: string,
  payload: Record<string, unknown>,
  outcome: 'success' | 'failed' = 'success'
) {
  const inserted = await service.from('organization_audit_events').insert({
    workspace_id: item.tenant_id,
    actor_user_id: item.actor_user_id,
    event_type: eventType,
    resource_type: 'document',
    resource_id: item.document_id,
    summary,
    payload: { migration_id: id, ...payload },
    outcome,
    severity: outcome === 'failed' ? 'high' : 'info',
    module: 'document-encryption',
    origin: 'system',
    correlation_id: id,
    evidence_refs: [],
  });
  if (inserted.error) throw inserted.error;
}

async function completedMigration(service: SupabaseClient, id: string) {
  const result = await service
    .from('organization_audit_events')
    .select('id,payload')
    .eq('correlation_id', id)
    .eq('event_type', 'LEGACY_ENCRYPTION_COMPLETED')
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function validateAssociations(service: SupabaseClient, item: ManifestItem) {
  if (
    !/^[0-9a-f]{64}$/i.test(item.physical_sha256) ||
    item.physical_sha256.toLowerCase() !== item.registered_sha256.toLowerCase()
  ) {
    throw new Error('MIGRATION_REGISTERED_SHA256_INVALID');
  }
  if (item.pointer_sources.length !== 1) {
    throw new Error('MIGRATION_POINTER_ASSOCIATION_AMBIGUOUS');
  }

  const [document, version, membership] = await Promise.all([
    service
      .from('documentos')
      .select(
        'id,owner_id,workspace_id,storage_path,sealed_pdf_path,file_hash_sha256,sealed_pdf_hash,deleted_at'
      )
      .eq('id', item.document_id)
      .eq('workspace_id', item.tenant_id)
      .is('deleted_at', null)
      .maybeSingle(),
    service
      .from('document_versions')
      .select('id,document_id,workspace_id,storage_path,sha256')
      .eq('id', item.document_version_id)
      .eq('document_id', item.document_id)
      .eq('workspace_id', item.tenant_id)
      .maybeSingle(),
    service
      .from('workspace_members')
      .select('status')
      .eq('workspace_id', item.tenant_id)
      .eq('user_id', item.actor_user_id)
      .eq('status', 'active')
      .maybeSingle(),
  ]);
  if (document.error || !document.data) throw document.error || new Error('DOCUMENT_NOT_FOUND');
  if (version.error || !version.data) throw version.error || new Error('DOCUMENT_VERSION_INVALID');
  if (membership.error || !membership.data) {
    throw membership.error || new Error('ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  if (document.data.owner_id !== item.actor_user_id) throw new Error('DOCUMENT_OWNER_MISMATCH');

  const pointerSource = item.pointer_sources[0];
  const currentPath =
    pointerSource === 'document_versions'
      ? version.data.storage_path
      : item.artifact_kind === 'signed_pdf'
        ? document.data.sealed_pdf_path
        : document.data.storage_path;
  const expectedHash =
    pointerSource === 'document_versions'
      ? version.data.sha256
      : item.artifact_kind === 'signed_pdf'
        ? document.data.sealed_pdf_hash
        : document.data.file_hash_sha256;
  if (String(expectedHash || '').toLowerCase() !== item.physical_sha256.toLowerCase()) {
    throw new Error('ACTIVE_POINTER_SHA256_MISMATCH');
  }
  if (currentPath !== item.source_path && currentPath !== item.target_encrypted_path) {
    throw new Error('ACTIVE_POINTER_CONFLICT');
  }
  return { pointerSource, currentPath };
}

async function switchPointer(service: SupabaseClient, item: ManifestItem) {
  if (item.pointer_sources[0] === 'document_versions') {
    const switched = await service
      .from('document_versions')
      .update({ storage_path: item.target_encrypted_path })
      .eq('id', item.document_version_id)
      .eq('document_id', item.document_id)
      .eq('workspace_id', item.tenant_id)
      .eq('storage_path', item.source_path)
      .select('id')
      .maybeSingle();
    if (switched.error || !switched.data) {
      throw switched.error || new Error('MIGRATION_POINTER_SWITCH_CONFLICT');
    }
    return;
  }
  const field = item.artifact_kind === 'signed_pdf' ? 'sealed_pdf_path' : 'storage_path';
  const switched = await service
    .from('documentos')
    .update({ [field]: item.target_encrypted_path })
    .eq('id', item.document_id)
    .eq('workspace_id', item.tenant_id)
    .eq(field, item.source_path)
    .select('id')
    .maybeSingle();
  if (switched.error || !switched.data) {
    throw switched.error || new Error('MIGRATION_POINTER_SWITCH_CONFLICT');
  }
}

async function rollbackPointer(service: SupabaseClient, item: ManifestItem) {
  if (item.pointer_sources[0] === 'document_versions') {
    return service
      .from('document_versions')
      .update({ storage_path: item.source_path })
      .eq('id', item.document_version_id)
      .eq('storage_path', item.target_encrypted_path)
      .select('id')
      .maybeSingle();
  }
  const field = item.artifact_kind === 'signed_pdf' ? 'sealed_pdf_path' : 'storage_path';
  return service
    .from('documentos')
    .update({ [field]: item.source_path })
    .eq('id', item.document_id)
    .eq(field, item.target_encrypted_path)
    .select('id')
    .maybeSingle();
}

async function verifyApplicationAccess(
  service: SupabaseClient,
  item: ManifestItem,
  id: string,
  actor: User
) {
  const variant =
    item.artifact_kind === 'signed_pdf'
      ? 'certified'
      : item.artifact_kind === 'visual_pdf'
        ? 'version'
        : 'original';
  const source = await resolveInternalDocumentSource(service, actor, {
    workspaceId: item.tenant_id,
    documentId: item.document_id,
    versionId: variant === 'version' ? item.document_version_id : null,
    variant,
  });
  if (
    source.storagePath !== item.target_encrypted_path ||
    source.sha256.toLowerCase() !== item.physical_sha256.toLowerCase()
  ) {
    throw new Error('APPLICATION_POINTER_OR_SHA256_MISMATCH');
  }

  for (const accessEvent of ['DOCUMENT_VIEWED', 'DOCUMENT_DOWNLOADED'] as const) {
    const delivered = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath: source.storagePath,
      expectedPlaintextSha256: item.physical_sha256,
      userId: actor.id,
      requestId: `legacy-migration:${id}:${accessEvent.toLowerCase()}`,
      accessEvent,
    });
    const deliveredSha256 = sha256(delivered.plaintext);
    delivered.plaintext.fill(0);
    if (deliveredSha256 !== item.physical_sha256) {
      throw new Error('APPLICATION_DOWNLOAD_SHA256_MISMATCH');
    }
  }

  const unauthorized = {
    ...actor,
    id: '00000000-0000-4000-8000-000000000001',
    email: 'unauthorized-migration-probe@invalid.docubox',
  } satisfies User;
  let denied = false;
  try {
    await resolveInternalDocumentSource(service, unauthorized, {
      workspaceId: item.tenant_id,
      documentId: item.document_id,
      versionId: variant === 'version' ? item.document_version_id : null,
      variant,
    });
  } catch (error) {
    denied = error instanceof InternalSourceError && [403, 404].includes(error.status);
  }
  if (!denied) throw new Error('UNAUTHORIZED_APPLICATION_ACCESS_NOT_DENIED');

  let wrongTenantDenied = false;
  try {
    await resolveInternalDocumentSource(service, actor, {
      workspaceId: '00000000-0000-4000-8000-000000000002',
      documentId: item.document_id,
      versionId: variant === 'version' ? item.document_version_id : null,
      variant,
    });
  } catch (error) {
    wrongTenantDenied = error instanceof InternalSourceError && [403, 404].includes(error.status);
  }
  if (!wrongTenantDenied) throw new Error('WRONG_TENANT_APPLICATION_ACCESS_NOT_DENIED');
}

async function removeNewTarget(service: SupabaseClient, item: ManifestItem, metadataId: string) {
  const metadata = await service
    .from('document_encryption_metadata')
    .delete()
    .eq('id', metadataId)
    .eq('storage_path', item.target_encrypted_path);
  if (metadata.error) throw metadata.error;
  const removed = await service.storage.from('documents').remove([item.target_encrypted_path]);
  if (removed.error) throw removed.error;
}

async function migrateOne(service: SupabaseClient, item: ManifestItem) {
  const id = migrationId(item);
  const alreadyCompleted = await completedMigration(service, id);
  if (alreadyCompleted) {
    const association = await validateAssociations(service, item);
    if (association.currentPath !== item.target_encrypted_path) {
      throw new Error('COMPLETED_MIGRATION_POINTER_MISMATCH');
    }
    const actorResult = await service.auth.admin.getUserById(item.actor_user_id);
    if (actorResult.error || !actorResult.data.user) {
      throw actorResult.error || new Error('MIGRATION_ACTOR_NOT_FOUND');
    }
    await verifyApplicationAccess(service, item, id, actorResult.data.user);
    return {
      ...(alreadyCompleted.payload as MigrationState),
      status: 'SKIP_ALREADY_ENCRYPTED',
      application_revalidated: true,
    };
  }

  const association = await validateAssociations(service, item);
  const pointerAlreadySwitched = association.currentPath === item.target_encrypted_path;
  let metadataId = '';
  let createdTarget = false;
  let switched = pointerAlreadySwitched;
  let sourceDeleted = false;
  let plaintext: Buffer | null = null;
  try {
    await appendAudit(
      service,
      item,
      id,
      'LEGACY_ENCRYPTION_STARTED',
      'Inicio de migracion legacy.',
      {
        document_id: item.document_id,
        document_version_id: item.document_version_id,
        source_path: item.source_path,
        encrypted_path: item.target_encrypted_path,
        artifact_kind: item.artifact_kind,
      }
    );

    const sourceObject = await service.storage.from('documents').download(item.source_path);
    const sourceExists = !sourceObject.error && Boolean(sourceObject.data);
    if (sourceExists) {
      plaintext = Buffer.from(await sourceObject.data!.arrayBuffer());
      if (
        !isPdf(plaintext) ||
        plaintext.byteLength !== item.byte_size ||
        sha256(plaintext) !== item.physical_sha256
      ) {
        throw new Error('LEGACY_SOURCE_PHYSICAL_VERIFICATION_FAILED');
      }
      await appendAudit(
        service,
        item,
        id,
        'LEGACY_SOURCE_VERIFIED',
        'Plaintext legacy verificado fisicamente.',
        { plaintext_sha256: item.physical_sha256, byte_size: plaintext.byteLength }
      );
    } else if (!pointerAlreadySwitched) {
      throw new Error('LEGACY_SOURCE_MISSING');
    }

    let encryptedMetadata: EncryptedMetadata;
    if (plaintext) {
      const encrypted = await encryptAndUploadDocumentObject({
        service,
        plaintext,
        tenantId: item.tenant_id,
        documentId: item.document_id,
        documentVersionId: item.document_version_id,
        artifactKind: item.artifact_kind,
        storageBucket: 'documents',
        storagePath: item.target_encrypted_path,
        originalMimeType: 'application/pdf',
        userId: item.actor_user_id,
        requestId: `legacy-migration:${id}:encrypt`,
      });
      encryptedMetadata = encrypted.metadata as unknown as EncryptedMetadata;
      metadataId = String(encrypted.metadataId || '');
      createdTarget = !encrypted.alreadyExisted;
    } else {
      const metadata = await service
        .from('document_encryption_metadata')
        .select('*')
        .eq('storage_bucket', 'documents')
        .eq('storage_path', item.target_encrypted_path)
        .eq('status', 'active')
        .maybeSingle();
      if (metadata.error || !metadata.data) {
        throw metadata.error || new Error('MIGRATION_TARGET_METADATA_MISSING');
      }
      encryptedMetadata = metadata.data as unknown as EncryptedMetadata;
      metadataId = metadata.data.id;
    }

    const stored = await service.storage.from('documents').download(item.target_encrypted_path);
    if (stored.error || !stored.data) throw new Error('MIGRATION_CIPHERTEXT_MISSING');
    const ciphertext = Buffer.from(await stored.data.arrayBuffer());
    const ciphertextSha256 = sha256(ciphertext);
    const ciphertextValid =
      !isPdf(ciphertext) && ciphertextSha256 === encryptedMetadata.ciphertext_sha256;
    ciphertext.fill(0);
    if (!ciphertextValid) throw new Error('MIGRATION_CIPHERTEXT_VERIFICATION_FAILED');
    await appendAudit(
      service,
      item,
      id,
      'LEGACY_CIPHERTEXT_CREATED',
      'Ciphertext legacy creado y verificado.',
      {
        plaintext_sha256: item.physical_sha256,
        ciphertext_sha256: ciphertextSha256,
        kms_provider: encryptedMetadata.kms_provider,
        kms_key_version: encryptedMetadata.kms_key_version,
      }
    );

    const decrypted = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath: item.target_encrypted_path,
      expectedPlaintextSha256: item.physical_sha256,
      userId: item.actor_user_id,
      requestId: `legacy-migration:${id}:decrypt-verify`,
    });
    const decryptedSha256 = sha256(decrypted.plaintext);
    const decryptedSize = decrypted.plaintext.byteLength;
    decrypted.plaintext.fill(0);
    if (decryptedSha256 !== item.physical_sha256 || decryptedSize !== item.byte_size) {
      throw new Error('MIGRATION_DECRYPT_VERIFICATION_FAILED');
    }
    await appendAudit(
      service,
      item,
      id,
      'LEGACY_DECRYPT_VERIFIED',
      'Decrypt y SHA-256 legacy verificados.',
      { plaintext_sha256: decryptedSha256, byte_size: decryptedSize }
    );

    if (!pointerAlreadySwitched) {
      await switchPointer(service, item);
      switched = true;
      await appendAudit(
        service,
        item,
        id,
        'LEGACY_POINTER_SWITCHED',
        'Puntero documental conmutado al objeto cifrado.',
        { source_path: item.source_path, encrypted_path: item.target_encrypted_path }
      );
    }

    const actorResult = await service.auth.admin.getUserById(item.actor_user_id);
    if (actorResult.error || !actorResult.data.user) {
      throw actorResult.error || new Error('MIGRATION_ACTOR_NOT_FOUND');
    }
    await verifyApplicationAccess(service, item, id, actorResult.data.user);
    await appendAudit(
      service,
      item,
      id,
      'LEGACY_APPLICATION_VERIFIED',
      'Preview, descarga y autorizacion verificados por los servicios existentes.',
      { authorized_preview: true, authorized_download: true, unauthorized_access_denied: true }
    );

    if (sourceExists) {
      const removed = await service.storage.from('documents').remove([item.source_path]);
      if (removed.error) throw removed.error;
      sourceDeleted = true;
      await appendAudit(
        service,
        item,
        id,
        'LEGACY_SOURCE_DELETED',
        'Plaintext legacy retirado despues de todas las validaciones.',
        { source_path: item.source_path, source_deleted: true }
      );
    } else {
      sourceDeleted = true;
    }

    const state: MigrationState = {
      migration_id: id,
      document_id: item.document_id,
      document_version_id: item.document_version_id,
      source_path: item.source_path,
      encrypted_path: item.target_encrypted_path,
      artifact_kind: item.artifact_kind,
      plaintext_sha256: item.physical_sha256,
      ciphertext_sha256: ciphertextSha256,
      kms_provider: encryptedMetadata.kms_provider,
      kms_key_version: encryptedMetadata.kms_key_version,
      result: 'MIGRATED',
    };
    await appendAudit(
      service,
      item,
      id,
      'LEGACY_ENCRYPTION_COMPLETED',
      'Migracion legacy completada.',
      state
    );
    return { ...state, status: 'MIGRATED' };
  } catch (error) {
    let rollbackCode: string | null = null;
    if (switched && !sourceDeleted) {
      const rollback = await rollbackPointer(service, item);
      if (rollback.error || !rollback.data) {
        rollbackCode = rollback.error?.code || 'MIGRATION_POINTER_ROLLBACK_FAILED';
      } else if (createdTarget && metadataId) {
        try {
          await removeNewTarget(service, item, metadataId);
        } catch (cleanupError) {
          rollbackCode =
            cleanupError instanceof Error
              ? cleanupError.message
              : 'MIGRATION_TARGET_CLEANUP_FAILED';
        }
      }
    } else if (!switched && createdTarget && metadataId) {
      try {
        await removeNewTarget(service, item, metadataId);
      } catch (cleanupError) {
        rollbackCode =
          cleanupError instanceof Error ? cleanupError.message : 'MIGRATION_TARGET_CLEANUP_FAILED';
      }
    }
    await appendAudit(
      service,
      item,
      id,
      'LEGACY_ENCRYPTION_FAILED',
      'La migracion legacy fallo y se detuvo el lote.',
      {
        failure_code: error instanceof Error ? error.message : 'LEGACY_ENCRYPTION_FAILED',
        rollback_code: rollbackCode,
        source_preserved: !sourceDeleted,
      },
      'failed'
    ).catch(() => undefined);
    const code = error instanceof Error ? error.message : 'LEGACY_ENCRYPTION_FAILED';
    throw new Error(rollbackCode ? `${code}:${rollbackCode}` : code);
  } finally {
    plaintext?.fill(0);
  }
}

const manifestPath = resolve(requiredOption('manifest'));
const batchOutputPath = resolve(requiredOption('batch-output'));
const execute = process.argv.includes('--execute');
const offset = Math.max(0, Number(option('offset') || 0));
const limit = Math.min(3, Math.max(1, Number(option('limit') || 3)));
const inventory = JSON.parse(await readFile(manifestPath, 'utf8')) as Inventory;
if (inventory.mode !== 'READ_ONLY_PHYSICAL_INVENTORY') {
  throw new Error('MIGRATION_MANIFEST_MODE_INVALID');
}
const selected = inventory.migration_manifest.slice(offset, offset + limit);
if (!selected.length) throw new Error('MIGRATION_BATCH_EMPTY');

const service = createClient(
  requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
  requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const results: Array<Record<string, unknown>> = [];
let failed = false;
for (const item of selected) {
  if (!execute) {
    results.push({
      migration_id: migrationId(item),
      document_id: item.document_id,
      document_version_id: item.document_version_id,
      artifact_kind: item.artifact_kind,
      source_path: item.source_path,
      encrypted_path: item.target_encrypted_path,
      status: 'WOULD_MIGRATE',
    });
    continue;
  }
  try {
    results.push(await migrateOne(service, item));
  } catch (error) {
    results.push({
      migration_id: migrationId(item),
      document_id: item.document_id,
      artifact_kind: item.artifact_kind,
      status: 'FAILED',
      reason: error instanceof Error ? error.message : 'LEGACY_ENCRYPTION_FAILED',
    });
    failed = true;
    break;
  }
}

const batchReport = {
  generated_at: new Date().toISOString(),
  execute,
  manifest: manifestPath,
  offset,
  limit,
  attempted: results.length,
  migrated: results.filter((result) => result.status === 'MIGRATED').length,
  skipped: results.filter((result) => String(result.status).startsWith('SKIP_')).length,
  failed: results.filter((result) => result.status === 'FAILED').length,
  result: failed ? 'FAIL' : 'PASS',
  objects: results,
};
await mkdir(dirname(batchOutputPath), { recursive: true });
await writeFile(batchOutputPath, `${JSON.stringify(batchReport, null, 2)}\n`, 'utf8');
console.info(JSON.stringify(batchReport, null, 2));
if (failed) process.exitCode = 1;
