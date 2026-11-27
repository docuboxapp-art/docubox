import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const runtime = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
const hasRuntime = existsSync(new URL(`${runtime}/package.json`, import.meta.url));
const migration = await readFile('supabase/migrations/20261124124235_account_and_workspace_settings.sql', 'utf8');

test('account settings persist with workspace, recipient, session and storage isolation', { skip: !hasRuntime }, async () => {
  const { PGlite } = require(runtime);
  const db = new PGlite();
  const [owner, member, guest, workspace, otherWorkspace, current, secondary, otherSession, invitation] =
    Array.from({ length: 9 }, () => randomUUID());
  const asUser = async (user, session = current) => {
    await db.exec('reset role; set role authenticated');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, session_id: session })]);
  };
  const read = async (sql, params) => (await db.query(sql, params)).rows;
  const config = { name: 'Política sintética', type: 'signature', assuranceLevel: 'standard', privacyConsent: true };

  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      grant usage on schema auth, storage to authenticated;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
      create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
      create table auth.sessions(id uuid primary key, user_id uuid references auth.users, user_agent text,
        created_at timestamptz default now(), updated_at timestamptz default now(), not_after timestamptz);
      create table auth.refresh_tokens(id uuid primary key, session_id uuid references auth.sessions on delete cascade);
      create table public.docubox_session_activity(session_id uuid primary key, user_id uuid, last_user_activity_at timestamptz,
        absolute_expired_at timestamptz, inactivity_expired_at timestamptz);
      create table public.workspaces(id uuid primary key, owner_id uuid, name text, workspace_type text, invite_code text);
      create table public.workspace_members(id uuid default gen_random_uuid() primary key, workspace_id uuid, user_id uuid,
        status text, role text, joined_at timestamptz, access_expires_at timestamptz, unique(workspace_id, user_id));
      create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid);
      alter table public.notifications enable row level security;
      grant select on public.notifications to authenticated;
      create policy read_own on public.notifications for select to authenticated using(user_id = auth.uid());
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant select, insert, delete on storage.objects to authenticated;
      create function storage.foldername(text) returns text[] language sql immutable as $$select regexp_split_to_array($1,'/')$$;
    `);
    await db.exec(migration);
    await db.query('insert into auth.users values($1,now()),($2,now()),($3,now())', [owner, member, guest]);
    await db.query("insert into public.workspaces values($1,$2,'Equipo principal','business','code-A123'),($3,$4,'Otro equipo','business','code-B123')", [workspace, owner, otherWorkspace, guest]);
    await db.query("insert into public.workspace_members (id,workspace_id,user_id,status,role) values($1,$2,$3,'active','member'),($4,$2,$5,'invited','member')", [randomUUID(), workspace, member, invitation, guest]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2),($3,$2),($4,$5)", [current, owner, secondary, otherSession, member]);
    await db.query("insert into auth.refresh_tokens values(gen_random_uuid(), $1)", [secondary]);
    await db.query('insert into public.notifications (user_id, in_app_visible) values ($1,true),($1,false),($2,true)', [owner, member]);

    await asUser(owner);
    assert.equal((await read('select id from public.notifications')).length, 1);
    await db.query("insert into public.workspace_ui_settings values($1,'template_document','{\"showRulers\":true}')", [workspace]);
    const [{ id }] = await read("select id from public.save_docubox_identity_policy($1,null,'draft',$2)", [workspace, config]);
    const [{ version: firstPublished }] = await read("select version from public.save_docubox_identity_policy($1,$2,'active',$3)", [workspace, id, config]);
    assert.equal(firstPublished, 1);
    const [{ version: updated }] = await read("select version from public.save_docubox_identity_policy($1,$2,'draft',$3)", [workspace, id, { ...config, name: 'Edición' }]);
    assert.equal(updated, 2);
    await assert.rejects(read("select id from public.save_docubox_identity_policy($1,$2,'active',$3)", [workspace, id, { ...config, privacyConsent: false }]), /identity_consent_required/);
    assert.deepEqual((await read('select version, status from public.identity_policy_versions order by version')).map(({ status }) => status), ['published', 'draft']);
    assert.equal((await read('select id from public.list_docubox_my_sessions()')).length, 2);
    await assert.rejects(read('select public.revoke_docubox_my_session($1)', [current]), /session_revocation_forbidden/);
    assert.equal((await read('select public.revoke_docubox_my_session($1) as revoked', [otherSession]))[0].revoked, false);
    assert.equal((await read('select public.revoke_docubox_my_session($1) as revoked', [secondary]))[0].revoked, true);
    await db.query("insert into storage.objects(bucket_id,name) values('profile-support-documents',$1)", [`${owner}/comprobante.pdf`]);
    assert.equal((await read("select id from storage.objects where bucket_id='profile-support-documents'")).length, 1);

    await asUser(member, otherSession);
    assert.equal((await read('select value from public.workspace_ui_settings')).length, 1);
    assert.equal((await read('update public.workspace_ui_settings set value=\'{}\' returning kind')).length, 0);
    await assert.rejects(read("select id from public.save_docubox_identity_policy($1,$2,'delete',null)", [workspace, id]), /forbidden/);
    assert.equal((await read('select id from storage.objects')).length, 0);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('profile-support-documents',$1)", [`${owner}/otro.pdf`]), /row-level security/);
    assert.equal((await read('select public.accept_docubox_workspace_membership($1) as accepted', [invitation]))[0].accepted, false);
    await assert.rejects(read('select public.join_docubox_workspace($1,$2)', [member, 'code-B123']), /permission denied/);

    await asUser(guest);
    assert.equal((await read('select id from public.identity_policies')).length, 0);
    assert.equal((await read('select id from public.list_docubox_workspace_invitations()'))[0].id, invitation);
    assert.equal((await read('select public.accept_docubox_workspace_membership($1) as accepted', [invitation]))[0].accepted, true);
    assert.equal((await read('select id from public.list_docubox_workspace_invitations()')).length, 0);
    assert.equal((await read('select id from public.identity_policies')).length, 1);

    await db.exec('reset role; set role service_role');
    await assert.rejects(read('select public.join_docubox_workspace($1,$2)', [member, 'Otro equipo']), /workspace_code_invalid/);
    assert.equal((await read('select public.join_docubox_workspace($1,$2) as name', [member, 'code-B123']))[0].name, 'Otro equipo');
    await db.exec('reset role');
    assert.equal((await read('select id from auth.refresh_tokens')).length, 0);
  } finally {
    await db.close();
  }
});
