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
const visibilityMigration = await readFile(
  new URL('../supabase/migrations/20261126091328_profile_visibility_modes.sql', import.meta.url),
  'utf8'
);
const sectionsMigration = await readFile(
  new URL('../supabase/migrations/20261126092818_profile_visibility_sections.sql', import.meta.url),
  'utf8'
);
const requestInboxMigration = await readFile(
  new URL(
    '../supabase/migrations/20261126094830_profile_contact_request_inbox.sql',
    import.meta.url
  ),
  'utf8'
);
const requestAgendaMigration = await readFile(
  new URL(
    '../supabase/migrations/20261126102524_profile_contact_request_agenda.sql',
    import.meta.url
  ),
  'utf8'
);
const directContactsMigration = await readFile(
  new URL('../supabase/migrations/20261126105724_profile_direct_contacts.sql', import.meta.url),
  'utf8'
);
const notificationMigrations = await Promise.all(
  [
    '20260507050000_notifications_table.sql',
    '20260903184030_notification_event_core.sql',
    '20261126172215_contact_request_notifications.sql',
  ].map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
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
    const [alice, bob, eve, diana, outsider, document, workspace] = Array.from({ length: 7 }, () =>
      randomUUID()
    );
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

      await call(bob, 'save', settings({ scope: 'cualquiera', fields: { phone: 'nadie' } }));
      await db.exec('reset role');
      await db.exec(visibilityMigration);
      for (const [id, email] of [
        [diana, 'diana@example.invalid'],
        [outsider, 'outsider@example.invalid'],
      ]) {
        await db.query('insert into auth.users values ($1,$2,now(),now())', [id, email]);
        await db.query('insert into public.user_profiles(id,email) values ($1,$2)', [id, email]);
      }
      await db.query("update public.user_profiles set telefono='5550100' where id=$1", [bob]);
      await db.query(
        "insert into public.workspace_members values ($1,$2,'active',null), ($1,$3,'active',null), ($1,$4,'active',null)",
        [workspace, alice, bob, diana]
      );
      await db.query(
        "insert into profile_private.requests(requester_id,recipient_id,requester_name,status) values ($1,$2,'Eva','approved'), ($3,$2,'Diana','approved') on conflict (requester_id,recipient_id) do update set status='approved'",
        [eve, bob, diana]
      );
      assert.equal(
        (
          await first(
            "select has_function_privilege('authenticated','profile_private.visibility_preferences(uuid,text,jsonb)','EXECUTE') allowed"
          )
        ).allowed,
        false
      );
      await db.exec('set role service_role');
      const visible = async (viewer) => (await call(viewer, 'profile', { peerId: bob })).fields;
      const config = (mode, changes) => settings({ mode, ...changes });
      assert.deepEqual(await call(outsider, 'settings_v2'), config('general', {}));
      const legacy = await call(bob, 'settings_v2');
      assert.equal(legacy.mode, 'fields');
      assert.equal(legacy.scope, 'contactos');
      assert.equal(legacy.fields.email, 'contactos');
      assert.equal(legacy.fields.phone, 'nadie');
      assert.deepEqual(await visible(outsider), {});

      const viewers = [alice, eve, diana, outsider];
      for (const [scope, expected] of [
        ['workspaces', [true, false, true, false]],
        ['solo_contactos', [false, true, true, false]],
        ['contactos', [true, true, true, false]],
        ['nadie', [false, false, false, false]],
      ]) {
        await call(bob, 'save_v2', config('general', { scope, fields: { rfc: 'contactos' } }));
        for (const [index, viewer] of viewers.entries()) {
          const fields = await visible(viewer);
          assert.equal(Boolean(fields.email), expected[index], scope);
          assert.equal(fields.rfc, undefined);
        }
      }

      const custom = config('fields', {
        scope: 'nadie',
        fields: { email: 'solo_contactos', phone: 'workspaces', rfc: 'contactos', calle: 'nadie' },
        allowMessages: true,
      });
      await call(bob, 'save_v2', custom);
      assert.deepEqual(await call(bob, 'settings_v2'), custom);
      assert.deepEqual(await visible(alice), { phone: '5550100', rfc: 'RFC-DE-PRUEBA' });
      assert.deepEqual(await visible(eve), { email: 'bob@example.invalid', rfc: 'RFC-DE-PRUEBA' });
      assert.deepEqual(await visible(diana), {
        email: 'bob@example.invalid',
        phone: '5550100',
        rfc: 'RFC-DE-PRUEBA',
      });
      assert.deepEqual(await visible(outsider), {});
      await assert.rejects(call(bob, 'save', settings({})), /profile_privacy_update_required/);
      await assert.rejects(
        call(bob, 'save_v2', config('fields', { fields: { email: 'heredar' } })),
        /profile_invalid_visibility/
      );
      await assert.rejects(
        call(bob, 'save_v2', config('general', { scope: 'cualquiera' })),
        /profile_invalid_visibility/
      );
      await call(bob, 'block', { peerId: diana });
      assert.deepEqual(await visible(diana), {});

      await db.exec('reset role');
      await db.exec(sectionsMigration);
      await db.query(
        "update public.user_profiles set curp='CURP-DE-PRUEBA',account_type='personal' where id=$1",
        [bob]
      );
      await db.exec('set role service_role');
      assert.deepEqual(await call(bob, 'settings_v2'), { ...custom, sections: ['identity'] });
      assert.deepEqual(await visible(eve), { email: 'bob@example.invalid', rfc: 'RFC-DE-PRUEBA' });
      assert.deepEqual((await call(outsider, 'settings_v2')).sections, ['identity']);

      const general = config('general', { scope: 'solo_contactos', fields: custom.fields });
      await call(bob, 'save_v2', { ...general, sections: ['address', 'tax_identity'] });
      assert.deepEqual((await call(bob, 'settings_v2')).sections, ['tax_identity', 'address']);
      const selectedFields = {
        curp: 'CURP-DE-PRUEBA',
        rfc: 'RFC-DE-PRUEBA',
        calle: 'Domicilio de prueba',
      };
      assert.deepEqual(await visible(eve), selectedFields);
      assert.deepEqual(await visible(alice), {});
      assert.deepEqual(await visible(diana), {});

      await call(bob, 'save_v2', { ...general, allowNotes: true });
      assert.deepEqual(await visible(eve), selectedFields);
      await call(bob, 'save_v2', {
        ...general,
        sections: ['identity', 'tax_identity', 'address', 'account'],
      });
      const allFields = await visible(eve);
      assert.equal(allFields.email, 'bob@example.invalid');
      assert.equal(allFields.rfc, 'RFC-DE-PRUEBA');
      assert.equal(allFields.calle, 'Domicilio de prueba');
      assert.equal(allFields.account_type, 'personal');
      assert.equal(allFields.firma_autografa_url, undefined);
      await assert.rejects(
        call(bob, 'save_v2', { ...general, sections: ['signature'] }),
        /profile_invalid_visibility/
      );
      await call(bob, 'save_v2', { ...general, sections: [] });
      assert.deepEqual(await visible(eve), {});
      await call(bob, 'save_v2', custom);
      assert.deepEqual(await visible(eve), { email: 'bob@example.invalid', rfc: 'RFC-DE-PRUEBA' });
      assert.deepEqual((await call(bob, 'settings_v2')).sections, []);

      await db.exec('reset role');
      await db.exec(requestInboxMigration);
      await db.exec(requestAgendaMigration);
      assert.equal(
        (
          await first(
            "select has_function_privilege('authenticated','profile_private.contact_request_inbox(uuid,text,jsonb)','EXECUTE') allowed"
          )
        ).allowed,
        false
      );
      await db.exec('set role service_role');
      const inbox = (actor) => call(actor, 'requests_v2');
      const privateRecipient = config('general', { scope: 'nadie', allowContacts: true });
      await call(outsider, 'save_v2', privateRecipient);
      await assert.rejects(call(diana, 'request', { peerId: bob }), /profile_requests_closed/);
      assert.equal(
        (await call(eve, 'request', { peerId: outsider, emailHint: ' Outsider@EXAMPLE.INVALID ' }))
          .status,
        'pending'
      );
      assert.equal(
        (await call(alice, 'request', { peerId: outsider, emailHint: 'diana@example.invalid' }))
          .status,
        'pending'
      );
      assert.equal(
        (await call(diana, 'register', { name: 'Contacto', email: 'outsider@example.invalid' }))
          .status,
        'pending'
      );
      assert.equal(
        (
          await call(diana, 'register', {
            name: 'Contacto externo',
            email: 'external@example.invalid',
          })
        ).status,
        'saved'
      );
      const incoming = await inbox(outsider);
      assert.equal(incoming.allowContacts, true);
      assert.equal(incoming.sent.length, 0);
      assert.equal(incoming.received.length, 3);
      assert.ok(incoming.received.every((item) => item.status === 'pending' && !('email' in item)));

      const eveInbox = await inbox(eve);
      assert.equal(eveInbox.allowContacts, false);
      assert.deepEqual(eveInbox.received, []);
      const [eveRequest] = eveInbox.sent;
      assert.equal(eveRequest.name, null);
      assert.equal(eveRequest.email, 'outsider@example.invalid');
      assert.equal(eveRequest.contactId, null);
      const [aliceRequest] = (await inbox(alice)).sent;
      assert.equal(aliceRequest.email, null);
      const [dianaRequest] = (await inbox(diana)).sent;
      assert.equal(dianaRequest.email, 'outsider@example.invalid');
      await assert.rejects(
        call(eve, 'decide', { requestId: eveRequest.id, decision: 'approve' }),
        /profile_unavailable/
      );
      await call(outsider, 'decide', { requestId: aliceRequest.id, decision: 'decline' });
      await call(outsider, 'decide', { requestId: eveRequest.id, decision: 'approve' });
      const [declined] = (await inbox(alice)).sent;
      assert.equal(declined.status, 'declined');
      assert.equal(declined.contactId, null);
      const [approved] = (await inbox(eve)).sent;
      assert.equal(approved.status, 'approved');
      assert.match(approved.contactId, /^[a-f0-9-]{36}$/);
      await db.exec('reset role');
      const agendaRow = await first(
        'select email,nombre from public.contacts where id=$1 and user_id=$2 and profile_user_id=$3',
        [approved.contactId, eve, outsider]
      );
      assert.deepEqual(agendaRow, {
        email: 'outsider@example.invalid',
        nombre: 'outsider@example.invalid',
      });
      await db.exec('set role service_role');
      assert.equal((await call(outsider, 'requests')).length, 3);

      await call(outsider, 'save_v2', { ...privateRecipient, allowContacts: false });
      assert.deepEqual(await inbox(outsider), { allowContacts: false, received: [], sent: [] });
      assert.deepEqual((await inbox(eve)).sent, []);
      await assert.rejects(
        call(outsider, 'decide', { requestId: dianaRequest.id, decision: 'approve' }),
        /profile_request_changed/
      );
      await call(outsider, 'save_v2', privateRecipient);
      assert.equal((await inbox(alice)).sent[0].status, 'declined');

      await db.exec('reset role');
      await db.query("update auth.users set email='changed@example.invalid' where id=$1", [
        outsider,
      ]);
      await db.exec('set role service_role');
      await call(outsider, 'decide', { requestId: dianaRequest.id, decision: 'approve' });
      const [approvedAfterEmailChange] = (await inbox(diana)).sent;
      await db.exec('reset role');
      const contactAfterEmailChange = await first(
        'select email from public.contacts where id=$1 and user_id=$2',
        [approvedAfterEmailChange.contactId, diana]
      );
      assert.deepEqual(contactAfterEmailChange, { email: null });
      await db.exec('set role service_role');
      await call(outsider, 'block', { peerId: diana });
      assert.equal((await inbox(outsider)).received.length, 2);
      assert.deepEqual((await inbox(diana)).sent, []);

      await db.exec('reset role');
      await db.exec(directContactsMigration);
      await db.exec(`
        create table public.workspaces(id uuid primary key);
        create function auth.uid() returns uuid language sql stable
          as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        grant usage on schema auth to authenticated;
        create publication supabase_realtime;
      `);
      for (const sql of notificationMigrations) await db.exec(sql);
      const [sender, openContact, privateContact, requiresConsent] = Array.from({ length: 4 }, () =>
        randomUUID()
      );
      for (const [id, email, name] of [
        [sender, 'sender@example.invalid', 'Remitente'],
        [openContact, 'direct@example.invalid', 'Contacto directo'],
        [privateContact, 'private@example.invalid', 'Nombre privado'],
        [requiresConsent, 'consent@example.invalid', 'Contacto con aprobación'],
      ]) {
        await db.query('insert into auth.users values ($1,$2,now(),now())', [id, email]);
        await db.query('insert into public.user_profiles(id,email,full_name) values ($1,$2,$3)', [
          id,
          email,
          name,
        ]);
      }
      await db.query(
        "insert into public.workspace_members values ($1,$2,'active',null), ($1,$3,'active',null), ($1,$4,'active',null)",
        [workspace, sender, openContact, privateContact]
      );
      await db.exec('set role service_role');
      await call(
        privateContact,
        'save_v2',
        config('fields', { fields: { full_name: 'workspaces' } })
      );
      await call(requiresConsent, 'save_v2', privateRecipient);
      const searchContact = (email) =>
        call(sender, 'search', { criterion: 'correo', query: email, purpose: 'contact' });
      const [directResult] = await searchContact('direct@example.invalid');
      assert.equal(directResult.canAddDirectly, true);
      assert.equal(directResult.canRequest, false);
      assert.deepEqual(await searchContact('private@example.invalid'), []);
      assert.deepEqual(
        await call(sender, 'add_contact', {
          peerId: openContact,
          email: 'ignored@example.invalid',
        }),
        { status: 'saved' }
      );
      assert.deepEqual(await call(sender, 'add_contact', { peerId: openContact }), {
        status: 'saved',
      });
      assert.deepEqual(await call(sender, 'add_contact', { email: 'Private@EXAMPLE.INVALID' }), {
        status: 'saved',
      });
      assert.deepEqual(
        await call(sender, 'add_contact', { email: 'external-direct@example.invalid' }),
        {
          status: 'saved',
        }
      );
      assert.deepEqual(
        await call(alice, 'register', {
          name: 'Nombre de mi agenda',
          email: 'private@example.invalid',
        }),
        {
          status: 'saved',
        }
      );
      assert.deepEqual((await inbox(sender)).sent, []);
      const [consentResult] = await searchContact('consent@example.invalid');
      assert.equal(consentResult.canAddDirectly, false);
      assert.equal(consentResult.canRequest, true);
      await assert.rejects(
        call(sender, 'add_contact', { email: 'consent@example.invalid' }),
        /profile_contact_consent_required/
      );
      assert.equal((await call(sender, 'request', { peerId: requiresConsent })).status, 'pending');
      const [receivedRequest] = (await inbox(requiresConsent)).received;
      assert.equal(receivedRequest.status, 'pending');
      assert.equal((await call(sender, 'request', { peerId: requiresConsent })).status, 'pending');
      await db.exec('reset role');
      const noticesFor = async (id) =>
        (await db.query(
          'select user_id, event_type, status, action_url from public.notifications where entity_id=$1 order by event_type',
          [id]
        )).rows;
      const requestsUrl = '/contactos?vista=solicitudes';
      assert.deepEqual(await noticesFor(receivedRequest.id), [{
        user_id: requiresConsent,
        event_type: 'contact.request.received',
        status: 'unread',
        action_url: requestsUrl,
      }]);
      const directRows = (
        await db.query(
          'select nombre,email,profile_user_id from public.contacts where user_id=$1 order by email',
          [sender]
        )
      ).rows;
      assert.deepEqual(directRows, [
        {
          nombre: 'Contacto directo',
          email: 'direct@example.invalid',
          profile_user_id: openContact,
        },
        {
          nombre: 'external-direct@example.invalid',
          email: 'external-direct@example.invalid',
          profile_user_id: null,
        },
        {
          nombre: 'private@example.invalid',
          email: 'private@example.invalid',
          profile_user_id: null,
        },
      ]);
      await assert.rejects(
        db.query('insert into public.contacts (user_id,nombre,email) values ($1,$2,$3)', [
          sender,
          'Sin autorización',
          'consent@example.invalid',
        ]),
        /profile_contact_consent_required/
      );
      await db.exec('set role service_role');
      await call(requiresConsent, 'decide', { requestId: receivedRequest.id, decision: 'approve' });
      assert.equal((await inbox(sender)).sent[0].status, 'approved');
      await assert.rejects(
        call(requiresConsent, 'decide', { requestId: receivedRequest.id, decision: 'approve' }),
        /profile_request_changed/
      );
      await db.exec('reset role');
      assert.deepEqual(await noticesFor(receivedRequest.id), [
        { user_id: sender, event_type: 'contact.request.approved', status: 'unread', action_url: requestsUrl },
        { user_id: requiresConsent, event_type: 'contact.request.received', status: 'read', action_url: requestsUrl },
      ]);
      assert.equal((await first(
        "select count(*)::int as count from public.notification_deliveries where channel = 'in_app' and status = 'delivered'"
      )).count, 2);
      assert.equal((await first(
        "select count(*)::int as count from public.notification_event_log where outcome = 'created'"
      )).count, 2);
      assert.equal((await first(
        "select count(*)::int as count from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'"
      )).count, 1);

      await db.exec('grant select on public.notifications to authenticated; set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sender]);
      assert.deepEqual(
        (await db.query('select event_type from public.notifications')).rows,
        [{ event_type: 'contact.request.approved' }]
      );
      await db.exec('reset role');
      await db.query(
        "insert into public.notification_preferences (user_id,category,in_app_enabled) values ($1,'APPROVAL',false)",
        [requiresConsent]
      );
      await db.exec('set role service_role');
      await call(alice, 'request', { peerId: requiresConsent });
      const [quietRequest] = (await inbox(alice)).sent;
      assert.equal(quietRequest.status, 'pending');
      await db.exec('reset role');
      assert.deepEqual(await noticesFor(quietRequest.id), []);

      await db.exec('set role service_role');
      await call(privateContact, 'block', { peerId: eve });
      await assert.rejects(
        call(eve, 'add_contact', { email: 'private@example.invalid' }),
        /profile_unavailable/
      );
    } finally {
      await db.close();
    }
  }
);
