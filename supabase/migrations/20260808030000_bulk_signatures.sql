-- Docubox - Firmas Masivas
-- Capa de orquestacion. Los documentos, participantes, firmas y evidencias
-- individuales siguen perteneciendo a los motores existentes de Docubox.

create extension if not exists pgcrypto;

create table if not exists public.bulk_signature_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  campaign_type text not null check (campaign_type in ('multiple_documents','template','shared_document','document_package')),
  source_type text,
  status text not null default 'draft' check (status in ('draft','validating','ready','scheduled','processing','active','partially_completed','completed','completed_with_exceptions','paused','expired','cancelled','closed')),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  folder_id uuid,
  case_id uuid,
  template_id uuid,
  department text,
  tags text[] not null default '{}',
  priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  internal_reference text,
  timezone text not null default 'America/Mexico_City',
  signature_policy jsonb not null default '{}'::jsonb,
  identity_policy jsonb not null default '{}'::jsonb,
  notification_policy jsonb not null default '{}'::jsonb,
  source_configuration jsonb not null default '{}'::jsonb,
  total_items integer not null default 0 check (total_items >= 0),
  completed_items integer not null default 0 check (completed_items >= 0),
  pending_items integer not null default 0 check (pending_items >= 0),
  failed_items integer not null default 0 check (failed_items >= 0),
  participant_count integer not null default 0 check (participant_count >= 0),
  idempotency_key text,
  scheduled_at timestamptz,
  expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  check (completed_items + failed_items <= total_items)
);

create table if not exists public.bulk_campaign_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.bulk_signature_campaigns(id) on delete cascade,
  document_id uuid references public.documentos(id) on delete restrict,
  source_row_id text,
  source_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','validating','generating','ready','queued','sending','sent','viewed','signing','signed','rejected','expired','cancelled','failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  error_code text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, document_id),
  unique (campaign_id, source_row_id)
);

create table if not exists public.bulk_campaign_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.bulk_signature_campaigns(id) on delete cascade,
  file_name text not null,
  storage_path text,
  mime_type text,
  status text not null default 'uploaded' check (status in ('uploaded','mapping','validating','valid','invalid','processed','failed')),
  column_mapping jsonb not null default '{}'::jsonb,
  validation_summary jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bulk_campaign_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.bulk_signature_campaigns(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','partially_completed','failed','cancelled')),
  batch_number integer not null default 1,
  batch_size integer not null default 50 check (batch_size between 1 and 500),
  idempotency_key text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create table if not exists public.bulk_campaign_incidents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.bulk_signature_campaigns(id) on delete cascade,
  campaign_item_id uuid references public.bulk_campaign_items(id) on delete cascade,
  category text not null,
  code text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','investigating','resolved','ignored')),
  message text not null,
  retryable boolean not null default false,
  attempt_count integer not null default 0,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bulk_campaign_manifests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.bulk_signature_campaigns(id) on delete restrict,
  version integer not null default 1,
  status text not null default 'pending' check (status in ('pending','generating','generated','sealed','failed')),
  item_count integer not null default 0,
  manifest_hash text,
  merkle_root text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  sealed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

create table if not exists public.bulk_signing_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.bulk_signature_campaigns(id) on delete restrict,
  signer_user_id uuid not null references auth.users(id) on delete restrict,
  signature_method text not null check (signature_method in ('autograph_otp','efirma','click_sign','biometric')),
  status text not null default 'pending_authorization' check (status in ('pending_authorization','authorized','processing','completed','completed_with_exceptions','expired','cancelled')),
  authorization_hash text,
  expires_at timestamptz not null,
  authorized_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.bulk_signing_session_items (
  session_id uuid not null references public.bulk_signing_sessions(id) on delete cascade,
  campaign_item_id uuid not null references public.bulk_campaign_items(id) on delete restrict,
  document_id uuid not null references public.documentos(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','processing','signed','failed','skipped')),
  signature_id uuid,
  error_message text,
  processed_at timestamptz,
  primary key (session_id, campaign_item_id)
);

create table if not exists public.bulk_campaign_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.bulk_signature_campaigns(id) on delete cascade,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  correlation_id uuid not null,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists bulk_campaigns_workspace_status_idx on public.bulk_signature_campaigns(workspace_id, status, updated_at desc);
create index if not exists bulk_items_campaign_status_idx on public.bulk_campaign_items(campaign_id, status, updated_at desc);
create index if not exists bulk_items_document_idx on public.bulk_campaign_items(document_id) where document_id is not null;
create index if not exists bulk_jobs_ready_idx on public.bulk_campaign_jobs(status, available_at) where status = 'queued';
create index if not exists bulk_incidents_open_idx on public.bulk_campaign_incidents(campaign_id, severity, created_at desc) where status in ('open','investigating');
create index if not exists bulk_events_campaign_idx on public.bulk_campaign_events(campaign_id, occurred_at desc);

create or replace function public.set_bulk_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bulk_campaigns_updated_at on public.bulk_signature_campaigns;
create trigger bulk_campaigns_updated_at before update on public.bulk_signature_campaigns
for each row execute function public.set_bulk_updated_at();
drop trigger if exists bulk_items_updated_at on public.bulk_campaign_items;
create trigger bulk_items_updated_at before update on public.bulk_campaign_items
for each row execute function public.set_bulk_updated_at();
drop trigger if exists bulk_imports_updated_at on public.bulk_campaign_imports;
create trigger bulk_imports_updated_at before update on public.bulk_campaign_imports
for each row execute function public.set_bulk_updated_at();
drop trigger if exists bulk_incidents_updated_at on public.bulk_campaign_incidents;
create trigger bulk_incidents_updated_at before update on public.bulk_campaign_incidents
for each row execute function public.set_bulk_updated_at();

alter table public.bulk_signature_campaigns enable row level security;
alter table public.bulk_campaign_items enable row level security;
alter table public.bulk_campaign_imports enable row level security;
alter table public.bulk_campaign_jobs enable row level security;
alter table public.bulk_campaign_incidents enable row level security;
alter table public.bulk_campaign_manifests enable row level security;
alter table public.bulk_signing_sessions enable row level security;
alter table public.bulk_signing_session_items enable row level security;
alter table public.bulk_campaign_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'bulk_signature_campaigns','bulk_campaign_items','bulk_campaign_imports',
    'bulk_campaign_jobs','bulk_campaign_incidents','bulk_campaign_manifests',
    'bulk_signing_sessions','bulk_campaign_events'
  ] loop
    execute format('drop policy if exists bulk_workspace_members_access on public.%I', table_name);
    execute format(
      'create policy bulk_workspace_members_access on public.%I for all to authenticated using (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid())) with check (exists (select 1 from public.workspace_members wm where wm.workspace_id = %I.workspace_id and wm.user_id = auth.uid()))',
      table_name, table_name, table_name
    );
  end loop;
end $$;

drop policy if exists bulk_signing_session_items_access on public.bulk_signing_session_items;
create policy bulk_signing_session_items_access on public.bulk_signing_session_items
for all to authenticated
using (
  exists (
    select 1 from public.bulk_signing_sessions session
    join public.workspace_members member on member.workspace_id = session.workspace_id
    where session.id = bulk_signing_session_items.session_id and member.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.bulk_signing_sessions session
    join public.workspace_members member on member.workspace_id = session.workspace_id
    where session.id = bulk_signing_session_items.session_id and member.user_id = auth.uid()
  )
);

comment on table public.bulk_signature_campaigns is 'Orquestador de operaciones masivas; no reemplaza al documento Docubox.';
comment on column public.bulk_campaign_items.document_id is 'Referencia al documento normal de Docubox que conserva firma, evidencia y auditoria individual.';
