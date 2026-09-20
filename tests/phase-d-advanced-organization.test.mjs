import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read(
  '../supabase/migrations/20260914012827_phase_d_advanced_organization.sql'
);
const groups = await read('../src/app/crear-documento/components/StepAgrupamiento.tsx');
const participants = await read('../src/app/crear-documento/components/StepParticipantes.tsx');
const send = await read('../src/app/api/documentos/enviar/route.ts');
const advance = await read('../src/app/api/documentos/advance-participation/route.ts');
const completion = await read('../src/app/api/firma/completion/route.ts');
const signing = await read('../src/app/firmar-documento/[id]/page.tsx');
const access = await read('../src/lib/security/document-access.ts');
const delivery = await read('../src/lib/orchestration/document-delivery.ts');
const governancePanel = await read(
  '../src/components/documents/OrganizationDocumentGovernancePanel.tsx'
);
const retentionPanel = await read(
  '../src/components/organization/OrganizationRetentionPolicies.tsx'
);
const evidenceTypes = await read('../src/lib/evidence-v2/types.ts');
const evidenceXml = await read('../src/lib/evidence-v2/xml.ts');
const evidenceParser = await read('../src/lib/evidence-v2/parser.ts');
const evidenceContext = await read('../src/lib/evidence-v2/participation-context.ts');
const automation = await read('../src/lib/collaboration/automation-contracts.ts');
const webhooks = await read('../src/app/api/organizacion/webhooks/route.ts');
const delegationPolicy = await read('../src/lib/organization/delegation-policy.ts');
const delegationPolicyRoute = await read('../src/app/api/organizacion/delegation-policy/route.ts');

test('Phase D is additive and preserves signed artifacts', () => {
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.(?:evidence_packages|nom151|pades)|ByteRange|KMS|signed_pdf/i
  );
  assert.match(migration, /claim_participant_completion_auth003/);
  assert.match(migration, /commit_participant_completion_auth003/);
});

test('existing signing group UI is extended with ALL and ANY_ONE', () => {
  assert.match(groups, /completionPolicy\?: 'ALL' \| 'ANY_ONE'/);
  assert.match(groups, /Todos participan/);
  assert.match(groups, /Cualquiera participa/);
  assert.doesNotMatch(groups, /N_OF_M/);
});

test('organization units are reused and snapshotted per document', () => {
  assert.match(groups, /\/api\/organizacion\/structure/);
  assert.match(groups, /organizationUnitId/);
  assert.match(send, /snapshotDocumentSigningGroups/);
  assert.match(migration, /snapshot_document_signing_groups/);
  assert.match(migration, /organization_unit_id/);
});

test('ANY_ONE winner claim is serialized before completion', () => {
  assert.match(migration, /completion_policy = 'ANY_ONE'/);
  assert.match(migration, /FOR UPDATE OF signing_group/);
  assert.match(migration, /SIGNING_GROUP_WINNER_ALREADY_CLAIMED/);
  assert.match(migration, /winner_completion_attempt_id/);
  assert.match(migration, /status = 'superseded'/);
});

test('routing treats ANY_ONE and superseded participants as terminal', () => {
  assert.match(advance, /completionPolicy \|\| 'ALL'/);
  assert.match(advance, /grupoParticipantes\.some/);
  assert.match(advance, /'superseded'/);
  assert.match(advance, /'atestiguo'/);
});

test('delegation remains organization-only and internal', async () => {
  const route = await read('../src/app/api/documentos/[documentId]/delegations/route.ts');
  assert.match(route, /authenticateOrganizationRequest/);
  assert.match(route, /delegation\.manage/);
  assert.match(route, /workspace_members/);
  assert.match(route, /status', 'active'/);
  assert.match(route, /create_group_member_delegation/);
  assert.match(route, /participant_reference_id/);
});

test('delegation policy is explicit, organization-scoped and enforced', async () => {
  const route = await read('../src/app/api/documentos/[documentId]/delegations/route.ts');
  assert.match(delegationPolicy, /DISABLED/);
  assert.match(delegationPolicy, /ORGANIZATION_ONLY/);
  assert.match(delegationPolicy, /AUTHORIZED_MEMBERS/);
  assert.match(delegationPolicyRoute, /set_organization_delegation_policy/);
  assert.match(route, /delegationPolicyAllowsMember/);
  assert.match(route, /delegation_policy_disabled/);
  assert.match(route, /participant_already_completed/);
  assert.match(migration, /policy_snapshot/);
});

test('delegation preserves original participant and records effective actor', () => {
  assert.match(migration, /original_participant_reference_id/);
  assert.match(migration, /effective_actor_user_id/);
  assert.match(migration, /participant\.delegation\.completed/);
  assert.match(completion, /document_participant_delegations/);
  assert.match(access, /delegatedParticipantReferenceId/);
});

test('scheduled delivery resolves active internal delegation', () => {
  assert.match(delivery, /document_participant_delegations/);
  assert.match(delivery, /delegate_user_id/);
  assert.match(delivery, /delegated_from_participant_ref_id/);
});

test('custody transfer is scoped to one workspace and append-oriented', async () => {
  const route = await read('../src/app/api/documentos/[documentId]/custody/route.ts');
  assert.match(migration, /document_custody_history/);
  assert.match(migration, /workspace_id IS DISTINCT FROM p_workspace_id/);
  assert.match(migration, /document_custody_one_current_idx/);
  assert.match(route, /documents\.custody\.transfer/);
  assert.doesNotMatch(migration, /SET owner_id/);
});

test('retention policies reuse retention_until and preserve Legal Hold precedence', () => {
  assert.match(migration, /organization_retention_policies/);
  assert.match(migration, /document_retention_policy_assignments/);
  assert.match(migration, /retention_status = 'ACTIVE', retention_until = v_until/);
  assert.match(governancePanel, /Legal Hold conserva prioridad/);
  assert.match(retentionPanel, /no presupone plazos legales automáticos/);
});

test('electronic witness is distinct from signer and makes no notarial claim', () => {
  assert.match(participants, /value: 'Testigo'/);
  assert.match(signing, /myRole === 'testigo'/);
  assert.match(completion, /'witness'/);
  assert.match(migration, /witness\.completed/);
  assert.match(signing, /sin atribuir efectos notariales/);
});

test('Evidence v2 adds optional governance metadata and remains parseable', () => {
  assert.match(evidenceTypes, /governance\?:/);
  assert.match(evidenceXml, /<Governance>/);
  assert.match(evidenceParser, /participation\.Governance/);
  assert.match(evidenceContext, /delegationRef/);
  assert.match(evidenceContext, /signingGroupRef/);
  assert.match(evidenceContext, /eligibleParticipantRefs/);
  assert.match(evidenceContext, /winnerParticipantRef/);
  assert.match(evidenceContext, /delegationPolicy/);
});

test('Phase C consumers accept Phase D canonical events', () => {
  for (const event of [
    'signing_group.completed',
    'participant.delegation.completed',
    'witness.completed',
    'document.custody_transferred',
    'document.retention_applied',
  ]) {
    assert.match(automation, new RegExp(event.replaceAll('.', '\\.')));
    assert.match(webhooks, new RegExp(event.replaceAll('.', '\\.')));
  }
});

test('all new tables enable RLS and browser writes are revoked', () => {
  for (const table of [
    'document_signing_groups',
    'document_signing_group_members',
    'document_participant_delegations',
    'document_custody_history',
    'organization_retention_policies',
    'document_retention_policy_assignments',
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE/);
  assert.match(migration, /TO service_role/);
});

test('Phase D feature flags remain disabled by default', () => {
  for (const flag of [
    'document_custody_transfer',
    'organization_retention_policies',
    'electronic_witness_routing',
  ]) {
    assert.match(migration, new RegExp(`'${flag}'[\\s\\S]{0,180}false, 0`));
  }
});

test('personal workspace does not receive advanced group controls', () => {
  assert.match(groups, /organizationWorkspaceId &&/);
  assert.match(governancePanel, /workspaceId/);
});
