import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read('../supabase/migrations/20260914165651_group_member_delegation.sql');
const roleCastRemediation = await read(
  '../supabase/migrations/20260920223000_fix_group_member_delegation_role_cast.sql'
);
const phaseD = await read(
  '../supabase/migrations/20260914012827_phase_d_advanced_organization.sql'
);
const route = await read('../src/app/api/documentos/[documentId]/delegations/route.ts');
const completion = await read('../src/app/api/firma/completion/route.ts');
const control = await read('../src/components/documents/GroupMemberDelegationControl.tsx');
const governancePanel = await read(
  '../src/components/documents/OrganizationDocumentGovernancePanel.tsx'
);
const signing = await read('../src/app/firmar-documento/[id]/page.tsx');
const evidenceTypes = await read('../src/lib/evidence-v2/types.ts');
const evidenceContext = await read('../src/lib/evidence-v2/participation-context.ts');
const evidenceXml = await read('../src/lib/evidence-v2/xml.ts');
const evidenceParser = await read('../src/lib/evidence-v2/parser.ts');
const automation = await read('../src/lib/collaboration/automation-contracts.ts');
const webhooks = await read('../src/app/api/organizacion/webhooks/route.ts');

test('the existing signing-group and delegation engines are extended additively', () => {
  assert.doesNotMatch(migration, /CREATE TABLE|DROP TABLE|TRUNCATE/i);
  assert.match(migration, /ALTER TABLE public\.document_participant_delegations/);
  assert.match(migration, /claim_participant_completion_phase_d/);
  assert.doesNotMatch(migration, /delegation_winner_claim/i);
});

test('one logical group member slot remains the delegated requirement', () => {
  assert.match(migration, /group_member_slot_id UUID/);
  assert.match(migration, /document_group_member_delegations_one_active_slot_idx/);
  assert.match(phaseD, /UNIQUE\(group_id, ordinal\)/);
  assert.doesNotMatch(migration, /INSERT INTO public\.document_signing_group_members/);
});

test('the original member and effective delegate have stable references', () => {
  assert.match(migration, /original_participant_reference_id/);
  assert.match(migration, /delegate_participant_reference_id/);
  assert.match(migration, /effective_actor_user_id/);
});

test('V1 delegation is restricted to an eligible member in the same group', () => {
  assert.match(migration, /delegate_slot\.group_id = v_group\.id/);
  assert.match(migration, /delegate_slot\.status = 'eligible'/);
  assert.match(migration, /GROUP_MEMBER_DELEGATION_SAME_GROUP_REQUIRED/);
  assert.match(route, /candidates/);
});

test('organization delegation policies are reused', () => {
  assert.match(migration, /signature_delegation_policy/);
  assert.match(migration, /ORGANIZATION_ONLY/);
  assert.match(migration, /AUTHORIZED_MEMBERS/);
  assert.match(route, /delegationPolicyAllowsMember/);
});

test('self delegation, cycles and delegation chains are blocked', () => {
  assert.match(migration, /GROUP_MEMBER_DELEGATION_SELF_DENIED/);
  assert.match(migration, /GROUP_MEMBER_DELEGATION_CHAIN_DENIED/);
  assert.match(migration, /chain\.delegate_participant_reference_id = v_original\.id/);
  assert.match(migration, /chain\.original_participant_reference_id = v_delegate_reference\.id/);
});

test('self-service is limited to the original member while admin use remains permissioned', () => {
  assert.match(migration, /v_actor_is_self/);
  assert.match(migration, /permission\.permission_key = 'delegation\.manage'/);
  assert.match(route, /hasDelegationPermission/);
  assert.match(route, /referenceBelongsToUser/);
});

test('create and revoke operations are idempotent and serialized', () => {
  assert.match(migration, /idempotency_key/);
  assert.match(migration, /revocation_idempotency_key/);
  assert.match(migration, /organization_audit_group_member_delegation_once_idx/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(route, /result\.error\.code !== '23505'/);
  assert.match(route, /crypto\.randomUUID|randomUUID/);
});

test('delegation creation locks the slot and group with valid composite assignments', () => {
  assert.match(migration, /SELECT member\.\* INTO v_slot/);
  assert.match(migration, /SELECT signing_group\.\* INTO v_group/);
  assert.doesNotMatch(migration, /SELECT member, signing_group INTO v_slot, v_group/);
});

test('authorized role matching compares the workspace role enum as text', () => {
  assert.match(migration, /COALESCE\(v_delegate_member\.role::TEXT, ''\)/);
  assert.match(roleCastRemediation, /pg_get_functiondef/);
  assert.match(roleCastRemediation, /v_delegate_member\.role::TEXT/);
});

test('revocation restores the original slot without rewriting history', () => {
  assert.match(migration, /SET status = 'revoked'/);
  assert.doesNotMatch(migration, /DELETE FROM public\.document_participant_delegations/);
  assert.doesNotMatch(
    migration,
    /UPDATE public\.document_signing_group_members[\s\S]{0,100}participant_reference_id/
  );
});

test('completion and revocation race on the same active delegation row', () => {
  assert.match(migration, /WHERE id = p_delegation_id[\s\S]{0,180}FOR UPDATE/);
  assert.match(phaseD, /AND status = 'active'[\s\S]{0,80}FOR UPDATE/);
  assert.match(completion, /DELEGATION_NOT_ACTIVE/);
});

test('the original actor cannot complete while delegation is active', () => {
  assert.match(migration, /DELEGATION_ORIGINAL_SUSPENDED/);
  assert.match(
    migration,
    /original_participant_reference_id = p_participant_reference_id[\s\S]{0,100}group_member_slot_id IS NOT NULL/
  );
  assert.match(completion, /DELEGATION_ORIGINAL_SUSPENDED/);
});

test('ALL continues to complete exactly one existing slot', () => {
  assert.match(phaseD, /SET status = 'completed'.*completion_attempt_id/s);
  assert.match(phaseD, /participant_reference_id = v_attempt\.participant_reference_id/);
  assert.doesNotMatch(migration, /completion_policy = 'ALL'[\s\S]{0,100}INSERT/);
});

test('ANY_ONE reuses its atomic winner claim and closes losing delegations', () => {
  assert.match(phaseD, /FOR UPDATE OF signing_group/);
  assert.match(phaseD, /SIGNING_GROUP_WINNER_ALREADY_CLAIMED/);
  assert.match(migration, /close_superseded_group_member_delegation/);
  assert.match(migration, /superseded_by_completion_attempt_id/);
});

test('canonical group-member delegation events reuse the existing event table', () => {
  for (const event of [
    'group_member.delegation_created',
    'group_member.delegation_revoked',
    'group_member.delegation_completed',
  ]) {
    assert.match(migration, new RegExp(event.replaceAll('.', '\\.')));
    assert.match(automation, new RegExp(event.replaceAll('.', '\\.')));
    assert.match(webhooks, new RegExp(event.replaceAll('.', '\\.')));
  }
  assert.match(migration, /document_operational_events/);
  assert.match(route, /deliverDocumentInvitations/);
  assert.match(route, /group_member\.delegation_created/);
});

test('Evidence v2 adds optional slot and delegate references', () => {
  assert.match(evidenceTypes, /groupMemberSlotRef\?:/);
  assert.match(evidenceTypes, /delegateParticipantRef\?:/);
  assert.match(evidenceContext, /group-member-slot:/);
  assert.match(evidenceXml, /GroupMemberSlotRef/);
  assert.match(evidenceXml, /DelegateParticipantRef/);
  assert.match(evidenceParser, /GroupMemberSlotRef/);
});

test('the existing signing experience exposes a compact self-delegation action', () => {
  assert.match(signing, /GroupMemberDelegationControl/);
  assert.match(control, /Delegación de participación/);
  assert.match(control, /Confirmar delegación/);
  assert.match(control, /Revocar/);
  assert.match(signing, /!kioskSessionId/);
  assert.match(governancePanel, /delegationContext\.candidates/);
  assert.match(governancePanel, /Solo se muestran miembros elegibles/);
});

test('Production feature activation and unrelated systems remain untouched', () => {
  assert.doesNotMatch(migration, /global_enabled\s*=\s*true|rollout_percentage\s*=\s*100/i);
  assert.doesNotMatch(migration, /WHATSAPP|PUSH|SSO|N_OF_M|prefilled|cross.?tenant.?custody/i);
});

test('cryptographic artifacts and signed PDFs are not modified', () => {
  assert.doesNotMatch(
    migration,
    /signature_evidence\s+SET|evidence_packages\s+SET|signed_pdf|ByteRange|PAdES|TSA|NOM.?151|KMS|HSM/i
  );
});
