import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readMigration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const prerequisites = [
  '20260913013624_document_view_access_protection_v2.sql',
  '20260913021500_document_view_access_admin_events.sql',
  '20260913055126_template_publication_context.sql',
  '20260913060728_template_approval_workflow_instance.sql',
];

const core = [
  '20260913180815_phase_a_security_foundations.sql',
  '20260913213000_phase_b_document_packages.sql',
  '20260913234153_auth_003_atomic_participant_completion.sql',
  '20260914003615_phase_c_orchestration_agreement_actions.sql',
  '20260914012827_phase_d_advanced_organization.sql',
  '20260914033655_phase_e_intelligence_enterprise_integrations.sql',
  '20260914050356_auth_e_002_bulk_signature_runtime.sql',
  '20260914054518_auth_e_001_workflow_builder_canonical_runtime.sql',
  '20260914151842_workflow_builder_v2_deferred_nodes.sql',
  '20260914165651_group_member_delegation.sql',
  '20260914180703_cross_tenant_document_custody.sql',
];

test('the four prerequisites precede the eleven roadmap migrations', async () => {
  const ordered = [...prerequisites, ...core];
  assert.deepEqual(ordered, [...ordered].sort());
  await Promise.all(ordered.map(readMigration));
});

test('Phase E reuses the single platform feature flag schema', async () => {
  const [phaseE, builder, builderV2, serverFlags] = await Promise.all([
    readMigration(core[5]),
    readMigration(core[7]),
    readMigration(core[8]),
    readFile(new URL('../src/lib/phase-e/feature-flags.ts', import.meta.url), 'utf8'),
  ]);
  const combined = `${phaseE}\n${builder}\n${builderV2}\n${serverFlags}`;

  assert.match(phaseE, /flag_key,[\s\S]*?global_enabled,[\s\S]*?rollout_percentage/);
  assert.match(serverFlags, /\.select\('global_enabled,rollout_percentage'\)/);
  assert.match(serverFlags, /\.eq\('flag_key', featureKey\)/);
  assert.doesNotMatch(combined, /\bfeature_key\b|\bconfiguration\s*=\s*configuration/);
});

test('participant completion replacements preserve signatures and chain authorization', async () => {
  const [phaseD, delegation] = await Promise.all([readMigration(core[4]), readMigration(core[9])]);

  assert.match(phaseD, /RENAME TO claim_participant_completion_auth003/);
  assert.match(phaseD, /v_result := public\.claim_participant_completion_auth003\(/);
  assert.match(delegation, /RENAME TO claim_participant_completion_phase_d/);
  assert.match(delegation, /RETURN public\.claim_participant_completion_phase_d\(/);
  assert.match(delegation, /SECURITY INVOKER[\s\S]*?SET search_path = ''/);
});

test('bulk and workflow replacements retain exact public signatures', async () => {
  const [phaseE, bulk, builder, builderV2] = await Promise.all([
    readMigration(core[5]),
    readMigration(core[6]),
    readMigration(core[7]),
    readMigration(core[8]),
  ]);

  const bulkSignature =
    /create_bulk_campaign_with_recipients\(\s*p_workspace_id UUID,\s*p_creator_id UUID,\s*p_idempotency_key TEXT,\s*p_campaign JSONB,\s*p_recipients JSONB\s*\)/;
  assert.match(phaseE, bulkSignature);
  assert.match(bulk, bulkSignature);
  assert.match(
    bulk,
    /REVOKE ALL ON FUNCTION public\.create_bulk_campaign_with_recipients[\s\S]*?FROM PUBLIC, anon, authenticated/
  );

  for (const sql of [builder, builderV2]) {
    assert.match(sql, /validate_organization_workflow_definition\(requested_definition JSONB\)/);
    assert.match(
      sql,
      /publish_organization_workflow\(\s*ws_id UUID,\s*target_workflow_id UUID\s*\)/
    );
    assert.match(
      sql,
      /start_organization_workflow_instance\([\s\S]*?requested_idempotency_key UUID\s*\)/
    );
  }
});

test('cross-tenant replacements add custodian scope without weakening historical scope', async () => {
  const custody = await readMigration(core[10]);

  assert.match(
    custody,
    /COALESCE\(v_document\.current_custodian_workspace_id, v_document\.workspace_id\)/
  );
  assert.match(custody, /cross_tenant_custody_user_has_permission/);
  assert.match(custody, /SET current_custodian_workspace_id = workspace_id/);
  assert.doesNotMatch(custody, /UPDATE public\.documentos\s+SET workspace_id\s*=/);
  assert.match(custody, /document\.current_custodian_workspace_id/);
  assert.match(custody, /SECURITY DEFINER[\s\S]*?SET search_path = ''/);
  assert.match(custody, /REVOKE ALL ON FUNCTION public\.can_manage_document_package/);
});
