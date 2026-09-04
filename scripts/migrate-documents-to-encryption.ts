import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  encryptAndUploadDocumentObject,
  readDocumentStorageObject,
} from '../src/lib/crypto/document-encryption/index.ts';

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const dryRun = process.argv.includes('--dry-run');
const tenant = option('tenant');
const document = option('document');
const resume = option('resume');
const limit = Math.min(250, Math.max(1, Number(option('limit') || 25)));
const service = createClient(
  required('NEXT_PUBLIC_SUPABASE_URL'),
  required('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

let query = service
  .from('documentos')
  .select(
    'id,documento_id,owner_id,workspace_id,file_name,file_type,file_size,storage_path,file_hash_sha256'
  )
  .not('storage_path', 'is', null)
  .is('deleted_at', null)
  .order('id', { ascending: true })
  .limit(limit);
if (tenant) query = query.eq('workspace_id', tenant);
if (document) query = query.or(`id.eq.${document},documento_id.eq.${document}`);
if (resume) query = query.gt('id', resume);
const rows = await query;
if (rows.error) throw rows.error;

const report: Array<Record<string, unknown>> = [];
for (const row of rows.data || []) {
  const existingMetadata = await service
    .from('document_encryption_metadata')
    .select('id,plaintext_sha256')
    .eq('storage_bucket', 'documents')
    .eq('storage_path', row.storage_path)
    .eq('status', 'active')
    .maybeSingle();
  if (existingMetadata.error) throw existingMetadata.error;
  if (existingMetadata.data) {
    report.push({ document_id: row.id, status: 'ALREADY_ENCRYPTED' });
    continue;
  }
  if (!row.workspace_id || !/^[a-f0-9]{64}$/i.test(String(row.file_hash_sha256 || ''))) {
    report.push({ document_id: row.id, status: 'SKIPPED_INCOMPLETE_METADATA' });
    continue;
  }
  const source = await service.storage.from('documents').download(row.storage_path);
  if (source.error || !source.data) {
    report.push({ document_id: row.id, status: 'MISSING', code: source.error?.message || null });
    continue;
  }
  const plaintext = Buffer.from(await source.data.arrayBuffer());
  const plaintextSha256 = createHash('sha256').update(plaintext).digest('hex');
  if (plaintextSha256 !== row.file_hash_sha256.toLowerCase()) {
    plaintext.fill(0);
    report.push({ document_id: row.id, status: 'HASH_MISMATCH' });
    continue;
  }

  let version = await service
    .from('document_versions')
    .select('id,version_number')
    .eq('document_id', row.id)
    .eq('workspace_id', row.workspace_id)
    .order('version_number', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (version.error) throw version.error;
  let versionId = version.data?.id || randomUUID();
  const targetPath = `tenants/${row.workspace_id}/documents/${row.id}/versions/${versionId}/payload.enc`;
  if (dryRun) {
    plaintext.fill(0);
    report.push({
      document_id: row.id,
      status: 'WOULD_MIGRATE',
      source: row.storage_path,
      target: targetPath,
    });
    continue;
  }

  let createdVersion = false;
  if (!version.data) {
    const inserted = await service.from('document_versions').insert({
      id: versionId,
      workspace_id: row.workspace_id,
      document_id: row.id,
      version_number: 1,
      status: 'sent',
      storage_path: targetPath,
      mime_type: row.file_type || 'application/octet-stream',
      byte_size: plaintext.byteLength,
      sha256: plaintextSha256,
      change_reason: 'Version registrada durante migracion de cifrado',
      created_by: row.owner_id,
      frozen_at: new Date().toISOString(),
      metadata: { source: 'document_encryption_migration', schema_version: 1 },
    });
    if (inserted.error) throw inserted.error;
    createdVersion = true;
  }

  try {
    await encryptAndUploadDocumentObject({
      service,
      plaintext,
      tenantId: row.workspace_id,
      documentId: row.id,
      documentVersionId: versionId,
      artifactKind: 'document',
      storageBucket: 'documents',
      storagePath: targetPath,
      originalFileName: row.file_name,
      originalMimeType: row.file_type,
      userId: row.owner_id,
      requestId: `migration:${row.id}`,
    });
    const verified = await readDocumentStorageObject({
      service,
      storageBucket: 'documents',
      storagePath: targetPath,
      expectedPlaintextSha256: plaintextSha256,
      userId: row.owner_id,
      requestId: `migration-verify:${row.id}`,
    });
    const byteMatch = verified.plaintext.equals(plaintext);
    verified.plaintext.fill(0);
    if (!byteMatch) throw new Error('MIGRATION_BYTE_COMPARISON_FAILED');

    const switched = await service
      .from('documentos')
      .update({ storage_path: targetPath, file_url: `/api/documentos/${row.id}/viewer-file` })
      .eq('id', row.id)
      .eq('storage_path', row.storage_path)
      .select('id')
      .maybeSingle();
    if (switched.error || !switched.data)
      throw switched.error || new Error('MIGRATION_SWITCH_CONFLICT');
    if (version.data) {
      const versionSwitch = await service
        .from('document_versions')
        .update({ storage_path: targetPath, file_url: null })
        .eq('id', versionId)
        .eq('storage_path', row.storage_path);
      if (versionSwitch.error) throw versionSwitch.error;
    }
    if (row.storage_path !== targetPath) {
      const removed = await service.storage.from('documents').remove([row.storage_path]);
      if (removed.error) throw removed.error;
    }
    report.push({ document_id: row.id, status: 'MIGRATED', target: targetPath });
  } catch (error) {
    if (createdVersion) await service.from('document_versions').delete().eq('id', versionId);
    report.push({
      document_id: row.id,
      status: 'FAILED',
      code: error instanceof Error ? error.message : 'MIGRATION_FAILED',
    });
  } finally {
    plaintext.fill(0);
  }
}

console.info(
  JSON.stringify(
    { dry_run: dryRun, next_resume: rows.data?.at(-1)?.id || null, results: report },
    null,
    2
  )
);
