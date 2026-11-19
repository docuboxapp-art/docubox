import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite');
test('shared organizational triggers retain tenant and publication guards across distinct row shapes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;
      CREATE TABLE workspace_members(id uuid PRIMARY KEY,workspace_id uuid);
      CREATE TABLE organization_directory_people(id uuid PRIMARY KEY,workspace_id uuid,member_id uuid);
      CREATE TABLE organization_directory_evidence(id uuid PRIMARY KEY,workspace_id uuid,person_id uuid);
      CREATE TABLE plantillas(id uuid PRIMARY KEY,workspace_id uuid);
      CREATE TABLE form_templates(id uuid PRIMARY KEY,workspace_id uuid);
      CREATE TABLE organization_approval_workflows(id uuid PRIMARY KEY,workspace_id uuid,name text,description text,version integer,definition jsonb,document_type text,applicable_areas text[],status text);
      CREATE TABLE organization_signature_policies(id uuid PRIMARY KEY,workspace_id uuid,name text,description text,version integer,security_level text,resource_scope text,allowed_signature_types text[],requirements jsonb,status text);
      CREATE TABLE organization_shared_resources(workspace_id uuid,document_template_id uuid,form_template_id uuid,workflow_id uuid,signature_policy_id uuid);`);
    await db.exec(
      await readFile(
        'supabase/migrations/20261119231100_organization_polymorphic_trigger_boundaries.sql',
        'utf8'
      )
    );
    for (const table of [
      'organization_directory_people',
      'organization_directory_evidence',
      'organization_shared_resources',
    ])
      await db.exec(
        `CREATE TRIGGER tenant BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION enforce_organization_phase2_tenant_scope()`
      );
    for (const table of ['organization_approval_workflows', 'organization_signature_policies'])
      await db.exec(
        `CREATE TRIGGER protect BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION protect_published_organization_governance()`
      );
    const ws = '11111111-1111-4111-8111-111111111111',
      foreign = '22222222-2222-4222-8222-222222222222',
      member = '33333333-3333-4333-8333-333333333333',
      person = '44444444-4444-4444-8444-444444444444';
    await db.query('INSERT INTO workspace_members VALUES($1,$2)', [member, ws]);
    await db.query('INSERT INTO organization_directory_people VALUES($1,$2,$3)', [
      person,
      ws,
      member,
    ]);
    await db.query('INSERT INTO organization_directory_evidence VALUES(gen_random_uuid(),$1,$2)', [
      ws,
      person,
    ]);
    await assert.rejects(
      db.query('INSERT INTO organization_directory_evidence VALUES(gen_random_uuid(),$1,$2)', [
        foreign,
        person,
      ]),
      /organization_directory_evidence_workspace_mismatch/
    );
    await assert.rejects(
      db.query('INSERT INTO organization_directory_people VALUES(gen_random_uuid(),$1,$2)', [
        foreign,
        member,
      ]),
      /organization_directory_member_workspace_mismatch/
    );
    await db.query('INSERT INTO form_templates VALUES($1,$2)', [member, ws]);
    await db.query(
      'INSERT INTO organization_shared_resources(workspace_id,form_template_id) VALUES($1,$2)',
      [ws, member]
    );
    await assert.rejects(
      db.query(
        'INSERT INTO organization_shared_resources(workspace_id,form_template_id) VALUES($1,$2)',
        [foreign, member]
      ),
      /organization_form_template_workspace_mismatch/
    );
    await db.query(
      "INSERT INTO organization_approval_workflows(id,workspace_id,name,status,definition) VALUES($1,$2,'Workflow','published','{}')",
      [member, ws]
    );
    await db.query(
      "INSERT INTO organization_signature_policies(id,workspace_id,name,status,requirements) VALUES($1,$2,'Policy','published','{}')",
      [person, ws]
    );
    await assert.rejects(
      db.query('UPDATE organization_approval_workflows SET definition=\'{"changed":true}\''),
      /published_workflow_is_immutable/
    );
    await assert.rejects(
      db.query('UPDATE organization_signature_policies SET requirements=\'{"changed":true}\''),
      /published_signature_policy_is_immutable/
    );
    await db.exec(
      "UPDATE organization_signature_policies SET status='archived';UPDATE organization_approval_workflows SET status='archived'"
    );
    assert.equal(
      (await db.query('SELECT status FROM organization_signature_policies')).rows[0].status,
      'archived'
    );
  } finally {
    await db.close();
  }
});
