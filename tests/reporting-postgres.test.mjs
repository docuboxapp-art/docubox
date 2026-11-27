import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const runtime = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
const installed = existsSync(new URL(runtime + '/package.json', import.meta.url));

test('registered users share the system catalog and only active members can persist reports in their workspace', {
  skip: !installed && 'PGlite test runtime not installed',
}, async () => {
  const { PGlite } = require(runtime);
  const db = new PGlite();
  const [editor, colleague, workspace, otherWorkspace] = Array.from({ length: 4 }, () => randomUUID());
  const query = async (sql, parameters) => (await db.query(sql, parameters)).rows;
  async function actor(id, anonymous = false) {
    await db.exec('set role authenticated');
    await query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [
      id, JSON.stringify({ is_anonymous: anonymous }),
    ]);
  }
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable
        as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
      create table public.user_profiles (id uuid primary key);
      create table public.workspaces (id uuid primary key);
      create table public.workspace_members (workspace_id uuid,user_id uuid,role text,status text,access_expires_at timestamptz);
      grant select on public.workspace_members to authenticated;
    `);
    await query('insert into public.user_profiles values ($1),($2)', [editor, colleague]);
    await query('insert into public.workspaces values ($1),($2)', [workspace, otherWorkspace]);
    await query(`
      insert into public.workspace_members values
        ($1,$2,'owner','active',null),($1,$3,'member','active',now()-interval '1 minute'),
        ($4,$3,'owner','active',null)
    `, [workspace, editor, colleague, otherWorkspace]);
    for (const name of [
      '20261011172744_report_definitions.sql', '20261011173819_report_additional_modules.sql',
      '20261124120307_report_catalog_and_access.sql',
    ]) await db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));

    await actor(editor);
    const reports = await query('select id, config from public.report_system_presets where listed order by sort_order');
    assert.equal(reports.length, 12);
    assert.equal(reports.find(item => item.id === 'docubox-expedientes').config.visualization, 'table');
    await assert.rejects(query("update public.report_system_presets set name='Nuevo nombre'"), /permission denied/);

    const [saved] = await query(`
      insert into public.report_definitions(workspace_id,created_by,name,dataset,config)
      values ($1,$2,'Informe de prueba','firmas_masivas',$3) returning id
    `, [workspace, editor, { visualization: 'bar', fields: ['nombre', 'estado'] }]);
    await query("update public.report_definitions set config = '{\"visualization\":\"line\"}' where id=$1", [saved.id]);
    assert.equal((await query('select config from public.report_definitions where id=$1', [saved.id]))[0].config.visualization, 'line');
    await assert.rejects(query('update public.report_definitions set workspace_id=$1 where id=$2', [otherWorkspace, saved.id]), /permission denied/);

    await actor(colleague);
    assert.deepEqual(await query('select id, config from public.report_system_presets where listed order by sort_order'), reports);
    assert.deepEqual(await query('select id from public.report_definitions where id=$1', [saved.id]), []);
    await assert.rejects(query(`
      insert into public.report_definitions(workspace_id,created_by,name,dataset) values ($1,$2,'Sin acceso','documentos')
    `, [workspace, colleague]), /row-level security/);

    await actor(colleague, true);
    assert.deepEqual(await query('select id from public.report_system_presets'), []);
    await actor(editor);
    assert.deepEqual(await query('delete from public.report_definitions where id=$1 returning id', [saved.id]), [saved]);
  } finally {
    await db.close();
  }
});
