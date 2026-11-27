-- Enable personal catalogs and protect legacy readers in the same transaction.
set local lock_timeout = '3s';

revoke insert, update, delete on public.grupo_tipo_documento, public.tipo_documento,
  public.etiquetas from public, anon, authenticated;

-- Keep existing IDs and assignments.
alter table public.tipo_documento
  add column catalog_owner_id uuid references auth.users(id) on delete set null,
  add column catalog_archived boolean not null default false;
alter table public.etiquetas
  add column catalog_owner_id uuid references auth.users(id) on delete set null,
  add column catalog_archived boolean not null default false;

-- A deleted owner's catalog rows must not become public system entries.
create function public.archive_orphaned_catalog_entry()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.catalog_owner_id is not null and new.catalog_owner_id is null then
    new.catalog_archived := true;
  end if;
  return new;
end;
$$;
create trigger archive_orphaned_document_type before update of catalog_owner_id
  on public.tipo_documento for each row execute function public.archive_orphaned_catalog_entry();
create trigger archive_orphaned_document_tag before update of catalog_owner_id
  on public.etiquetas for each row execute function public.archive_orphaned_catalog_entry();

drop index public.idx_tipo_documento_grupo_nombre;
alter table public.etiquetas drop constraint etiquetas_nombre_key;
create unique index document_catalog_system_type_name
  on public.tipo_documento (grupo_id, nombre) where catalog_owner_id is null and not catalog_archived;
create unique index document_catalog_system_tag_name
  on public.etiquetas (nombre) where catalog_owner_id is null and not catalog_archived;

drop policy if exists "authenticated_read_tipo_documento" on public.tipo_documento;
drop policy if exists "public_read_tipo_documento" on public.tipo_documento;
drop policy if exists "authenticated_read_etiquetas" on public.etiquetas;
drop policy if exists "public_read_etiquetas" on public.etiquetas;
drop policy if exists "authenticated_manage_etiquetas" on public.etiquetas;
create policy document_type_catalog_read on public.tipo_documento for select to authenticated
  using ((catalog_owner_id is null and not catalog_archived) or catalog_owner_id = (select auth.uid()));
create policy document_tag_catalog_read on public.etiquetas for select to authenticated
  using ((catalog_owner_id is null and not catalog_archived) or catalog_owner_id = (select auth.uid()));
create policy document_tag_catalog_insert on public.etiquetas for insert to authenticated
  with check (catalog_owner_id = (select auth.uid()) and not catalog_archived);
create policy document_type_catalog_update on public.tipo_documento for update to authenticated
  using (catalog_owner_id = (select auth.uid())) with check (catalog_owner_id = (select auth.uid()));
create policy document_tag_catalog_update on public.etiquetas for update to authenticated
  using (catalog_owner_id = (select auth.uid())) with check (catalog_owner_id = (select auth.uid()));
alter table public.tipo_documento add constraint personal_document_type_name_check
  check (catalog_owner_id is null or char_length(btrim(nombre)) between 1 and 80);
alter table public.etiquetas add constraint personal_document_tag_check
  check (catalog_owner_id is null or
    (char_length(btrim(nombre)) between 1 and 80 and color ~ '^#[0-9a-fA-F]{6}$'));

-- Keep the existing shared options and IDs used by documents, forms and templates.
alter table public.grupo_tipo_documento
  add column catalog_owner_id uuid references auth.users(id) on delete set null,
  add column catalog_archived boolean not null default false,
  add column catalog_scope text check (catalog_scope in ('document', 'form', 'template')),
  add constraint personal_document_group_name_check
    check (catalog_owner_id is null or char_length(btrim(nombre)) between 1 and 80);

alter table public.tipo_documento
  add column catalog_scope text check (catalog_scope in ('document', 'form', 'template'));
alter table public.etiquetas
  add column catalog_scope text check (catalog_scope in ('document', 'form', 'template'));

create trigger archive_orphaned_document_group before update of catalog_owner_id
  on public.grupo_tipo_documento for each row execute function public.archive_orphaned_catalog_entry();

alter table public.grupo_tipo_documento drop constraint grupo_tipo_documento_nombre_key;
create unique index document_catalog_system_group_name
  on public.grupo_tipo_documento (nombre) where catalog_owner_id is null and not catalog_archived;
create unique index document_catalog_personal_group_name
  on public.grupo_tipo_documento (catalog_owner_id, catalog_scope, lower(btrim(nombre)))
  where catalog_owner_id is not null and not catalog_archived;

create unique index document_catalog_personal_type_name
  on public.tipo_documento (catalog_owner_id, coalesce(catalog_scope, ''), grupo_id, lower(btrim(nombre)))
  where catalog_owner_id is not null and not catalog_archived;
create unique index document_catalog_personal_tag_name
  on public.etiquetas (catalog_owner_id, coalesce(catalog_scope, ''), lower(btrim(nombre)))
  where catalog_owner_id is not null and not catalog_archived;

alter table public.grupo_tipo_documento enable row level security;
drop policy if exists authenticated_read_grupo_tipo_documento on public.grupo_tipo_documento;
drop policy if exists public_read_grupo_tipo_documento on public.grupo_tipo_documento;
create policy document_group_catalog_read on public.grupo_tipo_documento for select to authenticated
  using ((catalog_owner_id is null and not catalog_archived) or catalog_owner_id = (select auth.uid()));
create policy document_group_catalog_insert on public.grupo_tipo_documento for insert to authenticated
  with check (catalog_owner_id = (select auth.uid()) and catalog_scope is not null and not catalog_archived);
create policy document_group_catalog_update on public.grupo_tipo_documento for update to authenticated
  using (catalog_owner_id = (select auth.uid())) with check (catalog_owner_id = (select auth.uid()));

create policy document_group_catalog_defaults on public.grupo_tipo_documento for select to anon
  using (catalog_owner_id is null and not catalog_archived);
create policy document_type_catalog_defaults on public.tipo_documento for select to anon
  using (catalog_owner_id is null and not catalog_archived);
create policy document_tag_catalog_defaults on public.etiquetas for select to anon
  using (catalog_owner_id is null and not catalog_archived);

create policy document_type_catalog_insert on public.tipo_documento for insert to authenticated with check (
  catalog_owner_id = (select auth.uid()) and not catalog_archived and exists (
    select 1 from public.grupo_tipo_documento as parent
    where parent.id = tipo_documento.grupo_id and not parent.catalog_archived
      and (parent.catalog_owner_id is null or parent.catalog_owner_id = (select auth.uid()))
      and (parent.catalog_scope is null or parent.catalog_scope = tipo_documento.catalog_scope)
  )
);

alter table public.user_catalog_hidden drop constraint user_catalog_hidden_kind_check;
alter table public.user_catalog_hidden add constraint user_catalog_hidden_kind_check check (kind in (
  'contact-tag', 'case-category', 'case-type', 'case-tag',
  'document-group', 'document-type', 'document-tag',
  'form-group', 'form-type', 'form-tag',
  'template-group', 'template-type', 'template-tag'
));

-- Existing hides applied to all three selectors before these catalogs were separated.
insert into public.user_catalog_hidden (user_id, kind, entry_id)
select preference.user_id, scope.new_kind, preference.entry_id
from public.user_catalog_hidden as preference
join (values
  ('document-type', 'form-type'),
  ('document-type', 'template-type'),
  ('document-tag', 'form-tag'),
  ('document-tag', 'template-tag')
) as scope(old_kind, new_kind) on scope.old_kind = preference.kind
on conflict (user_id, kind, entry_id) do nothing;

-- Older deployments still read the catalogs with service_role, which bypasses RLS.
-- Keep their REST resources at the same names and return shared options to the service role.
-- Renaming the underlying tables preserves the IDs and existing foreign keys.
alter table public.grupo_tipo_documento rename to document_catalog_groups;
alter table public.tipo_documento rename to document_catalog_types;
alter table public.etiquetas rename to document_catalog_tags;

create view public.grupo_tipo_documento with (security_invoker = true, security_barrier = true) as
select * from public.document_catalog_groups
where (catalog_owner_id is null and not catalog_archived)
   or (current_user = 'authenticated' and catalog_owner_id = (select auth.uid()))
with local check option;

create view public.tipo_documento with (security_invoker = true, security_barrier = true) as
select * from public.document_catalog_types
where (catalog_owner_id is null and not catalog_archived)
   or (current_user = 'authenticated' and catalog_owner_id = (select auth.uid()))
with local check option;

create view public.etiquetas with (security_invoker = true, security_barrier = true) as
select * from public.document_catalog_tags
where (catalog_owner_id is null and not catalog_archived)
   or (current_user = 'authenticated' and catalog_owner_id = (select auth.uid()))
with local check option;

revoke all on public.grupo_tipo_documento, public.tipo_documento, public.etiquetas
  from public, anon, authenticated, service_role;
grant select on public.grupo_tipo_documento, public.tipo_documento, public.etiquetas
  to anon, authenticated, service_role;
grant select on public.document_catalog_groups, public.document_catalog_types,
  public.document_catalog_tags to anon, authenticated, service_role;
grant insert (nombre, orden, catalog_owner_id, catalog_scope), update (nombre, catalog_archived)
  on public.grupo_tipo_documento, public.document_catalog_groups to authenticated;
grant insert (nombre, grupo_id, catalog_owner_id, catalog_scope), update (nombre, catalog_archived)
  on public.tipo_documento, public.document_catalog_types to authenticated;
grant insert (nombre, color, catalog_owner_id, catalog_scope), update (nombre, color, catalog_archived)
  on public.etiquetas, public.document_catalog_tags to authenticated;

notify pgrst, 'reload schema';
