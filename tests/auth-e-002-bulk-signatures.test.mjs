import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914050356_auth_e_002_bulk_signature_runtime.sql'
);
const originalMigration = await read('../supabase/migrations/20260808030000_bulk_signatures.sql');
const runtime = await read('../src/lib/bulk-signatures/runtime.ts');
const processor = await read('../src/lib/orchestration/processor.ts');
const collectionRoute = await read('../src/app/api/bulk-signatures/route.ts');
const campaignRoute = await read('../src/app/api/bulk-signatures/[id]/route.ts');
const campaignList = await read('../src/app/firmas-masivas/page.tsx');
const campaignNew = await read('../src/app/firmas-masivas/nueva/page.tsx');
const campaignMonitor = await read('../src/app/firmas-masivas/[id]/page.tsx');

test('AUTH-E-002 extends the existing module without a parallel campaign model', () => {
  assert.match(originalMigration, /bulk_signature_campaigns/);
  assert.match(originalMigration, /bulk_campaign_items/);
  assert.match(originalMigration, /bulk_campaign_jobs/);
  assert.doesNotMatch(migration, /CREATE TABLE.*bulk_signature_campaigns/is);
  assert.doesNotMatch(migration, /bulk-signatures-v2|mass-signing-new/i);
});

test('migration is additive and does not touch signed artifacts or SSO', () => {
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(migration, /evidence_packages|ByteRange|PAdES|NOM-151|KMS|organization_sso/i);
});

test('one row reserves one stable document and claims atomically', () => {
  assert.match(migration, /materialization_document_id/);
  assert.match(migration, /uq_bulk_item_reserved_document/);
  assert.match(migration, /FOR UPDATE OF item SKIP LOCKED/);
  assert.match(migration, /COALESCE\(item\.materialization_document_id, gen_random_uuid\(\)\)/);
  assert.match(migration, /commit_bulk_campaign_item_materialization/);
});

test('runtime recovers the same document after partial materialization', () => {
  assert.match(runtime, /BULK_DOCUMENT_RESERVATION_CONFLICT/);
  assert.match(runtime, /if \(!existing\.data\)/);
  assert.match(runtime, /initializeCollaborationDocumentVersion/);
  assert.match(runtime, /document_relations/);
  assert.match(runtime, /bulk-materialized:\$\{item\.id\}/);
});

test('source identity and configuration are frozen server-side', () => {
  assert.match(collectionRoute, /resolveInternalDocumentSource/);
  assert.match(collectionRoute, /document_configuration: sourceDocument\.data/);
  assert.match(collectionRoute, /sourceSha256/);
  assert.match(runtime, /BULK_SOURCE_HASH_MISMATCH/);
  assert.match(runtime, /document_configuration/);
});

test('document creation reuses current versioning, encryption, delivery and event services', () => {
  assert.match(runtime, /initializeCollaborationDocumentVersion/);
  assert.match(runtime, /encryptAndUploadDocumentObject/);
  assert.match(runtime, /deliverDocumentInvitations/);
  assert.match(runtime, /appendDocumentOperationalEvent/);
  assert.match(runtime, /audit_trail/);
});

test('delivery retry does not rematerialize and SMS ambiguous failures do not retry', () => {
  assert.match(runtime, /claim_bulk_campaign_item_delivery/);
  assert.match(runtime, /stage === 'delivery' && item\.delivery_channel === 'sms'/);
  assert.match(migration, /delivery_attempt_count/);
  assert.match(migration, /attempts < 5/);
});

test('pause releases claims without cancelling documents and cancellation fails closed', () => {
  assert.match(runtime, /const paused = campaign\.data\?\.status === 'paused'/);
  assert.match(runtime, /status: item\.document_id \? 'queued' : 'ready'/);
  assert.match(campaignRoute, /\.update\(update\)[\s\S]*eventType: 'CAMPAIGN_CANCEL'/);
  assert.match(campaignRoute, /claimed_by: null/);
  assert.match(campaignRoute, /item\.data\.retryable !== true/);
});

test('existing Phase C scheduler processes bounded bulk batches behind the existing flag', () => {
  assert.match(processor, /processBulkSignatureCampaigns/);
  assert.match(processor, /PHASE_E_FEATURES\.bulkRuntime/);
  assert.match(runtime, /Math\.min\(Math\.max\(options\.materializationLimit \|\| 12, 1\), 25\)/);
  assert.match(runtime, /Math\.min\(Math\.max\(options\.deliveryLimit \|\| 25, 1\), 50\)/);
});

test('server APIs enforce auth, tenant membership, RBAC and existing rate limiting', () => {
  for (const source of [collectionRoute, campaignRoute]) {
    assert.match(source, /requireBulkSignatureUser/);
    assert.match(source, /assertBulkWorkspaceAccess/);
    assert.match(source, /assertBulkWorkspacePermission/);
    assert.match(source, /consumeServerRateLimit/);
  }
});

test('RLS exposes reads only and runtime RPCs are service-only', () => {
  assert.match(migration, /CREATE POLICY bulk_rbac_read/);
  assert.match(migration, /GRANT SELECT ON TABLE/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.claim_bulk_campaign_item_materialization/
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.claim_bulk_campaign_item_materialization[\s\S]*TO service_role/
  );
});

test('existing UI uses server state and the existing Docubox source selector', () => {
  assert.match(campaignList, /bulkSignatureApiFetch/);
  assert.match(campaignMonitor, /bulkSignatureApiFetch/);
  assert.match(campaignMonitor, /retry_item/);
  assert.match(campaignMonitor, /reschedule/);
  assert.match(campaignNew, /DocuboxSourceSelector/);
  for (const source of [campaignList, campaignNew, campaignMonitor]) {
    assert.doesNotMatch(source, /localStorage/);
  }
});

test('campaign and document lifecycle remain independently traceable', () => {
  assert.match(runtime, /CAMPAIGN_ITEM_MATERIALIZED/);
  assert.match(runtime, /CAMPAIGN_ITEM_SENT/);
  assert.match(runtime, /firma_masiva_instancia_materializada/);
  assert.match(runtime, /firma_masiva_invitacion_enviada/);
  assert.match(migration, /sync_bulk_item_from_document_state/);
});
