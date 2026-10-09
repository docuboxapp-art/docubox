import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const runtime = resolve('.tmp/form-wizard-db/node_modules/@electric-sql/pglite/dist');

test('los predeterminados se persisten por usuario y espacio bajo RLS', {
  skip: !existsSync(runtime) && 'PGlite test runtime not installed',
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(resolve(runtime, 'index.js')).href);
  const db = new PGlite();
  t.after(() => db.close());
  const A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const B = 'bbbbbbbb-0000-4000-8000-000000000001';
  const C = 'cccccccc-0000-4000-8000-000000000001';
  const W = 'dddddddd-0000-4000-8000-000000000001';
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
    $$;
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.workspaces(id uuid PRIMARY KEY);
    CREATE TABLE public.workspace_members(workspace_id uuid, user_id uuid);
    INSERT INTO public.user_profiles VALUES ('${A}'),('${B}'),('${C}');
    INSERT INTO public.workspaces VALUES ('${W}');
    INSERT INTO public.workspace_members VALUES ('${W}','${A}'),('${W}','${B}');
    CREATE FUNCTION public.is_workspace_member(ws_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT EXISTS (SELECT 1 FROM public.workspace_members
        WHERE workspace_id=ws_id AND user_id=auth.uid())
      $$;
  `);
  await db.exec(readFileSync('supabase/migrations/20261009064426_form_default_settings.sql', 'utf8'));
  await db.exec('GRANT USAGE ON SCHEMA public,auth TO authenticated');
  const asUser = async (id) => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('SET ROLE authenticated');
  };

  await asUser(A);
  await db.query('INSERT INTO public.form_default_settings(user_id,workspace_id,kind,value) VALUES($1,$2,$3,$4)',
    [A, W, 'appearance', JSON.stringify({ headerText: 'Encabezado A' })]);
  await asUser(B);
  const invisible = await db.query('SELECT value FROM public.form_default_settings WHERE workspace_id=$1', [W]);
  assert.equal(invisible.rows.length, 0);
  await db.query('INSERT INTO public.form_default_settings(user_id,workspace_id,kind,value) VALUES($1,$2,$3,$4)',
    [B, W, 'appearance', JSON.stringify({ headerText: 'Encabezado B' })]);
  await assert.rejects(db.query('UPDATE public.form_default_settings SET user_id=$1 WHERE user_id=$2',
    [A, B]));
  await asUser(C);
  await assert.rejects(db.query('INSERT INTO public.form_default_settings(user_id,workspace_id,kind,value) VALUES($1,$2,$3,$4)',
    [C, W, 'pdf', '{}']));
  await asUser(A);
  const persisted = await db.query('SELECT value FROM public.form_default_settings WHERE kind=$1', ['appearance']);
  assert.deepEqual(persisted.rows.map((row) => row.value.headerText), ['Encabezado A']);
});
