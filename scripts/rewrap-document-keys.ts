import { createClient } from '@supabase/supabase-js';
import { DocumentEncryptionService } from '../src/lib/crypto/document-encryption/document-encryption.service.ts';
import { GoogleCloudDocumentKeyProvider } from '../src/lib/crypto/document-encryption/kms/google-kms.ts';

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function provider(keyResource: string) {
  return new GoogleCloudDocumentKeyProvider({
    projectId: env('GCP_PROJECT_ID'),
    serviceAccountEmail: env('GCP_SERVICE_ACCOUNT_EMAIL'),
    keyResource,
    requiredProtectionLevel: (process.env.DOCUMENT_ENCRYPTION_KMS_PROTECTION_LEVEL || 'hsm') as
      'hsm' | 'software' | 'any',
    timeoutMs: Number(process.env.DOCUMENT_ENCRYPTION_KMS_TIMEOUT_MS || 10_000),
  });
}

const dryRun = process.argv.includes('--dry-run');
const limit = Math.min(
  500,
  Math.max(1, Number(process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 100))
);
const oldProvider = provider(env('DOCUMENT_ENCRYPTION_OLD_KMS_KEY_RESOURCE'));
const newProvider = provider(env('DOCUMENT_ENCRYPTION_NEW_KMS_KEY_RESOURCE'));
const rewrapper = new DocumentEncryptionService(oldProvider);
const service = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = await service
  .from('document_encryption_metadata')
  .select('*')
  .eq('status', 'active')
  .eq('kms_key_id', env('DOCUMENT_ENCRYPTION_OLD_KMS_KEY_RESOURCE'))
  .order('id', { ascending: true })
  .limit(limit);
if (rows.error) throw rows.error;

const results = [];
for (const metadata of rows.data || []) {
  if (dryRun) {
    results.push({ id: metadata.id, status: 'WOULD_REWRAP' });
    continue;
  }
  try {
    const update = await rewrapper.rewrapDocumentKey({ metadata, newProvider });
    const persisted = await service
      .from('document_encryption_metadata')
      .update(update)
      .eq('id', metadata.id)
      .eq('wrapped_dek', metadata.wrapped_dek)
      .select('id')
      .maybeSingle();
    if (persisted.error || !persisted.data) throw persisted.error || new Error('REWRAP_CONFLICT');
    await service.from('document_encryption_security_events').insert({
      tenant_id: metadata.tenant_id,
      document_id: metadata.document_id,
      document_version_id: metadata.document_version_id,
      event_type: 'DOCUMENT_KEY_ROTATED',
      result: 'success',
      source: 'rewrap-document-keys',
      reason: null,
      metrics: {},
    });
    results.push({ id: metadata.id, status: 'REWRAPPED', key_version: update.kms_key_version });
  } catch (error) {
    results.push({
      id: metadata.id,
      status: 'FAILED',
      code: error instanceof Error ? error.message : 'REWRAP_FAILED',
    });
  }
}
console.info(JSON.stringify({ dry_run: dryRun, results }, null, 2));
