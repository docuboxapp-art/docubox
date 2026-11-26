import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const runtime = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
const hasRuntime = existsSync(new URL(`${runtime}/package.json`, import.meta.url));
const preparation = await readFile(
  new URL('../supabase/migrations/20261124162838_prepare_profile_privacy.sql', import.meta.url),
  'utf8'
);
const migration = await readFile(
  new URL(
    '../supabase/migrations/20261126074211_activate_profile_privacy_and_communication.sql',
    import.meta.url
  ),
  'utf8'
);

test(
  'profile privacy applies permissions to lookup, requests, visits, blocks and both communication channels',
  {
    skip: !hasRuntime && 'PGlite test runtime not installed',
  },
  async () => {
    const { PGlite } = require(runtime);
    const db = new PGlite();
    const first = async (sql, args) => (await db.query(sql, args)).rows[0];
    const call = async (actor, action, payload = {}) =>
      (
        await first('select public.docubox_profile_privacy($1,$2,$3) as result', [
          actor,
          action,
          payload,
        ])
      ).result;
    const [alice, bob, eve, document, workspace] = Array.from({ length: 5 }, () => randomUUID());
    const settings = (changes) => ({
      scope: 'workspaces',
      fields: {},
      allowContacts: false,
      allowMessages: false,
      allowNotes: false,
      ...changes,
    });
    try {
      await db.exec(
        'create role anon; create role authenticated; create role service_role; create schema auth;' +
          'create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,last_sign_in_at timestamptz);' +
          'create table public.user_profiles(id uuid primary key,email text,full_name text,avatar_url text,' +
          ' phone text,account_type text,personalidad_juridica text,rfc text,curp text,is_active boolean default true,' +
          ' nombre text,apellido_paterno text,apellido_materno text,telefono text,regimen_fiscal text,' +
          ' codigo_postal text,estado text,municipio text,colonia text,localidad text,calle text,num_exterior text,num_interior text,' +
          ' firma_autografa_url text);' +
          'create table public.workspace_members(workspace_id uuid,user_id uuid,status text,access_expires_at timestamptz);' +
          'create table public.contacts(id uuid primary key default gen_random_uuid(),user_id uuid,nombre text,email text,' +
          ' telefono text,created_at timestamptz default now(),unique(user_id,email));' +
          'create table public.documentos(id uuid primary key, owner_id uuid,nombre text,estado text,participantes jsonb,deleted_at timestamptz);' +
          'create table public.document_user_visibility(user_id uuid,document_id uuid,hidden_at timestamptz,trashed_at timestamptz,restored_at timestamptz);' +
          'create function public.try_uuid(text) returns uuid language plpgsql immutable as $f$ begin return $1::uuid; exception when invalid_text_representation then return null; end $f$;' +
          'alter table public.user_profiles enable row level security; grant select on public.user_profiles to authenticated;' +
          'create policy workspace_members_read_shared_profiles on public.user_profiles for select to authenticated using(true);'
      );
      for (const [id, email, firstName] of [
        [alice, 'alice@example.invalid', 'Alicia'],
        [bob, 'bob@example.invalid', 'Bruno'],
        [eve, 'eve@example.invalid', 'Eva'],
      ]) {
        await db.query('insert into auth.users values ($1,$2,now(),now())', [id, email]);
        await db.query(
          "insert into public.user_profiles(id,email,full_name,nombre,apellido_paterno,rfc,calle,firma_autografa_url) values ($1,$2,$3,$4,'Prueba','RFC-DE-PRUEBA','Domicilio de prueba','private-signature')",
          [id, email, firstName + ' Prueba', firstName]
        );
      }
      await db.query(
        "insert into public.documentos(id,owner_id,nombre,estado,participantes) values($1,$2,'Documento de prueba','en_proceso',$3)",
        [
          document,
          alice,
          JSON.stringify([
            {
              user_id: bob,
              email: 'bob@example.invalid',
              nombre: 'Bruno del documento',
              current_access: true,
            },
          ]),
        ]
      );
      await db.exec(preparation);
      await db.exec('set role authenticated');
      assert.equal((await first('select count(*)::int n from public.user_profiles')).n, 3);
      await assert.rejects(first('select * from profile_private.settings'), /permission denied/);
      await db.exec('reset role');
      await first(
        "insert into public.contacts(user_id,nombre,email) values ($1,'Contacto de prueba','eve@example.invalid')",
        [alice]
      );
      await first("delete from public.contacts where email = 'eve@example.invalid'");
      await db.exec(migration);
      assert.equal(
        (
          await first(
            "select has_function_privilege('authenticated','public.docubox_profile_privacy(uuid,text,jsonb)','EXECUTE') p"
          )
        ).p,
        false
      );
      assert.equal(
        (await first("select has_schema_privilege('authenticated','profile_private','USAGE') p")).p,
        false
      );
      assert.equal(
        (
          await first(
            "select count(*)::int n from pg_policies where tablename='user_profiles' and policyname='workspace_members_read_shared_profiles'"
          )
        ).n,
        0
      );
      await db.exec('set role service_role');
      assert.deepEqual(await call(alice, 'settings'), settings({}));
      assert.deepEqual(
        await call(alice, 'search', {
          criterion: 'correo',
          query: 'bob@example.invalid',
          purpose: 'contact',
        }),
        []
      );
      await assert.rejects(call(alice, 'request', { peerId: bob }), /profile_requests_closed/);
      await call(
        bob,
        'save',
        settings({ scope: 'contactos', allowContacts: true, allowNotes: true })
      );
      const [search] = await call(alice, 'search', {
        criterion: 'correo',
        query: 'BOB@example.invalid',
        purpose: 'contact',
      });
      assert.equal(search.id, bob);
      assert.equal(search.email, null);
      assert.equal(search.canView, false);
      assert.equal(search.canRequest, true);
      assert.deepEqual(await call(alice, 'profile', { peerId: bob }), { fields: {} });
      assert.deepEqual(await call(bob, 'visits'), []);
      assert.equal((await call(alice, 'request', { peerId: bob })).status, 'pending');
      assert.equal((await call(alice, 'request', { peerId: bob })).status, 'pending');
      const [pending] = await call(bob, 'requests');
      assert.equal(pending.requester_id, alice);
      assert.equal(pending.name, 'Alicia Prueba');
      assert.equal(pending.email, undefined);
      await assert.rejects(
        call(eve, 'decide', { requestId: pending.id, decision: 'approve' }),
        /profile_unavailable/
      );
      await db.exec('reset role');
      await assert.rejects(
        db.query(
          "insert into public.contacts(user_id,nombre,email) values($1,'No autorizado','bob@example.invalid')",
          [alice]
        ),
        /profile_contact_consent_required/
      );
      await db.exec('set role service_role');
      assert.equal(
        (await call(bob, 'decide', { requestId: pending.id, decision: 'approve' })).status,
        'approved'
      );
      assert.equal(
        (
          await call(alice, 'search', {
            criterion: 'correo',
            query: 'bob@example.invalid',
            purpose: 'contact',
          })
        )[0].canRequest,
        false
      );
      const { fields } = await call(alice, 'profile', { peerId: bob });
      assert.equal(fields.full_name, 'Bruno Prueba');
      assert.equal(fields.rfc, undefined);
      assert.equal(fields.calle, undefined);
      assert.equal(fields.firma_autografa_url, undefined);
      assert.equal((await call(bob, 'visits'))[0].viewer_id, alice);
      await call(
        bob,
        'save',
        settings({
          scope: 'contactos',
          allowContacts: true,
          allowNotes: true,
          fields: { apellido_paterno: 'nadie' },
        })
      );
      assert.equal((await call(alice, 'profile', { peerId: bob })).fields.full_name, undefined);
      assert.equal(
        (
          await call(alice, 'search', {
            criterion: 'rfc',
            query: 'RFC-DE-PRUEBA',
            purpose: 'participant',
          })
        ).some(({ id }) => id === bob),
        false
      );
      await db.exec('reset role');
      const savedContact = await first(
        'select id,email from public.contacts where user_id=$1 and profile_user_id=$2',
        [alice, bob]
      );
      assert.equal(savedContact.email, 'bob@example.invalid');
      await db.query(
        "insert into public.workspace_members values ($1,$2,'active',null),($1,$3,'active',null)",
        [workspace, alice, bob]
      );
      await db.exec('set role service_role');
      assert.equal(
        (await call(alice, 'conversation', { contactId: savedContact.id })).peers[0].notes,
        true
      );
      await call(alice, 'send', {
        contactId: savedContact.id,
        kind: 'note',
        content: 'Nota de prueba',
      });
      await assert.rejects(
        call(alice, 'send', {
          contactId: savedContact.id,
          kind: 'message',
          content: 'Mensaje denegado',
        }),
        /profile_communication_closed/
      );
      await assert.rejects(
        call(eve, 'send', {
          documentId: document,
          peerId: bob,
          kind: 'note',
          content: 'No participa',
        }),
        /profile_unavailable/
      );
      await call(
        bob,
        'save',
        settings({ scope: 'nadie', allowContacts: true, allowMessages: true, allowNotes: true })
      );
      assert.deepEqual(await call(alice, 'profile', { peerId: bob }), { fields: {} });
      const [documentRecipient] = (await call(alice, 'conversation', { documentId: document }))
        .peers;
      assert.equal(documentRecipient.name, 'Bruno del documento');
      assert.equal(documentRecipient.messages, true);
      await call(alice, 'send', {
        documentId: document,
        peerId: bob,
        kind: 'message',
        content: 'Mensaje del documento',
      });
      assert.deepEqual((await call(bob, 'inbox')).messages.map(({ content }) => content).sort(), [
        'Mensaje del documento',
        'Nota de prueba',
      ]);
      assert.deepEqual((await call(eve, 'inbox')).messages, []);
      await call(bob, 'block', { email: 'alice@example.invalid' });
      assert.equal((await call(bob, 'blocks'))[0].blocked_id, alice);
      assert.deepEqual(await call(alice, 'profile', { peerId: bob }), { fields: {} });
      await assert.rejects(
        call(alice, 'send', {
          documentId: document,
          peerId: bob,
          kind: 'message',
          content: 'Bloqueado',
        }),
        /profile_communication_closed/
      );
      assert.equal((await call(bob, 'requests'))[0].status, 'revoked');
      await call(bob, 'unblock', { peerId: alice });
      assert.deepEqual(await call(bob, 'blocks'), []);
      await db.exec('reset role');
      await db.query("update public.documentos set participantes='[]' where id=$1", [document]);
      await db.exec('set role service_role');
      await assert.rejects(
        call(bob, 'conversation', { documentId: document, peerId: alice }),
        /profile_unavailable/
      );
      assert.equal((await call(bob, 'inbox')).messages.length, 1);
    } finally {
      await db.close();
    }
  }
);
