set local lock_timeout = '4s';

alter table profile_private.settings
  add column visibility_mode text not null default 'legacy'
    check (visibility_mode in ('legacy', 'general', 'fields')),
  drop constraint settings_scope_check,
  add constraint settings_scope_check check (
    scope in ('nadie', 'workspaces', 'solo_contactos', 'contactos')
    or (scope = 'cualquiera' and visibility_mode = 'legacy')
  );

-- Membership and contact access are independent. Legacy public values are limited to their union.
create function profile_private.visibility_mask(p_scope text)
returns integer language sql immutable set search_path = '' as $$
  select case p_scope
    when 'workspaces' then 1
    when 'solo_contactos' then 2
    when 'contactos' then 3
    when 'cualquiera' then 3
    else 0
  end
$$;

create function profile_private.visibility_scope(p_mask integer)
returns text language sql immutable set search_path = '' as $$
  select case p_mask
    when 1 then 'workspaces'
    when 2 then 'solo_contactos'
    when 3 then 'contactos'
    else 'nadie'
  end
$$;

create or replace function profile_private.audience(p_actor uuid, p_peer uuid)
returns integer language sql stable set search_path = '' as $$
  select case
    when p_actor = p_peer then 4
    when profile_private.is_blocked(p_actor, p_peer) then 0
    else (case when exists (
      select 1 from public.workspace_members m
      join public.workspace_members peer on peer.workspace_id = m.workspace_id
      where m.user_id = p_actor and peer.user_id = p_peer
        and m.status = 'active' and peer.status = 'active'
        and (m.access_expires_at is null or m.access_expires_at > now())
        and (peer.access_expires_at is null or peer.access_expires_at > now())
    ) then 1 else 0 end) + (case when exists (
      select 1 from profile_private.requests r
      where r.requester_id = p_actor and r.recipient_id = p_peer and r.status = 'approved'
    ) or exists (
      select 1 from public.contacts c
      join auth.users a on a.id = p_actor
      where c.user_id = p_peer and (
        c.profile_user_id = p_actor or (c.profile_user_id is null and lower(c.email) = lower(a.email))
      )
    ) then 2 else 0 end)
  end
$$;

create function profile_private.field_visibility_mask(
  p_mode text, p_scope text, p_fields jsonb, p_field text
)
returns integer language sql immutable set search_path = '' as $$
  select case p_mode
    when 'general' then
      case when profile_private.private_field(p_field) then 0
        else profile_private.visibility_mask(p_scope) end
    when 'fields' then profile_private.visibility_mask(p_fields->>p_field)
    else profile_private.visibility_mask(p_scope) & profile_private.visibility_mask(
      case coalesce(p_fields->>p_field,
        case when profile_private.private_field(p_field) then 'nadie' else 'heredar' end)
        when 'heredar' then p_scope else p_fields->>p_field end)
  end
$$;

create or replace function profile_private.fields_for(p_actor uuid, p_peer uuid)
returns jsonb language sql stable set search_path = '' as $$
  with permission as (
    select profile_private.audience(p_actor, p_peer) as audience,
      coalesce(s.scope, 'workspaces') as scope, coalesce(s.fields, '{}'::jsonb) as fields,
      coalesce(s.visibility_mode, 'legacy') as mode
    from (select 1) base left join profile_private.settings s on s.user_id = p_peer
  ), projected as (
    select coalesce(jsonb_object_agg(f.key, f.value) filter (where f.value <> 'null'::jsonb and f.value <> '""'::jsonb), '{}'::jsonb) as data,
      p.nombre, p.apellido_paterno, p.apellido_materno
    from public.user_profiles p
    join auth.users a on a.id = p.id
    cross join permission perm
    cross join lateral jsonb_each(jsonb_build_object(
      'full_name',p.full_name, 'nombre',p.nombre, 'apellido_paterno',p.apellido_paterno,
      'apellido_materno',p.apellido_materno, 'personalidad_juridica',p.personalidad_juridica,
      'avatar_url',p.avatar_url, 'email',a.email, 'phone',coalesce(nullif(p.telefono,''),p.phone),
      'rfc',p.rfc, 'curp',p.curp, 'regimen_fiscal',p.regimen_fiscal,
      'codigo_postal',p.codigo_postal, 'estado',p.estado, 'municipio',p.municipio,
      'colonia',p.colonia, 'localidad',p.localidad, 'calle',p.calle, 'num_exterior',p.num_exterior,
      'num_interior',p.num_interior, 'last_sign_in_at',a.last_sign_in_at, 'account_type',p.account_type
    )) f
    where p.id = p_peer and p.is_active is distinct from false
      and (perm.audience = 4 or (
        perm.audience & profile_private.field_visibility_mask(perm.mode, perm.scope, perm.fields, f.key)
      ) <> 0)
    group by p.nombre, p.apellido_paterno, p.apellido_materno
  )
  select coalesce((
    select case when (nullif(nombre,'') is not null and not data ? 'nombre')
      or (nullif(apellido_paterno,'') is not null and not data ? 'apellido_paterno')
      or (nullif(apellido_materno,'') is not null and not data ? 'apellido_materno')
      then data - 'full_name' else data end
    from projected
  ), '{}'::jsonb)
$$;

create function profile_private.visibility_preferences(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_settings profile_private.settings%rowtype;
  v_mode text;
  v_scope text;
  v_fields jsonb;
  v_field_keys constant text[] := array[
    'avatar_url','personalidad_juridica','nombre','apellido_paterno','apellido_materno','full_name',
    'email','phone','curp','rfc','regimen_fiscal','codigo_postal','estado','municipio','colonia',
    'localidad','calle','num_exterior','num_interior','account_type','last_sign_in_at'
  ];
begin
  if not exists (
    select 1 from auth.users a join public.user_profiles p on p.id = a.id
    where a.id = p_actor and a.email_confirmed_at is not null and p.is_active is distinct from false
  ) then
    raise exception 'profile_unavailable';
  end if;

  if p_action in ('save', 'save_v2') then
    v_scope := p_payload->>'scope';
    v_fields := p_payload->'fields';
    v_mode := case when p_action = 'save' then 'legacy' else p_payload->>'mode' end;
    if p_action = 'save_v2' and (
      v_mode is null or v_mode not in ('general', 'fields')
      or v_scope is null or v_scope not in ('nadie', 'workspaces', 'solo_contactos', 'contactos')
      or jsonb_typeof(v_fields) is distinct from 'object'
    ) then raise exception 'profile_invalid_visibility'; end if;
    if p_action = 'save_v2' and exists (
      select 1 from jsonb_each_text(v_fields) f
      where not (f.key = any(v_field_keys))
        or f.value is null or f.value not in ('nadie', 'workspaces', 'solo_contactos', 'contactos')
    ) then raise exception 'profile_invalid_visibility'; end if;

    insert into profile_private.settings as s
      (user_id, visibility_mode, scope, fields, allow_contacts, allow_messages, allow_notes)
    values (p_actor, v_mode, v_scope, v_fields, (p_payload->>'allowContacts')::boolean,
      (p_payload->>'allowMessages')::boolean, (p_payload->>'allowNotes')::boolean)
    on conflict (user_id) do update
    set visibility_mode = excluded.visibility_mode, scope = excluded.scope, fields = excluded.fields,
      allow_contacts = excluded.allow_contacts, allow_messages = excluded.allow_messages,
      allow_notes = excluded.allow_notes
    where p_action = 'save_v2' or s.visibility_mode = 'legacy';

    if not found then raise exception 'profile_privacy_update_required'; end if;
    return '{}'::jsonb;
  end if;

  select * into v_settings from profile_private.settings where user_id = p_actor;
  v_scope := coalesce(v_settings.scope, 'workspaces');
  v_fields := coalesce(v_settings.fields, '{}'::jsonb);
  v_mode := coalesce(v_settings.visibility_mode, 'legacy');

  if p_action = 'settings_v2' then
    if v_mode = 'legacy' then
      if v_fields = '{}'::jsonb then
        v_mode := 'general';
      else
        select jsonb_object_agg(key, profile_private.visibility_scope(
          profile_private.field_visibility_mask('legacy', v_scope, v_fields, key)
        )) into v_fields from unnest(v_field_keys) as keys(key);
        v_mode := 'fields';
      end if;
      v_scope := profile_private.visibility_scope(profile_private.visibility_mask(v_scope));
    end if;
  elsif v_mode <> 'legacy' then
    -- Older clients cannot represent contacts-only access or independent field choices.
    -- Return a conservative projection and reject their attempts to overwrite it.
    if v_mode = 'fields' then
      v_scope := 'contactos';
      select jsonb_object_agg(key, case value when 'solo_contactos' then 'nadie' else value end)
        into v_fields from (
          select key, coalesce(v_fields->>key,'nadie') as value from unnest(v_field_keys) as keys(key)
        ) as projection;
    else
      if v_scope = 'solo_contactos' then v_scope := 'nadie'; end if;
      v_fields := '{}'::jsonb;
    end if;
  else
    if v_scope = 'cualquiera' then v_scope := 'contactos'; end if;
    select coalesce(jsonb_object_agg(key, case value when 'cualquiera' then 'contactos' else value end), '{}'::jsonb)
      into v_fields from jsonb_each_text(v_fields);
  end if;

  return jsonb_build_object('scope', v_scope, 'fields', v_fields,
    'allowContacts', coalesce(v_settings.allow_contacts,false),
    'allowMessages', coalesce(v_settings.allow_messages,false),
    'allowNotes', coalesce(v_settings.allow_notes,false))
    || case when p_action = 'settings_v2' then jsonb_build_object('mode', v_mode) else '{}'::jsonb end;
end
$$;

revoke all on function profile_private.visibility_mask(text),
  profile_private.visibility_scope(integer),
  profile_private.field_visibility_mask(text,text,jsonb,text),
  profile_private.visibility_preferences(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function profile_private.visibility_preferences(uuid,text,jsonb) to service_role;

create or replace function public.docubox_profile_privacy(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select case when p_action in ('settings', 'save', 'settings_v2', 'save_v2')
    then profile_private.visibility_preferences(p_actor, p_action, p_payload)
    else profile_private.execute(p_actor, p_action, p_payload)
  end
$$;

notify pgrst, 'reload schema';
