-- Prepare private profile storage for the coordinated app rollout.
-- Profile settings, contact consent and direct communication are accessed through a
-- service-only RPC. Browser roles cannot query the underlying tables.
create schema profile_private;
revoke all on schema profile_private from public, anon, authenticated;
grant usage on schema profile_private to service_role;

create table profile_private.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scope text not null default 'workspaces' check (scope in ('nadie','workspaces','contactos','cualquiera')),
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  allow_contacts boolean not null default false,
  allow_messages boolean not null default false,
  allow_notes boolean not null default false
);

create table profile_private.requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','declined','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);

create table profile_private.visits (
  profile_id uuid references auth.users(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (profile_id, viewer_id),
  check (profile_id <> viewer_id)
);

create table profile_private.blocks (
  owner_id uuid references auth.users(id) on delete cascade,
  blocked_id uuid references auth.users(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, blocked_id),
  check (owner_id <> blocked_id)
);

create table profile_private.communications (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documentos(id) on delete cascade,
  kind text not null check (kind in ('message','note')),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

alter table profile_private.settings enable row level security;
alter table profile_private.requests enable row level security;
alter table profile_private.visits enable row level security;
alter table profile_private.blocks enable row level security;
alter table profile_private.communications enable row level security;

create index profile_requests_recipient_idx on profile_private.requests(recipient_id, created_at desc);
create index profile_visits_viewer_idx on profile_private.visits(viewer_id);
create index profile_visits_date_idx on profile_private.visits(profile_id, viewed_at desc);
create index profile_blocks_blocked_idx on profile_private.blocks(blocked_id);
create index profile_comms_sender_idx on profile_private.communications(sender_id, created_at desc);
create index profile_comms_recipient_idx on profile_private.communications(recipient_id, created_at desc);
create index profile_comms_document_idx on profile_private.communications(document_id) where document_id is not null;
revoke all on all tables in schema profile_private from public, anon, authenticated, service_role;
