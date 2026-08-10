-- Docubox - Titulos de Credito Digitales / Pagare Electronico (Fase 1)
-- El registro electronico es la fuente de verdad; el PDF es una representacion.

create extension if not exists pgcrypto;
create sequence if not exists public.credit_title_folio_seq start 1;

create table if not exists public.credit_titles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title_type text not null default 'promissory_note' check (title_type in ('promissory_note')),
  internal_uuid uuid not null default gen_random_uuid(),
  folio text,
  public_token text not null,
  status text not null default 'draft' check (status in ('draft','preparing','awaiting_signature','signed','issued','active','partially_paid','overdue','paid','cancelled','voided')),
  flags text[] not null default '{}',
  nominal_amount numeric(20,2) not null check (nominal_amount > 0),
  outstanding_balance numeric(20,2) not null check (outstanding_balance >= 0 and outstanding_balance <= nominal_amount),
  currency text not null default 'MXN' check (char_length(currency) = 3),
  maturity_date date not null,
  current_holder_name text,
  current_holder_party_id uuid,
  source_document_id uuid references public.documentos(id) on delete set null,
  representation_document_id uuid references public.documentos(id) on delete restrict,
  canonical_data jsonb,
  canonical_hash text,
  document_hash text,
  schema_version text not null default '1.0',
  version integer not null default 1 check (version > 0),
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, internal_uuid),
  unique (folio),
  unique (public_token),
  check (folio is not null or status in ('draft','preparing','awaiting_signature','signed')),
  check (canonical_hash is not null or status in ('draft','preparing','awaiting_signature','signed'))
);

create table if not exists public.promissory_notes (
  title_id uuid primary key references public.credit_titles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  note_kind text not null check (note_kind in ('simple','interest','guaranteed','installments','series','contract')),
  principal_amount numeric(20,2) not null check (principal_amount > 0),
  amount_in_words text,
  issue_date date not null,
  issue_place text not null,
  maturity_date date not null,
  payment_place text not null,
  interest_mode text not null default 'none' check (interest_mode in ('none','ordinary','default','both')),
  ordinary_rate numeric(9,4),
  default_rate numeric(9,4),
  interest_terms jsonb not null default '{}'::jsonb,
  installments jsonb not null default '[]'::jsonb,
  linked_references jsonb not null default '{}'::jsonb,
  identity_policy jsonb not null default '{}'::jsonb,
  signature_policy jsonb not null default '{}'::jsonb,
  template_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maturity_date >= issue_date),
  check (ordinary_rate is null or ordinary_rate >= 0),
  check (default_rate is null or default_rate >= 0)
);

create table if not exists public.title_parties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title_id uuid not null references public.credit_titles(id) on delete cascade,
  role text not null check (role in ('subscriber','beneficiary','guarantor','holder','legal_representative')),
  contact_id uuid references public.contacts(id) on delete set null,
  display_name text not null,
  tax_id_masked text,
  email text,
  snapshot jsonb not null default '{}'::jsonb,
  identity_verification_id uuid,
  verification_status text,
  created_at timestamptz not null default now()
);

create unique index if not exists title_parties_single_subscriber_idx on public.title_parties(title_id) where role = 'subscriber';
create unique index if not exists title_parties_single_beneficiary_idx on public.title_parties(title_id) where role = 'beneficiary';

create table if not exists public.title_registry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title_id uuid not null unique references public.credit_titles(id) on delete restrict,
  folio text not null unique,
  internal_uuid uuid not null unique,
  canonical_data jsonb not null,
  canonical_hash text not null,
  registry_hash text not null,
  document_hash text,
  schema_version text not null,
  timestamp_status text not null default 'not_configured' check (timestamp_status in ('not_configured','sandbox','pending','valid','failed')),
  nom151_status text not null default 'not_configured' check (nom151_status in ('not_configured','sandbox','pending','valid','failed')),
  registered_at timestamptz not null default now(),
  registered_by uuid not null references auth.users(id) on delete restrict
);

create table if not exists public.title_holder_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title_id uuid not null references public.credit_titles(id) on delete restrict,
  holder_party_id uuid references public.title_parties(id) on delete restrict,
  holder_name text not null,
  acquired_at timestamptz not null default now(),
  released_at timestamptz,
  acquisition_event_id uuid,
  release_event_id uuid,
  title_version integer not null,
  created_at timestamptz not null default now()
);

create unique index if not exists title_holder_one_current_idx on public.title_holder_history(title_id) where released_at is null;

create table if not exists public.title_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title_id uuid not null references public.credit_titles(id) on delete restrict,
  sequence_no bigint not null,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user','system','public','integration')),
  occurred_at timestamptz not null default now(),
  previous_hash text not null,
  payload_hash text not null,
  event_hash text not null,
  signature text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (title_id, sequence_no),
  unique (title_id, event_hash)
);

create table if not exists public.title_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title_id uuid not null references public.credit_titles(id) on delete restrict,
  evidence_type text not null,
  evidence_hash text not null,
  storage_path text,
  encryption_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.title_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  title_type text not null default 'promissory_note',
  configuration jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.title_portfolios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  currency text not null default 'MXN',
  tags text[] not null default '{}',
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_titles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  portfolio_id uuid not null references public.title_portfolios(id) on delete cascade,
  title_id uuid not null references public.credit_titles(id) on delete restrict,
  added_at timestamptz not null default now(),
  primary key (portfolio_id, title_id)
);

create table if not exists public.credit_title_idempotency (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  entity_id uuid,
  response jsonb,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, operation, idempotency_key)
);

create index if not exists credit_titles_workspace_status_idx on public.credit_titles(workspace_id, status);
create index if not exists credit_titles_workspace_maturity_idx on public.credit_titles(workspace_id, maturity_date);
create index if not exists credit_titles_workspace_folio_idx on public.credit_titles(workspace_id, folio);
create index if not exists title_parties_title_role_idx on public.title_parties(title_id, role);
create index if not exists title_events_title_sequence_idx on public.title_events(title_id, sequence_no);
create index if not exists title_evidence_title_idx on public.title_evidence(title_id, evidence_type);

create or replace function public.credit_title_workspace_access(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.workspace_members wm where wm.workspace_id = target_workspace and wm.user_id = auth.uid());
$$;

create or replace function public.enforce_credit_title_transition()
returns trigger language plpgsql as $$
declare allowed boolean := false;
begin
  if old.status = new.status then return new; end if;
  allowed := case old.status
    when 'draft' then new.status in ('preparing','awaiting_signature','voided')
    when 'preparing' then new.status in ('draft','awaiting_signature','voided')
    when 'awaiting_signature' then new.status in ('signed','cancelled','voided')
    when 'signed' then new.status in ('issued','voided')
    when 'issued' then new.status = 'active'
    when 'active' then new.status in ('partially_paid','overdue','paid','cancelled')
    when 'partially_paid' then new.status in ('overdue','paid','cancelled')
    when 'overdue' then new.status in ('partially_paid','paid','cancelled')
    when 'paid' then new.status = 'cancelled'
    else false
  end;
  if not allowed then raise exception 'Transicion de estado no permitida: % -> %', old.status, new.status using errcode = '23514'; end if;
  return new;
end; $$;

create or replace function public.protect_issued_credit_title()
returns trigger language plpgsql as $$
begin
  if old.status in ('issued','active','partially_paid','overdue','paid','cancelled') and (
    new.internal_uuid is distinct from old.internal_uuid or new.folio is distinct from old.folio or
    new.nominal_amount is distinct from old.nominal_amount or new.currency is distinct from old.currency or
    new.maturity_date is distinct from old.maturity_date or new.canonical_data is distinct from old.canonical_data or
    new.canonical_hash is distinct from old.canonical_hash
  ) then raise exception 'Los datos esenciales de un titulo emitido son inmutables' using errcode = '55000'; end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists credit_titles_transition_guard on public.credit_titles;
create trigger credit_titles_transition_guard before update of status on public.credit_titles for each row execute function public.enforce_credit_title_transition();
drop trigger if exists credit_titles_immutable_guard on public.credit_titles;
create trigger credit_titles_immutable_guard before update on public.credit_titles for each row execute function public.protect_issued_credit_title();

create or replace function public.reject_title_event_mutation()
returns trigger language plpgsql as $$ begin raise exception 'El ledger de evidencias es append-only' using errcode = '55000'; end; $$;
drop trigger if exists title_events_append_only on public.title_events;
create trigger title_events_append_only before update or delete on public.title_events for each row execute function public.reject_title_event_mutation();
drop trigger if exists title_registry_immutable on public.title_registry;
create trigger title_registry_immutable before update or delete on public.title_registry for each row execute function public.reject_title_event_mutation();

create or replace function public.append_credit_title_event(
  p_title_id uuid,
  p_workspace_id uuid,
  p_event_type text,
  p_actor_id uuid,
  p_actor_type text,
  p_metadata jsonb,
  p_ip_address text,
  p_user_agent text
)
returns public.title_events
language plpgsql security definer set search_path = public as $$
declare
  v_event public.title_events;
  v_previous_hash text;
  v_sequence bigint;
  v_payload_hash text;
  v_occurred_at timestamptz := clock_timestamp();
begin
  perform 1 from public.credit_titles where id = p_title_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Titulo no encontrado'; end if;
  select coalesce(max(sequence_no),0)+1, coalesce((array_agg(event_hash order by sequence_no desc))[1],'GENESIS')
    into v_sequence,v_previous_hash from public.title_events where title_id=p_title_id;
  v_payload_hash := encode(digest(convert_to(jsonb_build_object('titleId',p_title_id,'sequence',v_sequence,'eventType',p_event_type,'actorId',p_actor_id,'actorType',p_actor_type,'occurredAt',v_occurred_at,'metadata',coalesce(p_metadata,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  insert into public.title_events(workspace_id,title_id,sequence_no,event_type,actor_id,actor_type,occurred_at,previous_hash,payload_hash,event_hash,metadata,ip_address,user_agent)
  values(p_workspace_id,p_title_id,v_sequence,p_event_type,p_actor_id,coalesce(p_actor_type,'system'),v_occurred_at,v_previous_hash,v_payload_hash,encode(digest(v_previous_hash || v_payload_hash,'sha256'),'hex'),coalesce(p_metadata,'{}'::jsonb),nullif(p_ip_address,'')::inet,p_user_agent)
  returning * into v_event;
  return v_event;
end; $$;

create or replace function public.issue_promissory_note(p_title_id uuid, p_idempotency_key text, p_actor_id uuid)
returns public.credit_titles
language plpgsql security definer set search_path = public as $$
declare
  v_title public.credit_titles;
  v_note public.promissory_notes;
  v_parties jsonb;
  v_canonical jsonb;
  v_hash text;
  v_folio text;
  v_now timestamptz := clock_timestamp();
  v_previous_hash text;
  v_sequence bigint;
  v_payload_hash text;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 12 then raise exception 'Idempotency-Key requerido'; end if;
  select * into v_title from public.credit_titles where id = p_title_id for update;
  if not found then raise exception 'Titulo no encontrado'; end if;
  if not exists(select 1 from public.workspace_members where workspace_id = v_title.workspace_id and user_id = p_actor_id) then raise exception 'Acceso denegado'; end if;
  if exists(select 1 from public.credit_title_idempotency where workspace_id = v_title.workspace_id and operation = 'issue' and idempotency_key = p_idempotency_key and status = 'completed') then return v_title; end if;
  insert into public.credit_title_idempotency(workspace_id,operation,idempotency_key,request_hash,entity_id) values(v_title.workspace_id,'issue',p_idempotency_key,encode(digest(p_title_id::text || p_idempotency_key,'sha256'),'hex'),p_title_id) on conflict do nothing;
  if v_title.status not in ('signed','issued','active') then raise exception 'El titulo debe estar firmado antes de emitirse'; end if;
  if v_title.status in ('issued','active') then return v_title; end if;
  select * into v_note from public.promissory_notes where title_id = p_title_id;
  select coalesce(jsonb_agg(jsonb_build_object('role',role,'name',display_name,'taxId',tax_id_masked) order by role, id),'[]'::jsonb) into v_parties from public.title_parties where title_id = p_title_id;
  v_folio := 'PG-MX-' || extract(year from v_now)::int || '-' || lpad(nextval('public.credit_title_folio_seq')::text,8,'0');
  v_canonical := jsonb_build_object('schema','docubox.promissory-note','schemaVersion',v_title.schema_version,'uuid',v_title.internal_uuid,'folio',v_folio,'titleType',v_title.title_type,'amount',v_title.nominal_amount,'currency',v_title.currency,'issueDate',v_note.issue_date,'issuePlace',v_note.issue_place,'maturityDate',v_note.maturity_date,'paymentPlace',v_note.payment_place,'interestMode',v_note.interest_mode,'parties',v_parties);
  v_hash := encode(digest(convert_to(v_canonical::text,'UTF8'),'sha256'),'hex');
  update public.credit_titles set status='issued',folio=v_folio,canonical_data=v_canonical,canonical_hash=v_hash,issued_at=v_now,updated_by=p_actor_id,version=version+1 where id=p_title_id returning * into v_title;
  insert into public.title_registry(workspace_id,title_id,folio,internal_uuid,canonical_data,canonical_hash,registry_hash,schema_version,registered_at,registered_by) values(v_title.workspace_id,v_title.id,v_folio,v_title.internal_uuid,v_canonical,v_hash,encode(digest(v_hash || v_title.internal_uuid::text || v_now::text,'sha256'),'hex'),v_title.schema_version,v_now,p_actor_id);
  insert into public.title_holder_history(workspace_id,title_id,holder_name,title_version) values(v_title.workspace_id,v_title.id,coalesce(v_title.current_holder_name,'Beneficiario original'),v_title.version);
  select coalesce(max(sequence_no),0)+1, coalesce((array_agg(event_hash order by sequence_no desc))[1],'GENESIS') into v_sequence,v_previous_hash from public.title_events where title_id=p_title_id;
  v_payload_hash := encode(digest(convert_to(jsonb_build_object('folio',v_folio,'canonicalHash',v_hash,'issuedAt',v_now)::text,'UTF8'),'sha256'),'hex');
  insert into public.title_events(workspace_id,title_id,sequence_no,event_type,actor_id,actor_type,occurred_at,previous_hash,payload_hash,event_hash,metadata) values(v_title.workspace_id,p_title_id,v_sequence,'TITLE_ISSUED',p_actor_id,'user',v_now,v_previous_hash,v_payload_hash,encode(digest(v_previous_hash || v_payload_hash,'sha256'),'hex'),jsonb_build_object('folio',v_folio));
  update public.credit_titles set status='active' where id=p_title_id returning * into v_title;
  update public.credit_title_idempotency set status='completed',response=jsonb_build_object('titleId',p_title_id,'folio',v_folio,'canonicalHash',v_hash),updated_at=now() where workspace_id=v_title.workspace_id and operation='issue' and idempotency_key=p_idempotency_key;
  return v_title;
exception when others then
  update public.credit_title_idempotency set status='failed',response=jsonb_build_object('error',sqlerrm),updated_at=now() where entity_id=p_title_id and operation='issue' and idempotency_key=p_idempotency_key;
  raise;
end; $$;

revoke all on function public.append_credit_title_event(uuid,uuid,text,uuid,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.append_credit_title_event(uuid,uuid,text,uuid,text,jsonb,text,text) to service_role;
revoke all on function public.issue_promissory_note(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.issue_promissory_note(uuid,text,uuid) to service_role;

alter table public.credit_titles enable row level security;
alter table public.promissory_notes enable row level security;
alter table public.title_parties enable row level security;
alter table public.title_registry enable row level security;
alter table public.title_holder_history enable row level security;
alter table public.title_events enable row level security;
alter table public.title_evidence enable row level security;
alter table public.title_templates enable row level security;
alter table public.title_portfolios enable row level security;
alter table public.portfolio_titles enable row level security;
alter table public.credit_title_idempotency enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['credit_titles','promissory_notes','title_parties','title_registry','title_holder_history','title_events','title_evidence','title_templates','title_portfolios','portfolio_titles','credit_title_idempotency'] loop
    execute format('drop policy if exists %I_workspace_access on public.%I', table_name, table_name);
    execute format('create policy %I_workspace_access on public.%I for all using (public.credit_title_workspace_access(workspace_id)) with check (public.credit_title_workspace_access(workspace_id))', table_name, table_name);
  end loop;
end $$;

-- Las escrituras del nucleo pasan por servicios de dominio. El cliente solo lee.
do $$
declare table_name text;
begin
  foreach table_name in array array['credit_titles','promissory_notes','title_parties','title_registry','title_holder_history','title_events','title_evidence','credit_title_idempotency'] loop
    execute format('drop policy if exists %I_workspace_access on public.%I', table_name, table_name);
    if table_name <> 'credit_title_idempotency' then
      execute format('create policy %I_workspace_read on public.%I for select using (public.credit_title_workspace_access(workspace_id))', table_name, table_name);
    end if;
  end loop;
end $$;

comment on table public.credit_titles is 'Registro operativo comun para titulos de credito digitales. Fuente de verdad del estado y la identidad del titulo.';
comment on table public.title_registry is 'Snapshot inmutable creado durante la emision transaccional del titulo.';
comment on table public.title_events is 'Ledger append-only con encadenamiento SHA-256 de eventos del titulo.';
comment on function public.issue_promissory_note is 'Emision idempotente y transaccional: fija folio, datos canonicos, hash, registro, tenedor inicial y eventos.';
