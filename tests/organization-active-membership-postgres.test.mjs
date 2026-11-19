import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite');
const db = new PGlite();
const actor = '11111111-1111-4111-8111-111111111111',
  business = '22222222-2222-4222-8222-222222222222',
  personal = '33333333-3333-4333-8333-333333333333';
test.before(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,workspace_type text,organization_enabled boolean);
    CREATE TABLE workspace_members(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,user_id uuid,role text,status text,access_expires_at timestamptz);
    CREATE TABLE organization_entitlements(workspace_id uuid,entitlement_key text,status text,limits jsonb DEFAULT '{}',starts_at timestamptz,ends_at timestamptz,read_only_at timestamptz,access_level text);
    CREATE TABLE addon_products(id uuid,product_key text);
    CREATE TABLE organization_addon_subscriptions(id uuid,workspace_id uuid,product_id uuid,status text,trial_ends_at timestamptz,current_period_end timestamptz);
    CREATE FUNCTION get_my_organization_permissions(uuid) RETURNS TABLE(permission_key text) LANGUAGE sql AS $$SELECT 'tasks.view'::text$$;
    CREATE FUNCTION has_organization_permission(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    INSERT INTO workspaces VALUES('${business}','business',true),('${personal}','personal',false);
    INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES('${business}','${actor}','member','active'),('${personal}','${actor}','owner','active');
    INSERT INTO organization_entitlements(workspace_id,entitlement_key,status) VALUES('${business}','collaboration_core','active');
    CREATE TABLE native_resource(workspace_id uuid);INSERT INTO native_resource VALUES('${business}'),('${personal}');ALTER TABLE native_resource ENABLE ROW LEVEL SECURITY;GRANT SELECT ON native_resource TO authenticated;
  `);
  await db.exec(
    await readFile(
      'supabase/migrations/20261119225746_organization_active_membership_boundaries.sql',
      'utf8'
    )
  );
  await db.exec(
    'CREATE POLICY native_scope ON native_resource FOR SELECT TO authenticated USING(workspace_id IN (SELECT get_user_workspace_ids()))'
  );
});
test.after(() => db.close());
test.beforeEach(async () => {
  await db.exec(
    `RESET ROLE;UPDATE workspace_members SET status='active',access_expires_at=NULL;UPDATE workspaces SET organization_enabled=true;UPDATE organization_entitlements SET status='active',ends_at=NULL,read_only_at=NULL;`
  );
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [actor]);
});
const first = async (q, args = []) => (await db.query(q, args)).rows[0];
const access = async () =>
  (await first('SELECT get_my_collaboration_access($1) result', [business])).result;
test('active native access retains personal workspaces and the existing commercial gates', async () => {
  await db.exec(
    `UPDATE workspaces SET organization_enabled=false WHERE id='${personal}';SET ROLE authenticated;`
  );
  assert.equal((await db.query('SELECT * FROM native_resource')).rows.length, 2);
  assert.equal((await access()).write_allowed, true);
  await db.exec('RESET ROLE;DELETE FROM organization_entitlements;');
  assert.equal((await access()).code, 'ADDON_REQUIRED');
  await db.exec(
    `INSERT INTO organization_entitlements(workspace_id,entitlement_key,status) VALUES('${business}','collaboration_core','active')`
  );
});
test('suspended and expired members cannot read native rows or receive Colabora entitlements', async () => {
  for (const update of [
    "status='suspended'",
    "status='active',access_expires_at=now()-interval '1 second'",
  ]) {
    await db.exec(
      `RESET ROLE;UPDATE workspace_members SET ${update} WHERE workspace_id='${business}';SET ROLE authenticated;`
    );
    assert.deepEqual(
      (await db.query('SELECT workspace_id FROM native_resource')).rows.map((x) => x.workspace_id),
      [personal]
    );
    assert.equal(
      (
        await first("SELECT has_collaboration_entitlement($1,'collaboration_core',false) allowed", [
          business,
        ])
      ).allowed,
      false
    );
    const result = await access();
    assert.equal(result.accessible, false);
    assert.equal(result.write_allowed, false);
    assert.equal(result.entitlements, undefined);
  }
  await db.exec('RESET ROLE');
});
test('disabled organizations disappear from native scope without disabling the personal workspace', async () => {
  await db.exec(`UPDATE workspaces SET organization_enabled=false;SET ROLE authenticated;`);
  assert.deepEqual(
    (await db.query('SELECT workspace_id FROM native_resource')).rows.map((x) => x.workspace_id),
    [personal]
  );
  assert.equal((await access()).eligible, false);
  await db.exec('RESET ROLE');
});
test('read-only commercial history remains readable while writes and anonymous RPCs stay blocked', async () => {
  await db.exec(
    "UPDATE organization_entitlements SET status='expired',ends_at=now()-interval '1 day';SET ROLE authenticated;"
  );
  const result = await access();
  assert.equal(result.accessible, true);
  assert.equal(result.write_allowed, false);
  assert.equal(result.code, 'READ_ONLY');
  await db.exec('RESET ROLE');
  for (const signature of [
    'get_user_workspace_ids()',
    'get_my_collaboration_access(uuid)',
    'has_collaboration_entitlement(uuid,text,boolean)',
  ])
    assert.equal(
      (await first("SELECT has_function_privilege('anon',$1,'EXECUTE') allowed", [signature]))
        .allowed,
      false
    );
});
