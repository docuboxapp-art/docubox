-- Prepare per-user settings while the existing application uses the current catalogs.
create table public.user_catalog_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('document-type','document-tag','contact-tag','case-category','case-type','case-tag')),
  entry_id text not null check (char_length(entry_id) between 1 and 200),
  primary key (user_id, kind, entry_id)
);
alter table public.user_catalog_hidden enable row level security;
revoke all on public.user_catalog_hidden from public, anon, authenticated;
create policy read_own_catalog_visibility on public.user_catalog_hidden for select to authenticated
  using (user_id = (select auth.uid()));
create policy insert_own_catalog_visibility on public.user_catalog_hidden for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy delete_own_catalog_visibility on public.user_catalog_hidden for delete to authenticated
  using (user_id = (select auth.uid()));

create table public.user_catalog_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('contact-tag','case-category','case-type','case-tag')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  group_key text not null default '' check (char_length(group_key) <= 80),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived boolean not null default false
);
create index user_catalog_entries_user on public.user_catalog_entries (user_id);
create unique index user_catalog_entry_active_name on public.user_catalog_entries
  (user_id, kind, lower(btrim(group_key)), lower(btrim(name))) where not archived;
alter table public.user_catalog_entries enable row level security;
revoke all on public.user_catalog_entries from public, anon, authenticated;
create policy manage_own_catalog_entries on public.user_catalog_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
