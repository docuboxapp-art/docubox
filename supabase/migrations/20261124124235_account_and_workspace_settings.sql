alter table public.notifications add column if not exists in_app_visible boolean not null default true;
create policy docubox_notifications_visible_in_app on public.notifications
  as restrictive for select to authenticated using (in_app_visible);

create schema if not exists docubox_settings_private;
revoke all on schema docubox_settings_private from public, anon, authenticated;
grant usage on schema docubox_settings_private to authenticated;

create function docubox_settings_private.can_read_workspace(p_workspace uuid, p_manage boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w where w.id = p_workspace and w.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = (select auth.uid()) and m.status = 'active'
      and (m.access_expires_at is null or m.access_expires_at > now())
      and (not p_manage or m.role in ('owner', 'admin'))
  )
$$;
revoke all on function docubox_settings_private.can_read_workspace(uuid, boolean) from public;
grant execute on function docubox_settings_private.can_read_workspace(uuid, boolean) to authenticated;

create table public.workspace_ui_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('template_document', 'regional')),
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 720000),
  primary key (workspace_id, kind)
);

alter table public.workspace_ui_settings enable row level security;
revoke all on table public.workspace_ui_settings from public, anon, authenticated;
grant select, insert, update on table public.workspace_ui_settings to authenticated;
create policy workspace_ui_settings_read on public.workspace_ui_settings for select to authenticated
  using (docubox_settings_private.can_read_workspace(workspace_id, false));
create policy workspace_ui_settings_insert on public.workspace_ui_settings for insert to authenticated
  with check (docubox_settings_private.can_read_workspace(workspace_id, true));
create policy workspace_ui_settings_update on public.workspace_ui_settings for update to authenticated
  using (docubox_settings_private.can_read_workspace(workspace_id, true))
  with check (docubox_settings_private.can_read_workspace(workspace_id, true));

create table if not exists public.identity_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  policy_type text not null check (policy_type in ('signature', 'kyc', 'kyb', 'enrollment', 'revalidation')),
  assurance_level text not null check (assurance_level in ('basic', 'standard', 'enhanced', 'custom')),
  current_version integer not null default 1 check (current_version > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.identity_policy_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  policy_id uuid not null references public.identity_policies(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'published', 'superseded')),
  config jsonb not null default '{}',
  config_hash text,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (policy_id, version)
);
create index if not exists identity_policies_settings_lookup on public.identity_policies(workspace_id, updated_at desc);
alter table public.identity_policies enable row level security;
alter table public.identity_policy_versions enable row level security;
revoke all on public.identity_policies, public.identity_policy_versions from public, anon, authenticated;
grant select on public.identity_policies, public.identity_policy_versions to authenticated;
drop policy if exists identity_workspace_isolation on public.identity_policies;
drop policy if exists identity_workspace_isolation on public.identity_policy_versions;
create policy docubox_identity_policies_read on public.identity_policies for select to authenticated
  using (docubox_settings_private.can_read_workspace(workspace_id, false));
create policy docubox_identity_versions_read on public.identity_policy_versions for select to authenticated
  using (docubox_settings_private.can_read_workspace(workspace_id, false));

create function public.save_docubox_identity_policy(p_workspace uuid, p_id uuid, p_status text, p_config jsonb)
returns table (id uuid, version integer, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.identity_policies%rowtype;
  v_version integer;
  v_now timestamptz := now();
begin
  if v_actor is null or not docubox_settings_private.can_read_workspace(p_workspace, true) then
    raise exception 'identity_settings_forbidden' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('draft', 'active', 'archived', 'delete') then
    raise exception 'identity_status_invalid' using errcode = '22023';
  end if;
  if p_id is not null then
    select * into v_policy from public.identity_policies p
      where p.id = p_id and p.workspace_id = p_workspace for update;
    if not found then raise exception 'identity_policy_not_found' using errcode = 'P0002'; end if;
  end if;
  if p_status in ('archived', 'delete') then
    if p_id is null then raise exception 'identity_policy_not_found' using errcode = 'P0002'; end if;
    if p_status = 'delete' then
      delete from public.identity_policies p where p.id = p_id;
    else
      update public.identity_policies p set status = 'archived', updated_at = v_now where p.id = p_id;
    end if;
    return query select p_id, v_policy.current_version, v_now;
    return;
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' or octet_length(p_config::text) > 65536
    or coalesce(length(btrim(p_config->>'name')), 0) not between 1 and 160
    or coalesce(length(p_config->>'description'), 0) > 2000 then
    raise exception 'identity_config_invalid' using errcode = '22023';
  end if;
  if p_status = 'active' and
    (p_config->'privacyConsent' is distinct from 'true'::jsonb or
     (nullif(p_config->>'livenessMode', '') is not null and p_config->'biometricConsent' is distinct from 'true'::jsonb))
  then
    raise exception 'identity_consent_required' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.identity_policies
      (workspace_id, name, description, status, policy_type, assurance_level, created_by)
    values (p_workspace, btrim(p_config->>'name'), coalesce(p_config->>'description', ''),
      p_status, p_config->>'type', p_config->>'assuranceLevel', v_actor)
    returning * into v_policy;
    v_version := 1;
  else
    v_version := v_policy.current_version;
    if exists (select 1 from public.identity_policy_versions v where v.policy_id = p_id and v.version = v_version and v.status <> 'draft') then
      v_version := v_version + 1;
    end if;
  end if;
  insert into public.identity_policy_versions
    (workspace_id, policy_id, version, status, config, published_at, published_by, created_by)
  values (p_workspace, v_policy.id, v_version, case when p_status = 'active' then 'published' else 'draft' end, p_config,
    case when p_status = 'active' then v_now end,
    case when p_status = 'active' then v_actor end, v_actor)
  on conflict on constraint identity_policy_versions_policy_id_version_key do update
  set status = excluded.status, config = excluded.config, published_at = excluded.published_at, published_by = excluded.published_by;
  update public.identity_policies p
    set name = btrim(p_config->>'name'), description = coalesce(p_config->>'description', ''),
        status = p_status, policy_type = p_config->>'type', assurance_level = p_config->>'assuranceLevel',
        current_version = v_version, updated_at = v_now
    where p.id = v_policy.id;
  return query select v_policy.id, v_version, v_now;
end
$$;
revoke all on function public.save_docubox_identity_policy(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_docubox_identity_policy(uuid, uuid, text, jsonb) to authenticated;

create function public.list_docubox_my_sessions()
returns table (id uuid, user_agent text, is_current boolean, last_active_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.user_agent, s.id::text = (select auth.jwt()->>'session_id'),
    coalesce(a.last_user_activity_at, s.updated_at, s.created_at), s.created_at
  from auth.sessions s left join public.docubox_session_activity a on a.session_id = s.id and a.user_id = s.user_id
  where s.user_id = (select auth.uid()) and (s.not_after is null or s.not_after > now())
    and a.absolute_expired_at is null and a.inactivity_expired_at is null
  order by 3 desc, 4 desc
  limit 50
$$;
revoke all on function public.list_docubox_my_sessions() from public, anon;
grant execute on function public.list_docubox_my_sessions() to authenticated;

create function public.revoke_docubox_my_session(p_session uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or p_session::text = auth.jwt()->>'session_id' then
    raise exception 'session_revocation_forbidden' using errcode = '42501';
  end if;
  delete from auth.sessions s where s.id = p_session and s.user_id = auth.uid();
  return found;
end
$$;
revoke all on function public.revoke_docubox_my_session(uuid) from public, anon;
grant execute on function public.revoke_docubox_my_session(uuid) to authenticated;

create function public.join_docubox_workspace(p_user uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace public.workspaces%rowtype;
begin
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    raise exception 'workspace_email_required' using errcode = '42501';
  end if;
  if length(btrim(p_code)) not between 6 and 128 then
    raise exception 'workspace_code_invalid' using errcode = '22023';
  end if;
  select * into v_workspace from public.workspaces w
    where w.invite_code = btrim(p_code) and w.workspace_type = 'business';
  if not found then raise exception 'workspace_code_invalid' using errcode = '22023'; end if;
  insert into public.workspace_members (workspace_id, user_id, role, status, joined_at)
    values (v_workspace.id, p_user, 'member', 'active', now())
    on conflict (workspace_id, user_id) do nothing;
  if not found then raise exception 'workspace_membership_exists' using errcode = '23505'; end if;
  return v_workspace.name;
end
$$;
revoke all on function public.join_docubox_workspace(uuid, text) from public, anon, authenticated;
grant execute on function public.join_docubox_workspace(uuid, text) to service_role;

create function public.list_docubox_workspace_invitations()
returns table (id uuid, workspace_id uuid, workspace_name text, invited_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.workspace_id, w.name, m.joined_at
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = (select auth.uid()) and m.status = 'invited' and m.role = 'member'
      and w.workspace_type = 'business'
      and (m.access_expires_at is null or m.access_expires_at > now())
    order by m.joined_at desc nulls last
$$;
revoke all on function public.list_docubox_workspace_invitations() from public, anon;
grant execute on function public.list_docubox_workspace_invitations() to authenticated;

create function public.accept_docubox_workspace_membership(p_invitation uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not exists (select 1 from auth.users u where u.id = v_user and u.email_confirmed_at is not null) then
    raise exception 'workspace_email_required' using errcode = '42501';
  end if;
  update public.workspace_members m set status = 'active', joined_at = now()
    where m.id = p_invitation and m.user_id = v_user and m.status = 'invited' and m.role = 'member'
      and (m.access_expires_at is null or m.access_expires_at > now())
      and exists (select 1 from public.workspaces w where w.id = m.workspace_id and w.workspace_type = 'business');
  return found;
end
$$;
revoke all on function public.accept_docubox_workspace_membership(uuid) from public, anon;
grant execute on function public.accept_docubox_workspace_membership(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-support-documents', 'profile-support-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png']);

create policy profile_support_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'profile-support-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_support_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-support-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_support_documents_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-support-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
