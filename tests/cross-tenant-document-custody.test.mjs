import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914180703_cross_tenant_document_custody.sql'
);
const sourceRoute = await read('../src/app/api/documentos/[documentId]/custody/route.ts');
const destinationRoute = await read('../src/app/api/organizacion/custody-transfers/route.ts');
const sourcePanel = await read(
  '../src/components/documents/OrganizationDocumentGovernancePanel.tsx'
);
const destinationInbox = await read('../src/components/organization/OrganizationCustodyInbox.tsx');
const organizationGovernance = await read(
  '../src/app/organizacion/_components/OrganizationGovernance.tsx'
);
const access = await read('../src/lib/security/document-access.ts');
const encryptionMetadata = await read(
  '../src/lib/crypto/document-encryption/encryption-metadata.ts'
);
const encryptionService = await read(
  '../src/lib/crypto/document-encryption/document-encryption.service.ts'
);
const automation = await read('../src/lib/collaboration/automation-contracts.ts');
const webhooks = await read('../src/app/api/organizacion/webhooks/route.ts');
const phaseD = await read('../src/lib/organization/phase-d.ts');

test('custody is an additive administrative relationship, not tenant reparenting', () => {
  assert.match(migration, /current_custodian_workspace_id/);
  assert.match(migration, /document_custody_transfers/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(migration, /SET\s+workspace_id\s*=/i);
  assert.doesNotMatch(migration, /SET\s+owner_id\s*=/i);
  assert.doesNotMatch(migration, /SET\s+participantes\s*=/i);
});

test('the bilateral request has source, destination and explicit terminal states', () => {
  assert.match(migration, /source_workspace_id UUID NOT NULL/);
  assert.match(migration, /destination_workspace_id UUID NOT NULL/);
  assert.match(migration, /'pending', 'completed', 'rejected', 'cancelled', 'expired'/);
  assert.match(migration, /requested_by/);
  assert.match(migration, /accepted_by/);
  assert.match(migration, /rejected_by/);
  assert.match(migration, /cancelled_by/);
});

test('V1 allows organization-to-organization custody only', () => {
  assert.match(migration, /workspace_type = 'business'/);
  assert.match(migration, /CUSTODY_SOURCE_NOT_ELIGIBLE/);
  assert.match(migration, /CUSTODY_DESTINATION_NOT_ELIGIBLE/);
  assert.match(migration, /CUSTODY_USE_INTERNAL_TRANSFER/);
});

test('active documents are blocked and terminal documents are supported', () => {
  assert.match(
    migration,
    /lower\(COALESCE\(v_document\.estado, ''\)\) NOT IN \('completado', 'vencido', 'cancelado', 'rechazado'\)/
  );
  assert.match(migration, /CUSTODY_ACTIVE_DOCUMENT_DENIED/);
});

test('request, accept, reject and cancel authorization are server-side', () => {
  assert.match(sourceRoute, /authorizeOrganizationRequest/);
  assert.match(sourceRoute, /documents\.custody\.transfer/);
  assert.match(destinationRoute, /documents\.custody\.receive/);
  assert.match(migration, /cross_tenant_custody_user_has_permission/);
  assert.match(migration, /CUSTODY_SOURCE_PERMISSION_DENIED/);
  assert.match(migration, /CUSTODY_DESTINATION_PERMISSION_DENIED/);
  assert.match(migration, /CUSTODY_CANCEL_PERMISSION_DENIED/);
});

test('source and destination require independent reauthentication', () => {
  assert.match(sourceRoute, /requireOrganizationReauthentication/);
  assert.match(destinationRoute, /requireOrganizationReauthentication/);
  assert.match(sourceRoute, /documents\.custody\.transfer/);
  assert.match(destinationRoute, /documents\.custody\.receive/);
});

test('service-role RPCs still validate actor, tenant and permissions', () => {
  assert.match(migration, /p_actor_user_id/);
  assert.match(migration, /p_source_workspace_id/);
  assert.match(migration, /p_destination_workspace_id/);
  assert.match(migration, /p_workspace_id IS DISTINCT FROM v_transfer\.destination_workspace_id/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.request_cross_tenant/);
  assert.match(migration, /TO service_role/);
});

test('one pending request and row locking prevent concurrent duplicate transfers', () => {
  assert.match(migration, /document_custody_transfers_one_active_idx/);
  assert.match(migration, /UNIQUE\(source_workspace_id, idempotency_key\)/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /EXCEPTION WHEN unique_violation/);
  assert.match(migration, /idempotent', true/);
  assert.match(migration, /CUSTODY_IDEMPOTENCY_CONFLICT/);
});

test('terminal transfer idempotency compares against a scalar case expression', () => {
  assert.match(migration, /v_transfer\.status = \(CASE p_action[\s\S]*?ELSE '' END\) THEN/);
  assert.doesNotMatch(migration, /v_transfer\.status = CASE p_action/);
});

test('acceptance atomically updates only current custody and appends history', () => {
  assert.match(
    migration,
    /SET current_custodian_workspace_id = v_transfer\.destination_workspace_id/
  );
  assert.match(migration, /INSERT INTO public\.document_custody_history/);
  assert.match(migration, /SET status = 'completed'/);
  assert.match(migration, /custody\.transfer_accepted/);
  assert.match(migration, /custody\.transferred/);
});

test('a second transfer reconstructs A to B to C through append-only history', () => {
  assert.match(migration, /previous_custodian_member_id/);
  assert.match(migration, /v_previous\.custodian_member_id/);
  assert.match(migration, /current_custodian_workspace_id, v_document\.workspace_id/);
  assert.doesNotMatch(migration, /DELETE FROM public\.document_custody_history/);
});

test('reject, cancel and expiration do not change current custody', () => {
  assert.match(migration, /SET status = 'rejected'/);
  assert.match(migration, /SET status = 'cancelled'/);
  assert.match(migration, /SET status = 'expired'/);
  const custodyUpdates = migration.match(/SET current_custodian_workspace_id/g) || [];
  assert.equal(custodyUpdates.length, 2); // backfill plus the acceptance transition
});

test('current custodian access is enforced in RLS, Storage and backend helpers', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.can_access_documento/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.can_read_document_storage/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.can_manage_document_package/);
  assert.match(access, /current_custodian_workspace_id/);
  assert.match(access, /currentCustodianWorkspaceId/);
});

test('historical owner retains read access but loses owner write policy after transfer', () => {
  assert.match(migration, /document\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /DROP POLICY IF EXISTS owner_manage_documentos/);
  assert.match(
    migration,
    /COALESCE\(current_custodian_workspace_id, workspace_id\) IS NOT DISTINCT FROM workspace_id/
  );
  assert.match(access, /historicalOwnerStillCustodian/);
  assert.match(
    access,
    /options\.requireEdit && !historicalOwnerStillCustodian && !isWorkspaceManager/
  );
});

test('retention and Legal Hold survive transfer without automatic policy mutation', () => {
  const acceptance = migration.slice(
    migration.indexOf("IF p_action = 'cancel'"),
    migration.indexOf('-- Existing intra-organization custody')
  );
  assert.doesNotMatch(acceptance, /retention_until\s*=|legal_hold/i);
  assert.match(migration, /apply_document_retention_policy/);
  assert.match(migration, /current_custodian_workspace_id, v_document\.workspace_id/);
});

test('encryption AAD remains anchored to persisted historical metadata', () => {
  assert.match(encryptionMetadata, /tenantId: metadata\.tenant_id/);
  assert.match(encryptionService, /buildDocumentAad\(contextFromMetadata\(metadata\)\)/);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.(?:document_encryption_metadata|evidence_packages|signature_evidence)/i
  );
  assert.doesNotMatch(migration, /wrapped_dek|aad_sha256|ciphertext|plaintext_sha256/i);
});

test('source UI requests custody from the existing document governance panel', () => {
  assert.match(sourcePanel, /Transferir a otra organización/);
  assert.match(sourcePanel, /destination_organization/);
  assert.match(sourcePanel, /documents\.custody\.transfer/);
  assert.doesNotMatch(sourcePanel, /workspace_id.*destination/i);
});

test('destination UI reuses the existing organization resources area', () => {
  assert.match(organizationGovernance, /OrganizationCustodyInbox/);
  assert.match(destinationInbox, /Solicitudes de custodia recibidas/);
  assert.match(destinationInbox, /Aceptar custodia/);
  assert.match(destinationInbox, /Confirmar rechazo/);
  assert.match(destinationInbox, /\/visor-documento\//);
});

test('custody APIs reuse rate limiting and do not trust a client destination UUID', () => {
  assert.match(sourceRoute, /consumeServerRateLimit/);
  assert.match(destinationRoute, /consumeServerRateLimit/);
  assert.match(sourceRoute, /resolveDestinationOrganization/);
  assert.match(sourceRoute, /destination_organization/);
  assert.doesNotMatch(sourceRoute, /destination_workspace_id:\s*input/);
});

test('canonical events feed existing automation and webhook catalogs', () => {
  for (const event of [
    'custody.transfer_requested',
    'custody.transfer_accepted',
    'custody.transfer_rejected',
    'custody.transfer_cancelled',
    'custody.transfer_expired',
    'custody.transferred',
  ]) {
    const pattern = new RegExp(event.replaceAll('.', '\\.'));
    assert.match(migration, pattern);
    assert.match(automation, pattern);
    assert.match(webhooks, pattern);
  }
});

test('feature flag exists and remains disabled by default', () => {
  assert.match(phaseD, /crossTenantCustody: 'cross_tenant_document_custody'/);
  assert.match(migration, /'cross_tenant_document_custody'/);
  assert.match(migration, /false,\s*0,\s*'\{\}'/);
  assert.doesNotMatch(migration, /global_enabled\s*=\s*true|rollout_percentage\s*=\s*100/i);
});

test('signed artifacts and cryptographic pipelines are not modified', () => {
  assert.doesNotMatch(
    migration,
    /signed_pdf|ByteRange|PAdES|TSA|NOM.?151|KMS|HSM|UPDATE public\.evidence/i
  );
});
