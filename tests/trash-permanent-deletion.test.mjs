import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const page = await read('../src/app/mis-documentos/page.tsx');
const listRoute = await read('../src/app/api/documentos/listar/route.ts');
const trashRoute = await read('../src/app/api/documentos/papelera/route.ts');
const purgeRoute = await read('../src/app/api/internal/document-purge/route.ts');
const historyRoute = await read('../src/app/api/documentos/eliminaciones/route.ts');
const retention = await read('../src/lib/documents/trash-retention.ts');
const lifecycle = await read('../src/lib/documents/lifecycle-policy.ts');
const purgeService = await read('../src/lib/documents/purge-document.ts');
const lifecycleMigration = await read(
  '../supabase/migrations/20260902000000_document_lifecycle_retention_and_visibility.sql'
);
const purgeMigration = await read(
  '../supabase/migrations/20260902002000_document_purge_evidence_tombstones.sql'
);
const legalHoldRoute = await read('../src/app/api/documentos/[documentId]/legal-hold/route.ts');
const legalHoldMigration = await read(
  '../supabase/migrations/20260902001000_enforce_document_legal_hold_transitions.sql'
);
const vercelConfig = await read('../vercel.json');

test('permanent deletion authenticates the actor before any service-role work', () => {
  assert.match(trashRoute, /createAnonClient\(\)\.auth\.getUser/);
  assert.match(trashRoute, /PURGE_CONFIRMATION_REQUIRED/);
  assert.doesNotMatch(trashRoute, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('single-document deletion requires owner or workspace-admin access', () => {
  assert.match(
    trashRoute,
    /requireDocumentAccess\(\s*request,\s*payload\.document_id,\s*\{\s*ownerOrAdminOnly: true,?\s*\}\s*\)/
  );
  assert.match(trashRoute, /documentAccessResponse\(error\)/);
});

test('the recovery period remains a deletion blocker', () => {
  assert.match(lifecycle, /RECOVERY_PERIOD/);
  assert.match(lifecycle, /canPurgeFromTrash: !withinRecoveryPeriod/);
  assert.match(retention, /RECOVERY_PERIOD/);
});

test('Legal Hold wins over every purge path', () => {
  assert.match(lifecycle, /blockingCode: 'LEGAL_HOLD'/);
  assert.match(trashRoute, /LEGAL_HOLD_ACTIVE/);
  assert.match(legalHoldRoute, /LEGAL_HOLD_ACTIVATED/);
});

test('active retention remains a real blocker', () => {
  assert.match(lifecycle, /retentionActive/);
  assert.match(retention, /RETENTION_ACTIVE/);
  assert.match(trashRoute, /DOCUMENT_RETENTION_REQUIRED/);
});

test('cryptographic evidence no longer becomes a retention blocker by itself', () => {
  assert.doesNotMatch(retention, /LEGAL_OR_CRYPTOGRAPHIC_EVIDENCE/);
  assert.doesNotMatch(retention, /DOCUMENT_CERTIFICATIONS/);
  assert.doesNotMatch(retention, /NOM151/);
});

test('purge policy has no evidence query fanout on the trash listing path', () => {
  assert.doesNotMatch(retention, /\.from\(/);
  assert.match(listRoute, /classifyTrashRetention\(/);
  assert.match(listRoute, /purge_eligible:/);
});

test('eligible documents use the coordinated purge service instead of direct document deletion', () => {
  assert.match(trashRoute, /purgeDocumentBundle\(/);
  assert.doesNotMatch(trashRoute, /\.from\('documentos'\)\s*\.delete\(\)/s);
  assert.match(trashRoute, /DOCUMENT_PURGE_REQUESTED/);
  assert.match(trashRoute, /DOCUMENT_PURGED/);
  assert.match(
    trashRoute,
    /method: payload\.direct_delete === true \? 'DIRECT_DELETE' : 'TRASH_PURGE'/
  );
  assert.match(purgeService, /deletion_method: method/);
});

test('bulk trash only submits documents that are eligible for the Paperera transition', () => {
  assert.match(page, /selectedBulkTrashEligible/);
  assert.match(page, /document\.canTrash/);
  assert.match(page, /documento\(s\) no se pueden mover a Papelera/);
  assert.match(page, /disabled=\{selectedBulkTrashEligible\.length === 0\}/);
});

test('storage objects are removed through the Storage API before relational finalization', () => {
  assert.match(purgeService, /storage\.from\(bucket\)\.remove/);
  assert.match(purgeService, /STORAGE_REMOVED/);
  assert.match(purgeService, /service\.rpc\('purge_document_bundle'/);
});

test('a failed technical purge is recorded without reporting completion', () => {
  assert.match(purgeService, /status: 'FAILED'/);
  assert.match(purgeService, /failure_code: 'PURGE_FAILED'/);
  assert.match(trashRoute, /failed: Array/);
  assert.doesNotMatch(trashRoute, /storage_cleanup_pending/);
});

test('a permanent-deletion tombstone retains only minimal lifecycle metadata', () => {
  assert.match(purgeMigration, /CREATE TABLE IF NOT EXISTS public\.document_deletion_tombstones/);
  assert.match(purgeMigration, /document_id uuid NOT NULL/);
  assert.match(purgeMigration, /actor_id uuid/);
  assert.match(purgeMigration, /reason text NOT NULL/);
  assert.match(purgeMigration, /completed_at timestamptz/);
  assert.match(purgeMigration, /no foreign key to documentos/);
});

test('tombstones are backend-only and protected by RLS', () => {
  assert.match(purgeMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(
    purgeMigration,
    /REVOKE ALL ON TABLE public\.document_deletion_tombstones FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    purgeMigration,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.document_deletion_tombstones TO service_role/
  );
});

test('immutable evidence is only deletable inside the scoped purge transaction', () => {
  assert.match(purgeMigration, /document_purge_context_active/);
  assert.match(purgeMigration, /TG_OP = 'DELETE' AND public\.document_purge_context_active\(\)/);
  assert.match(
    purgeMigration,
    /PERFORM set_config\('docubox\.document_purge_context', 'active', true\)/
  );
});

test('the database purge function is backend-only and rechecks policy', () => {
  assert.match(purgeMigration, /SECURITY DEFINER/);
  assert.match(purgeMigration, /IF auth\.role\(\) <> 'service_role'/);
  assert.match(purgeMigration, /document_purge_legal_hold/);
  assert.match(purgeMigration, /document_purge_retention_active/);
  assert.match(purgeMigration, /document_purge_recovery_period/);
  assert.match(purgeMigration, /REVOKE ALL ON FUNCTION public\.purge_document_bundle/);
});

test('the bundle purge covers document, PAdES, TSA, NOM-151, signature and certification artifacts', () => {
  for (const table of [
    'document_pdf_signatures',
    'timestamp_records',
    'nom151_constancias_doc',
    'signature_evidence',
    'document_certifications',
    'evidence_manifests',
    'certification_files',
  ]) {
    assert.match(purgeMigration, new RegExp(`DELETE FROM public\\.${table}`));
  }
  assert.match(purgeService, /CERTIFICATION_BUCKET/);
  assert.match(purgeService, /NOM151_BUCKET/);
});

test('direct deletion is limited to draft, preparation or terminal non-active documents', () => {
  assert.match(lifecycle, /DIRECT_PURGE_DOCUMENT_STATES/);
  assert.match(lifecycle, /'cancelado'/);
  assert.match(lifecycle, /'rechazado'/);
  assert.match(lifecycle, /'expirado'/);
  assert.match(trashRoute, /direct_delete/);
  assert.match(trashRoute, /DOCUMENT_DIRECT_PURGE_NOT_ALLOWED/);
});

test('a draft remains directly purgeable when it only has planned participants', () => {
  assert.match(lifecycle, /canDirectPurgeDraft: isDraft/);
  assert.match(
    lifecycle,
    /canDirectPurge: directPurgeEligibleState && \(isDraft \|\| !activeParticipants\)/
  );
  assert.match(lifecycle, /if \(workflowActive\)/);
});

test('deletion history is available without exposing deleted content or storage paths', () => {
  assert.match(historyRoute, /document_deletion_tombstones/);
  assert.match(historyRoute, /workspace_members/);
  assert.match(historyRoute, /document_id,workspace_id,reason,status,requested_at/);
  assert.match(historyRoute, /document_name/);
  assert.match(historyRoute, /document_created_at/);
  assert.match(historyRoute, /document_trashed_at/);
  assert.doesNotMatch(historyRoute, /storage_path/);
  assert.match(page, /Historial de eliminaciones/);
});

test('automatic purge is scheduled, secret-protected and limited to expired recovery windows', () => {
  assert.match(vercelConfig, /api\/internal\/document-purge/);
  assert.match(purgeRoute, /CRON_SECRET/);
  assert.match(purgeRoute, /\.lte\('restore_until', now\)/);
  assert.match(purgeRoute, /AUTO_RECOVERY_EXPIRY/);
  assert.match(purgeRoute, /MAX_DOCUMENTS_PER_RUN = 50/);
});

test('existing lifecycle separation and Legal Hold server-side enforcement remain intact', () => {
  assert.match(lifecycleMigration, /document_user_visibility/);
  assert.match(lifecycleMigration, /document_lifecycle_audit_events/);
  assert.match(legalHoldMigration, /LEGAL_HOLD_SERVER_SIDE_REQUIRED/);
  assert.match(legalHoldMigration, /LEGAL_HOLD_RELEASE_REASON_REQUIRED/);
});
