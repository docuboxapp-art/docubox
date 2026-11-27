import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const runtime = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
const hasRuntime = existsSync(new URL(`${runtime}/package.json`, import.meta.url));
const migration = await readFile(
  new URL(
    '../supabase/migrations/20261124130722_contact_groups_and_memberships.sql',
    import.meta.url
  ),
  'utf8'
);

test(
  'contact groups persist independently, recover old groups and reassign only owned contacts',
  {
    skip: !hasRuntime && 'PGlite test runtime not installed',
  },
  async () => {
    const { PGlite } = require(runtime);
    const db = new PGlite();
    const [alice, bob, aliceContact, secondContact, bobContact] = Array.from(
      { length: 5 },
      randomUUID
    );
    const query = async (sql, params) => (await db.query(sql, params)).rows;
    const asUser = async (user) => {
      await db.exec('reset role; set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    };
    const addLegacy = (contact, user, field, value, time = '2026-10-01') =>
      db.query(
        'insert into public.contact_custom_fields(contact_id,user_id,field_name,field_value,created_at) values ($1,$2,$3,$4,$5)',
        [contact, user, field, value, time]
      );
    const groupId = async (name) =>
      (await query('select id from public.contact_groups where name = $1', [name]))[0]?.id;
    const members = (id) =>
      query(
        'select contact_id from public.contact_group_members where group_id = $1 order by contact_id',
        [id]
      );
    const assign = (group, contact, user) =>
      db.query(
        'insert into public.contact_group_members(group_id,contact_id,user_id) values($1,$2,$3) on conflict do nothing',
        [group, contact, user]
      );
    const removeGroup = (source, target = null) =>
      query('select public.delete_contact_group($1,$2) as deleted', [source, target]);

    try {
      await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table auth.users(id uuid primary key);
      create table public.contacts(id uuid primary key, user_id uuid not null references auth.users(id));
      create table public.contact_custom_fields(
        id uuid primary key default gen_random_uuid(),
        contact_id uuid not null references public.contacts(id) on delete cascade,
        user_id uuid not null references auth.users(id),
        field_name text not null,
        field_value text,
        created_at timestamptz not null default now()
      );
      alter table public.contacts enable row level security;
      alter table public.contact_custom_fields enable row level security;
      grant select on public.contacts to authenticated;
      grant select, insert, update, delete on public.contact_custom_fields to authenticated;
      create policy contacts_own on public.contacts to authenticated using (user_id = auth.uid());
      create policy fields_own on public.contact_custom_fields to authenticated
        using (user_id = auth.uid()) with check (user_id = auth.uid());
    `);
      await db.query('insert into auth.users values ($1),($2)', [alice, bob]);
      await db.query('insert into public.contacts values($1,$2),($3,$2),($4,$5)', [
        aliceContact,
        alice,
        secondContact,
        bobContact,
        bob,
      ]);
      await addLegacy(aliceContact, alice, 'contact_group', '  Proveedores   locales ');
      await addLegacy(aliceContact, alice, 'contact_group', 'proveedores locales', '2026-10-02');
      await addLegacy(aliceContact, alice, 'agenda_history', 'Grupo retirado · Compras · 2025');
      await addLegacy(aliceContact, alice, 'agenda_history', 'Etiqueta retirada · Registro');
      await addLegacy(bobContact, bob, 'contact_group', 'Proveedores locales');
      await db.exec(migration);

      await asUser(bob);
      const foreignGroup = await groupId('Proveedores locales');
      assert.ok(foreignGroup);
      assert.equal(await groupId('Compras · 2025'), undefined);

      await asUser(alice);
      const restoredGroup = await groupId('Compras · 2025');
      const importedGroup = await groupId('Proveedores locales');
      assert.ok(restoredGroup);
      assert.ok(importedGroup);
      assert.notEqual(importedGroup, foreignGroup);
      assert.equal(await groupId('Registro'), undefined);
      assert.deepEqual(await members(restoredGroup), []);
      assert.deepEqual(await members(importedGroup), [{ contact_id: aliceContact }]);
      assert.deepEqual(
        await query(
          "select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as assigned_date from public.contact_group_members where group_id=$1",
          [importedGroup]
        ),
        [{ assigned_date: '2026-10-01' }]
      );

      const [{ id: newGroup }] = await query(
        "insert into public.contact_groups(user_id, name, icon) values($1, 'Equipo', '⭐') returning id",
        [alice]
      );
      assert.deepEqual(await members(newGroup), []);
      await assert.rejects(
        query("insert into public.contact_groups(user_id, name) values($1, ' eqUIPO  ')", [alice]),
        { code: '23505' }
      );
      await assign(newGroup, aliceContact, alice);
      await assign(newGroup, aliceContact, alice);
      assert.deepEqual(await members(newGroup), [{ contact_id: aliceContact }]);
      assert.equal(
        (
          await query(
            "select id from public.contact_custom_fields where field_name='contact_group' and field_value='Equipo'"
          )
        ).length,
        1
      );
      await db.query(
        'delete from public.contact_group_members where group_id=$1 and contact_id=$2',
        [newGroup, aliceContact]
      );
      assert.equal(await groupId('Equipo'), newGroup);
      assert.deepEqual(await members(newGroup), []);
      assert.deepEqual(
        await query('select icon from public.contact_groups where id=$1', [newGroup]),
        [{ icon: '⭐' }]
      );
      await assign(newGroup, aliceContact, alice);
      await query("update public.contact_groups set name='Equipo legal',icon='⚖️' where id=$1", [
        newGroup,
      ]);
      assert.deepEqual(
        await query('select icon from public.contact_groups where id=$1', [newGroup]),
        [{ icon: '⚖️' }]
      );
      assert.equal(
        (
          await query(
            "select id from public.contact_custom_fields where field_name='contact_group' and field_value='Equipo legal'"
          )
        ).length,
        1
      );

      await addLegacy(secondContact, alice, 'contact_group', '  Equipo  LEGAL ');
      assert.equal((await members(newGroup)).length, 2);
      await assert.rejects(assign(newGroup, bobContact, alice), { code: '23503' });
      await assert.rejects(removeGroup(newGroup, foreignGroup), { code: 'P0002' });
      await assert.rejects(removeGroup(foreignGroup), { code: 'P0002' });
      assert.equal((await members(newGroup)).length, 2);
      await assign(restoredGroup, aliceContact, alice);
      assert.deepEqual(await removeGroup(newGroup, restoredGroup), [{ deleted: true }]);
      assert.equal(await groupId('Equipo legal'), undefined);
      assert.deepEqual(
        await members(restoredGroup),
        [aliceContact, secondContact].sort().map((contact_id) => ({ contact_id }))
      );
      assert.equal(
        (
          await query(
            "select id from public.contact_custom_fields where field_name='contact_group' and public.contact_group_name_key(field_value)='equipo legal'"
          )
        ).length,
        0
      );
      assert.deepEqual(await removeGroup(restoredGroup), [{ deleted: true }]);
      assert.deepEqual(await members(restoredGroup), []);
      assert.equal((await query('select id from public.contacts')).length, 2);
      assert.equal((await members(importedGroup)).length, 1);

      await db.query(
        "delete from public.contact_custom_fields where field_name='contact_group' and field_value='proveedores locales'"
      );
      assert.equal((await members(importedGroup)).length, 1);
      await db.query(
        "delete from public.contact_custom_fields where field_name='contact_group' and public.contact_group_name_key(field_value)='proveedores locales'"
      );
      assert.equal(await groupId('Proveedores locales'), importedGroup);
      assert.deepEqual(await members(importedGroup), []);
      await asUser(bob);
      assert.deepEqual(await members(foreignGroup), [{ contact_id: bobContact }]);
    } finally {
      await db.close();
    }
  }
);
