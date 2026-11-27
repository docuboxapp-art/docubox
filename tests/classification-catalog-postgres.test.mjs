import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const runtime = '../.tmp/colabora-db-qa/node_modules/@electric-sql/pglite';
const available = existsSync(new URL(`${runtime}/package.json`, import.meta.url));
const preparation = await readFile(
  new URL(
    '../supabase/migrations/20261124162840_prepare_personal_classification_catalog.sql',
    import.meta.url
  ),
  'utf8'
);
const migration = await readFile(
  new URL(
    '../supabase/migrations/20261126060339_activate_scoped_document_catalog.sql',
    import.meta.url
  ),
  'utf8'
);
const preferences = await readFile(
  new URL(
    '../supabase/migrations/20261124212938_activate_personal_catalog_preferences.sql',
    import.meta.url
  ),
  'utf8'
);
test(
  'catalog preferences are private and assigned classifications survive deletion',
  {
    skip: !available && 'PGlite test runtime not installed',
  },
  async () => {
    const { PGlite } = require(runtime);
    const db = new PGlite();
    const [
      alice,
      bob,
      group,
      defaultType,
      defaultTag,
      customType,
      customTag,
      contact,
      otherContact,
      caseTag,
      type,
      version,
    ] = Array.from({ length: 12 }, randomUUID);
    const query = async (sql, params) => (await db.query(sql, params)).rows;
    const asUser = async (user) => {
      await db.exec('reset role; set role authenticated');
      await query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    };
    try {
      await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.grupo_tipo_documento(
        id uuid primary key default gen_random_uuid(), nombre text not null unique,
        orden integer not null default 0
      );
      create table public.tipo_documento(
        id uuid primary key default gen_random_uuid(),
        grupo_id uuid not null references public.grupo_tipo_documento(id),
        nombre text not null
      );
      create unique index idx_tipo_documento_grupo_nombre on public.tipo_documento(grupo_id,nombre);
      create table public.etiquetas(
        id uuid primary key default gen_random_uuid(), nombre text not null unique,
        color text not null default '#6b7280'
      );
      create table public.plantillas(
        tipo_documento_id uuid references public.tipo_documento(id),
        grupo_tipo_id uuid references public.grupo_tipo_documento(id)
      );
      create table public.contacts(
        id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
        etiqueta_rol text, tags text[] default array[]::text[]
      );
      create table public.case_file_template_versions(id uuid primary key, template_id uuid, snapshot jsonb);
      create table public.case_files(
        id uuid primary key default gen_random_uuid(), template_version_id uuid, template_id uuid,
        tags text[] not null default array[]::text[]
      );
      alter table public.tipo_documento enable row level security;
      alter table public.etiquetas enable row level security;
      alter table public.contacts enable row level security;
      create policy public_read_tipo_documento on public.tipo_documento for select to authenticated using(true);
      create policy public_read_etiquetas on public.etiquetas for select to authenticated using(true);
      grant select on public.tipo_documento, public.etiquetas to authenticated;
      create policy contacts_owner on public.contacts to authenticated using(user_id = auth.uid());
      grant select, update on public.contacts to authenticated;
    `);
      await query('insert into auth.users values ($1),($2)', [alice, bob]);
      await query('insert into public.grupo_tipo_documento (id,nombre,orden) values ($1,$2,1)', [
        group, 'Legales',
      ]);
      await query('insert into public.tipo_documento (id,grupo_id,nombre) values ($1,$2,$3)', [
        defaultType,
        group,
        'Contrato',
      ]);
      await query('insert into public.etiquetas (id,nombre) values ($1,$2)', [
        defaultTag,
        'Revisión',
      ]);
      await query(
        'insert into public.contacts(id,user_id,etiqueta_rol) values ($1,$2,$3),($4,$5,null)',
        [contact, alice, 'Cliente', otherContact, bob]
      );
      await db.exec(preparation);
      await asUser(alice);
      assert.equal((await query('select nombre from public.tipo_documento'))[0].nombre, 'Contrato');
      assert.equal((await query('select nombre from public.etiquetas'))[0].nombre, 'Revisión');
      await assert.rejects(query('select * from public.user_catalog_hidden'), /permission denied/);
      await assert.rejects(query('select * from public.user_catalog_entries'), /permission denied/);
      await db.exec('reset role');

      await db.exec(preferences);
      await asUser(alice);
      assert.deepEqual(await query('select nombre from public.tipo_documento'), [
        { nombre: 'Contrato' },
      ]);
      assert.deepEqual(await query('select nombre from public.etiquetas'), [
        { nombre: 'Revisión' },
      ]);
      await assert.rejects(
        query('select catalog_owner_id from public.etiquetas'),
        /does not exist/
      );
      await query(
        "insert into public.user_catalog_hidden values ($1,'contact-tag','Tipo:Cliente')",
        [alice]
      );
      await query(
        "insert into public.user_catalog_entries (user_id,kind,name,group_key) values ($1,'contact-tag','Catálogo previo','Seguimiento')",
        [alice]
      );
      assert.equal((await query('select entry_id from public.user_catalog_hidden')).length, 1);
      assert.equal((await query('select id from public.user_catalog_entries')).length, 1);
      await asUser(bob);
      assert.deepEqual(await query('select entry_id from public.user_catalog_hidden'), []);
      assert.deepEqual(await query('select id from public.user_catalog_entries'), []);
      await asUser(alice);
      await query("delete from public.user_catalog_hidden where kind='contact-tag'");
      await query(
        "insert into public.user_catalog_hidden values ($1,'document-type',$2),($1,'document-tag',$3)",
        [alice, defaultType, defaultTag]
      );
      await db.exec('reset role');

      await db.exec(`begin;\n${migration}\ncommit;`);

      await asUser(alice);
      assert.deepEqual(await query('select kind from public.user_catalog_hidden order by kind'), [
        { kind: 'document-tag' },
        { kind: 'document-type' },
        { kind: 'form-tag' },
        { kind: 'form-type' },
        { kind: 'template-tag' },
        { kind: 'template-type' },
      ]);
      await query("delete from public.user_catalog_hidden where kind='document-type'");
      assert.deepEqual(
        await query("select kind from public.user_catalog_hidden where kind in ('form-type','template-type') order by kind"),
        [{ kind: 'form-type' }, { kind: 'template-type' }]
      );
      const [personalType] = await query(
        'insert into public.tipo_documento (grupo_id,nombre,catalog_owner_id) values ($1,$2,$3) returning id',
        [group, 'Contrato QA', alice]
      );
      const [personalTag] = await query(
        'insert into public.etiquetas (nombre,color,catalog_owner_id) values ($1,$2,$3) returning id',
        ['Etiqueta QA', '#047857', alice]
      );
      assert.equal((await query('select id from public.tipo_documento')).length, 2);
      assert.equal(
        (
          await query('update public.tipo_documento set nombre=$1 where id=$2 returning id', [
            'Sistema cambiado',
            defaultType,
          ])
        ).length,
        0
      );
      await assert.rejects(
        query('insert into public.etiquetas (nombre,color,catalog_owner_id) values ($1,$2,$3)', [
          'Ajena',
          '#047857',
          bob,
        ]),
        /row-level security/
      );
      const [contactLabel] = await query(
        "insert into public.user_catalog_entries (user_id,kind,name,group_key,color) values ($1,'contact-tag',$2,$3,$4) returning id",
        [alice, 'Proyecto A', 'Seguimiento', '#b45309']
      );
      assert.equal(
        (
          await query('select public.set_contact_catalog_tag($1,$2,false) as accepted', [
            otherContact,
            'Otro grupo: Etiqueta',
          ])
        )[0].accepted,
        false
      );
      await query('select public.set_contact_catalog_tag($1,$2,false)', [
        contact,
        'Seguimiento: Proyecto A',
      ]);
      await query('select public.set_contact_catalog_tag($1,$2,false)', [
        contact,
        'Seguimiento: Proyecto A',
      ]);
      await query('update public.user_catalog_entries set name=$1 where id=$2', [
        'Proyecto B',
        contactLabel.id,
      ]);
      await query('update public.user_catalog_entries set archived=true where id=$1', [
        contactLabel.id,
      ]);
      assert.deepEqual(
        (await query('select tags from public.contacts where id=$1', [contact]))[0].tags,
        ['Seguimiento: Proyecto B']
      );
      await query('select public.set_contact_catalog_tag($1,$2,true)', [contact, 'Tipo: Cliente']);
      assert.equal(
        (await query('select etiqueta_rol from public.contacts where id=$1', [contact]))[0]
          .etiqueta_rol,
        null
      );

      await asUser(bob);
      assert.deepEqual(await query('select id from public.tipo_documento'), [{ id: defaultType }]);
      assert.deepEqual(await query('select id from public.etiquetas'), [{ id: defaultTag }]);
      assert.deepEqual(await query('select entry_id from public.user_catalog_hidden'), []);
      assert.deepEqual(await query('select id from public.user_catalog_entries'), []);
      assert.deepEqual(
        await query('update public.etiquetas set catalog_archived=true where id=$1 returning id', [
          personalTag.id,
        ]),
        []
      );

      await asUser(alice);
      await query('update public.tipo_documento set catalog_archived=true where id=$1', [
        personalType.id,
      ]);
      assert.equal(
        (
          await query('select catalog_archived from public.tipo_documento where id=$1', [
            personalType.id,
          ])
        )[0].catalog_archived,
        true
      );
      const [templateGroup] = await query(
        "insert into public.grupo_tipo_documento (nombre,orden,catalog_owner_id,catalog_scope) values ('Proyectos',1000,$1,'template') returning id",
        [alice]
      );
      await query(
        "insert into public.grupo_tipo_documento (nombre,catalog_owner_id,catalog_scope) values ('Proyectos',$1,'form')",
        [alice]
      );
      await assert.rejects(
        query("insert into public.grupo_tipo_documento (nombre,catalog_owner_id,catalog_scope) values (' proyectos ',$1,'template')", [alice]),
        /duplicate key/
      );
      const [templateType] = await query(
        "insert into public.tipo_documento (grupo_id,nombre,catalog_owner_id,catalog_scope) values ($1,'Convenio QA',$2,'template') returning id",
        [templateGroup.id, alice]
      );
      await assert.rejects(
        query("insert into public.tipo_documento (grupo_id,nombre,catalog_owner_id,catalog_scope) values ($1,'Otro tipo',$2,'form')", [templateGroup.id, alice]),
        /row-level security/
      );
      await query(
        "insert into public.tipo_documento (grupo_id,nombre,catalog_owner_id,catalog_scope) values ($1,'Registro QA',$2,'form'),($1,'Registro QA',$2,'document')",
        [group, alice]
      );
      await query(
        "insert into public.etiquetas (nombre,catalog_owner_id,catalog_scope) values ('Revisar',$1,'form'),('Revisar',$1,'template')",
        [alice]
      );
      await query(
        "insert into public.user_catalog_hidden values ($1,'template-group',$2)",
        [alice, group]
      );
      assert.deepEqual(await query("select kind from public.user_catalog_hidden where kind='template-group'"), [
        { kind: 'template-group' },
      ]);
      await db.exec('reset role');
      await query('insert into public.plantillas values ($1,$2)', [templateType.id, templateGroup.id]);
      await asUser(alice);
      await query('update public.grupo_tipo_documento set catalog_archived=true where id=$1', [templateGroup.id]);
      await assert.rejects(
        query("insert into public.tipo_documento (grupo_id,nombre,catalog_owner_id,catalog_scope) values ($1,'Grupo archivado',$2,'template')", [templateGroup.id, alice]),
        /row-level security/
      );
      await asUser(bob);
      assert.deepEqual(await query('select id from public.grupo_tipo_documento'), [{ id: group }]);
      assert.deepEqual(await query('select id from public.tipo_documento'), [{ id: defaultType }]);
      assert.deepEqual(await query('select id from public.etiquetas'), [{ id: defaultTag }]);
      assert.deepEqual(await query('select kind from public.user_catalog_hidden'), []);
      await assert.rejects(
        query("insert into public.tipo_documento (grupo_id,nombre,catalog_owner_id,catalog_scope) values ($1,'Grupo ajeno',$2,'template')", [templateGroup.id, bob]),
        /row-level security/
      );
      await db.exec('reset role; set role anon');
      assert.deepEqual(await query('select id from public.grupo_tipo_documento'), [{ id: group }]);
      assert.deepEqual(await query('select id from public.tipo_documento'), [{ id: defaultType }]);
      assert.deepEqual(await query('select id from public.etiquetas'), [{ id: defaultTag }]);
      await db.exec('reset role; set role service_role');
      assert.deepEqual(await query('select id from public.grupo_tipo_documento'), [{ id: group }]);
      assert.deepEqual(await query('select id from public.tipo_documento'), [{ id: defaultType }]);
      assert.deepEqual(await query('select id from public.etiquetas'), [{ id: defaultTag }]);
      await db.exec('reset role');
      assert.deepEqual(await query('select * from public.plantillas'), [
        { tipo_documento_id: templateType.id, grupo_tipo_id: templateGroup.id },
      ]);
      const newcomer = randomUUID();
      await query('insert into auth.users values ($1)', [newcomer]);
      await asUser(newcomer);
      assert.deepEqual(await query('select id from public.grupo_tipo_documento'), [{ id: group }]);
      assert.deepEqual(await query('select id from public.tipo_documento'), [{ id: defaultType }]);
      assert.deepEqual(await query('select kind from public.user_catalog_hidden'), []);
      await db.exec('reset role');
      await query('delete from auth.users where id=$1', [alice]);
      await asUser(bob);
      assert.deepEqual(await query('select id from public.etiquetas'), [{ id: defaultTag }]);
      assert.deepEqual(await query('select id from public.grupo_tipo_documento'), [{ id: group }]);

      await db.exec('reset role');
      await query('insert into public.case_file_template_versions values ($1,$2,$3)', [
        version,
        type,
        {
          requirements_schema: {
            catalogTags: [
              { id: caseTag, nombre: 'Aprobación inicial' },
              { id: customTag, nombre: 'Aprobación inicial' },
              { id: customType, nombre: 'Seguimiento técnico' },
            ],
          },
        },
      ]);
      const row = (
        await query(
          'insert into public.case_files (template_version_id,template_id) values ($1,$2) returning tags',
          [version, type]
        )
      )[0];
      assert.deepEqual(row.tags, ['Aprobación inicial', 'Seguimiento técnico']);
    } finally {
      await db.close();
    }
  }
);
