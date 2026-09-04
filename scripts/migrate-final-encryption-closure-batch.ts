import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';
import {
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '../src/lib/crypto/document-encryption/index.ts';

nextEnv.loadEnvConfig(process.cwd());

type LiveReference = {
  table: 'documentos' | 'document_versions' | 'document_certifications' | 'nom151_constancias_doc';
  row_id: string;
  field:
    | 'storage_path'
    | 'sealed_pdf_path'
    | 'source_storage_path'
    | 'certified_pdf_path'
    | 'provider_metadata';
  json_paths: string[];
};

type ManifestItem = {
  document_id: string;
  document_version_id: string;
  tenant_id: string;
  actor_user_id: string;
  source_bucket: 'documents';
  source_path: string;
  physical_sha256: string;
  byte_size: number;
  artifact_kind:
    | 'document'
    | 'visual_pdf'
    | 'signed_pdf'
    | 'certified_pdf'
    | 'constancia'
    | 'evidence'
    | 'preview'
    | 'attachment';
  target_encrypted_path: string;
  classification: 'ORPHAN_HISTORICAL_REQUIRED' | 'HISTORICAL_ENCRYPTION_REQUIRED';
  live_references: LiveReference[];
};

type ForensicReport = { migration_manifest: ManifestItem[] };

type MigrationResult = {
  migration_id: string;
  document_id: string;
  document_version_id: string;
  source_path: string;
  encrypted_path: string;
  artifact_kind: ManifestItem['artifact_kind'];
  classification: ManifestItem['classification'];
  plaintext_sha256: string;
  ciphertext_sha256: string;
  kms_provider: string;
  kms_key_version: string;
  references_switched: number;
  status: 'MIGRATED' | 'SKIP_ALREADY_ENCRYPTED';
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
    .update(`docubox.final-encryption-closure.v1\n${item.source_path}\n${item.physical_sha256}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function replaceExactStrings(value: unknown, source: string, target: string): [unknown, number] {
  if (value === source) return [target, 1];
  if (Array.isArray(value)) {
    let count = 0;
    const result = value.map((entry) => {
      const [next, replaced] = replaceExactStrings(entry, source, target);
      count += replaced;
      return next;
    });
    return [result, count];
  }
  if (value && typeof value === 'object') {
    let count = 0;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const [next, replaced] = replaceExactStrings(entry, source, target);
      result[key] = next;
      count += replaced;
    }
    return [result, count];
  }
  return [value, 0];
}

function containsExactString(value: unknown, needle: string): boolean {
  if (value === needle) return true;
  if (Array.isArray(value)) return value.some((entry) => containsExactString(entry, needle));
  return Boolean(
    value &&
    typeof value === 'object' &&
    Object.values(value).some((entry) => containsExactString(entry, needle))
  );
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
  const result = await service.from('organization_audit_events').insert({
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
  if (result.error) throw result.error;
}

async function completedMigration(service: SupabaseClient, id: string) {
  const result = await service
    .from('organization_audit_events')
    .select('payload')
    .eq('correlation_id', id)
    .eq('event_type', 'FINAL_ENCRYPTION_ARTIFACT_COMPLETED')
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data?.payload as MigrationResult | undefined;
}

async function validateBinding(service: SupabaseClient, item: ManifestItem) {
  if (!/^[0-9a-f]{64}$/i.test(item.physical_sha256)) {
    throw new Error('PHYSICAL_SHA256_INVALID');
  }
  if (!item.live_references.length) throw new Error('LIVE_REFERENCE_REQUIRED');
  const [document, version] = await Promise.all([
    service
      .from('documentos')
      .select('id,owner_id,workspace_id,legal_hold')
      .eq('id', item.document_id)
      .eq('workspace_id', item.tenant_id)
      .maybeSingle(),
    service
      .from('document_versions')
      .select('id,document_id,workspace_id')
      .eq('id', item.document_version_id)
      .eq('document_id', item.document_id)
      .eq('workspace_id', item.tenant_id)
      .maybeSingle(),
  ]);
  if (document.error || !document.data) throw document.error || new Error('DOCUMENT_NOT_FOUND');
  if (version.error || !version.data) throw version.error || new Error('DOCUMENT_VERSION_INVALID');
  if (document.data.owner_id !== item.actor_user_id) throw new Error('DOCUMENT_OWNER_MISMATCH');
}

async function referenceValue(service: SupabaseClient, reference: LiveReference) {
  const result = await service
    .from(reference.table)
    .select(reference.field)
    .eq('id', reference.row_id)
    .maybeSingle();
  if (result.error || !result.data) {
    throw result.error || new Error('REFERENCE_ROW_MISSING');
  }
  return (result.data as Record<string, unknown>)[reference.field];
}

async function assertReferences(service: SupabaseClient, item: ManifestItem, expectedPath: string) {
  for (const reference of item.live_references) {
    const value = await referenceValue(service, reference);
    const valid =
      reference.field === 'provider_metadata'
        ? containsExactString(value, expectedPath)
        : value === expectedPath;
    if (!valid) throw new Error('REFERENCE_STATE_MISMATCH');
  }
}

async function switchReference(
  service: SupabaseClient,
  reference: LiveReference,
  source: string,
  target: string
) {
  if (reference.field === 'provider_metadata') {
    const current = await referenceValue(service, reference);
    if (containsExactString(current, target) && !containsExactString(current, source)) return false;
    const [next, count] = replaceExactStrings(current, source, target);
    if (!count) throw new Error('PROVIDER_METADATA_REFERENCE_NOT_FOUND');
    const updated = await service
      .from(reference.table)
      .update({ provider_metadata: next })
      .eq('id', reference.row_id)
      .select('id')
      .maybeSingle();
    if (updated.error || !updated.data) {
      throw updated.error || new Error('PROVIDER_METADATA_SWITCH_FAILED');
    }
    return true;
  }
  const current = await referenceValue(service, reference);
  if (current === target) return false;
  if (current !== source) throw new Error('REFERENCE_COMPARE_AND_SET_CONFLICT');
  const updated = await service
    .from(reference.table)
    .update({ [reference.field]: target })
    .eq('id', reference.row_id)
    .eq(reference.field, source)
    .select('id')
    .maybeSingle();
  if (updated.error || !updated.data) {
    throw updated.error || new Error('REFERENCE_SWITCH_FAILED');
  }
  return true;
}

async function removeNewTarget(service: SupabaseClient, path: string, metadataId: string) {
  if (metadataId) {
    const metadata = await service
      .from('document_encryption_metadata')
      .delete()
      .eq('id', metadataId)
      .eq('storage_path', path);
    if (metadata.error) throw metadata.error;
  }
  const removed = await service.storage.from('documents').remove([path]);
  if (removed.error) throw removed.error;
}

async function confirmStorageObjectAbsent(service: SupabaseClient, bucket: string, path: string) {
  const separator = path.lastIndexOf('/');
  const folder = separator >= 0 ? path.slice(0, separator) : '';
  const fileName = separator >= 0 ? path.slice(separator + 1) : path;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const listed = await service.storage.from(bucket).list(folder, {
      limit: 100,
      search: fileName,
    });
    if (listed.error) throw listed.error;
    if (!(listed.data || []).some((entry) => entry.name === fileName)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
  }
  throw new Error('PLAINTEXT_SOURCE_DELETE_NOT_CONFIRMED');
}

async function verifyEncryptedTarget(service: SupabaseClient, item: ManifestItem) {
  const metadata = await service
    .from('document_encryption_metadata')
    .select('id,ciphertext_sha256,kms_provider,kms_key_version')
    .eq('storage_bucket', 'documents')
    .eq('storage_path', item.target_encrypted_path)
    .eq('status', 'active')
    .maybeSingle();
  if (metadata.error || !metadata.data) {
    throw metadata.error || new Error('ENCRYPTION_METADATA_MISSING');
  }
  const stored = await service.storage.from('documents').download(item.target_encrypted_path);
  if (stored.error || !stored.data) throw new Error('CIPHERTEXT_MISSING');
  const ciphertext = Buffer.from(await stored.data.arrayBuffer());
  const ciphertextSha256 = sha256(ciphertext);
  const ciphertextValid =
    !isPdf(ciphertext) && ciphertextSha256 === metadata.data.ciphertext_sha256;
  ciphertext.fill(0);
  if (!ciphertextValid) throw new Error('CIPHERTEXT_VERIFICATION_FAILED');
  const decrypted = await readDocumentStorageObject({
    service,
    storageBucket: 'documents',
    storagePath: item.target_encrypted_path,
    expectedPlaintextSha256: item.physical_sha256,
    userId: item.actor_user_id,
    requestId: `final-encryption:${migrationId(item)}:verify`,
  });
  const plaintextSha256 = sha256(decrypted.plaintext);
  const plaintextSize = decrypted.plaintext.byteLength;
  decrypted.plaintext.fill(0);
  if (plaintextSha256 !== item.physical_sha256 || plaintextSize !== item.byte_size) {
    throw new Error('DECRYPT_VERIFICATION_FAILED');
  }
  return {
    metadataId: metadata.data.id,
    ciphertextSha256,
    kmsProvider: metadata.data.kms_provider,
    kmsKeyVersion: metadata.data.kms_key_version,
  };
}

async function migrateOne(service: SupabaseClient, item: ManifestItem) {
  await validateBinding(service, item);
  const id = migrationId(item);
  const completed = await completedMigration(service, id);
  if (completed) {
    await assertReferences(service, item, item.target_encrypted_path);
    await verifyEncryptedTarget(service, item);
    return { ...completed, status: 'SKIP_ALREADY_ENCRYPTED' as const };
  }

  let metadataId = '';
  let createdTarget = false;
  let sourceDeleted = false;
  const switchedReferences: LiveReference[] = [];
  try {
    await appendAudit(
      service,
      item,
      id,
      item.classification,
      'Artefacto clasificado para conservacion cifrada con binding exacto.',
      { classification: item.classification, physical_sha256: item.physical_sha256 }
    );
    await appendAudit(
      service,
      item,
      id,
      'FINAL_ENCRYPTION_ARTIFACT_STARTED',
      'Inicio de cifrado de artefacto historico.',
      { source_path: item.source_path, artifact_kind: item.artifact_kind }
    );

    const source = await service.storage.from('documents').download(item.source_path);
    const sourceExists = !source.error && Boolean(source.data);
    const referencesAlreadySwitched = await Promise.all(
      item.live_references.map(async (reference) => {
        const value = await referenceValue(service, reference);
        return reference.field === 'provider_metadata'
          ? containsExactString(value, item.target_encrypted_path)
          : value === item.target_encrypted_path;
      })
    );
    if (!sourceExists && !referencesAlreadySwitched.every(Boolean)) {
      throw new Error('SOURCE_MISSING_BEFORE_REFERENCE_SWITCH');
    }

    if (source.data) {
      const plaintext = Buffer.from(await source.data.arrayBuffer());
      const validSource =
        isPdf(plaintext) &&
        plaintext.byteLength === item.byte_size &&
        sha256(plaintext) === item.physical_sha256;
      if (!validSource) {
        plaintext.fill(0);
        throw new Error('SOURCE_PHYSICAL_VERIFICATION_FAILED');
      }
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
        requestId: `final-encryption:${id}:encrypt`,
      });
      plaintext.fill(0);
      metadataId = String(encrypted.metadataId || '');
      createdTarget = !encrypted.alreadyExisted;
    }

    const verified = await verifyEncryptedTarget(service, item);
    metadataId ||= verified.metadataId;
    await appendAudit(
      service,
      item,
      id,
      'FINAL_ENCRYPTION_CIPHERTEXT_VERIFIED',
      'Ciphertext y decrypt historicos verificados.',
      {
        plaintext_sha256: item.physical_sha256,
        ciphertext_sha256: verified.ciphertextSha256,
        kms_provider: verified.kmsProvider,
        kms_key_version: verified.kmsKeyVersion,
      }
    );

    for (const reference of item.live_references) {
      const switched = await switchReference(
        service,
        reference,
        item.source_path,
        item.target_encrypted_path
      );
      if (switched) switchedReferences.push(reference);
    }
    await assertReferences(service, item, item.target_encrypted_path);
    await appendAudit(
      service,
      item,
      id,
      'FINAL_ENCRYPTION_REFERENCES_SWITCHED',
      'Referencias historicas conmutadas al ciphertext.',
      { references_switched: item.live_references.length }
    );

    if (sourceExists) {
      const removed = await service.storage.from('documents').remove([item.source_path]);
      if (removed.error) throw removed.error;
      // Once Storage accepts the removal, rollback must never delete the verified
      // ciphertext or restore a reference to a plaintext path that may be gone.
      sourceDeleted = true;
      await confirmStorageObjectAbsent(service, 'documents', item.source_path);
    } else {
      sourceDeleted = true;
    }
    await appendAudit(
      service,
      item,
      id,
      'FINAL_ENCRYPTION_PLAINTEXT_REMOVED',
      'Plaintext historico retirado despues de verificar todas las compuertas.',
      { source_deleted: true }
    );

    const result: MigrationResult = {
      migration_id: id,
      document_id: item.document_id,
      document_version_id: item.document_version_id,
      source_path: item.source_path,
      encrypted_path: item.target_encrypted_path,
      artifact_kind: item.artifact_kind,
      classification: item.classification,
      plaintext_sha256: item.physical_sha256,
      ciphertext_sha256: verified.ciphertextSha256,
      kms_provider: verified.kmsProvider,
      kms_key_version: verified.kmsKeyVersion,
      references_switched: item.live_references.length,
      status: 'MIGRATED',
    };
    await appendAudit(
      service,
      item,
      id,
      'FINAL_ENCRYPTION_ARTIFACT_COMPLETED',
      'Cifrado historico completado.',
      result
    );
    return result;
  } catch (error) {
    if (!sourceDeleted) {
      for (const reference of switchedReferences.reverse()) {
        try {
          await switchReference(service, reference, item.target_encrypted_path, item.source_path);
        } catch {
          // The failure is recorded below and the source remains available.
        }
      }
      if (createdTarget) {
        try {
          await removeNewTarget(service, item.target_encrypted_path, metadataId);
        } catch {
          // A verified orphan ciphertext is safer than deleting the source on rollback failure.
        }
      }
    }
    try {
      await appendAudit(
        service,
        item,
        id,
        'FINAL_ENCRYPTION_ARTIFACT_FAILED',
        'Fallo cerrado durante el cifrado historico.',
        { failure_code: error instanceof Error ? error.message : 'UNKNOWN_FAILURE' },
        'failed'
      );
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

const manifestPath = resolve(requiredOption('manifest'));
const outputPath = resolve(requiredOption('batch-output'));
const offset = Math.max(0, Number(option('offset') || 0));
const limit = Math.min(3, Math.max(1, Number(option('limit') || 3)));
const execute = process.argv.includes('--execute');
const forensic = JSON.parse(await readFile(manifestPath, 'utf8')) as ForensicReport;
const items = forensic.migration_manifest.slice(offset, offset + limit);
const invalid = items.find(
  (item) =>
    !item.document_id ||
    !item.document_version_id ||
    !item.tenant_id ||
    !item.actor_user_id ||
    !item.target_encrypted_path ||
    !item.live_references.length
);
if (invalid) throw new Error('MIGRATION_MANIFEST_ITEM_INVALID');

const service = createClient(
  requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
  requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const results: Array<
  | MigrationResult
  | { status: 'DRY_RUN'; source_path: string }
  | { status: 'FAILED'; source_path: string; reason: string }
> = [];
let failed = false;
for (const item of items) {
  if (!execute) {
    await validateBinding(service, item);
    await assertReferences(service, item, item.source_path);
    results.push({ status: 'DRY_RUN', source_path: item.source_path });
    continue;
  }
  try {
    results.push(await migrateOne(service, item));
  } catch (error) {
    failed = true;
    results.push({
      status: 'FAILED',
      source_path: item.source_path,
      reason: error instanceof Error ? error.message : 'UNKNOWN_FAILURE',
    });
    break;
  }
}

const report = {
  generated_at: new Date().toISOString(),
  execute,
  manifest: manifestPath,
  offset,
  limit,
  attempted: results.length,
  migrated: results.filter((result) => result.status === 'MIGRATED').length,
  skipped: results.filter((result) => result.status === 'SKIP_ALREADY_ENCRYPTED').length,
  failed: results.filter((result) => result.status === 'FAILED').length,
  result: failed ? 'FAIL' : 'PASS',
  objects: results,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.info(JSON.stringify(report, null, 2));
if (failed) process.exitCode = 1;
