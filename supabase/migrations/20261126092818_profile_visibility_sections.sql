set local lock_timeout = '4s';

-- The default retains the visibility of existing profiles and also applies to new accounts.
alter table profile_private.settings
  add column shared_sections text[] not null default array['identity']::text[],
  add constraint settings_shared_sections_check check (
    array_position(shared_sections, null) is null
    and shared_sections <@ array['identity','tax_identity','address','account']::text[]
  );

create function profile_private.visibility_section(p_field text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_field in (
      'avatar_url','personalidad_juridica','nombre','apellido_paterno','apellido_materno',
      'full_name','email','phone'
    ) then 'identity'
    when p_field in ('curp','rfc','regimen_fiscal') then 'tax_identity'
    when p_field in (
      'codigo_postal','estado','municipio','colonia','localidad','calle','num_exterior','num_interior'
    ) then 'address'
    when p_field in ('account_type','last_sign_in_at') then 'account'
  end
$$;

revoke execute on function profile_private.visibility_section(text) from public, anon, authenticated;

create or replace function profile_private.fields_for(p_actor uuid, p_peer uuid)
returns jsonb language sql stable set search_path = '' as $$
  with permission as (
    select profile_private.audience(p_actor, p_peer) as audience,
      coalesce(s.scope, 'workspaces') as scope, coalesce(s.fields, '{}'::jsonb) as fields,
      coalesce(s.visibility_mode, 'legacy') as mode,
      coalesce(s.shared_sections, array['identity']::text[]) as sections
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
        perm.audience & case
          when perm.mode <> 'general'
            then profile_private.field_visibility_mask(perm.mode, perm.scope, perm.fields, f.key)
          when profile_private.visibility_section(f.key) = any(perm.sections)
            then profile_private.visibility_mask(perm.scope)
          else 0
        end
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

create or replace function profile_private.visibility_preferences(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_settings profile_private.settings%rowtype;
  v_mode text;
  v_scope text;
  v_fields jsonb;
  v_sections text[];
  v_default_sections constant text[] := array['identity'];
  v_section_keys constant text[] := array['identity','tax_identity','address','account'];
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

    if p_action = 'save_v2' and p_payload ? 'sections' then
      if jsonb_typeof(p_payload->'sections') is distinct from 'array'
        then raise exception 'profile_invalid_visibility'; end if;
      if jsonb_array_length(p_payload->'sections') > cardinality(v_section_keys)
        or exists (
          select 1 from jsonb_array_elements_text(p_payload->'sections') section(value)
          where section.value is null or not (section.value = any(v_section_keys))
        ) then raise exception 'profile_invalid_visibility'; end if;
      select array(
        select section.key from unnest(v_section_keys) with ordinality section(key, position)
        where (p_payload->'sections') ? section.key order by section.position
      ) into v_sections;
    end if;
    insert into profile_private.settings as s
      (user_id, visibility_mode, scope, fields, shared_sections, allow_contacts, allow_messages, allow_notes)
    values (p_actor, v_mode, v_scope, v_fields, coalesce(v_sections,v_default_sections),
      (p_payload->>'allowContacts')::boolean, (p_payload->>'allowMessages')::boolean,
      (p_payload->>'allowNotes')::boolean)
    on conflict (user_id) do update
    set visibility_mode = excluded.visibility_mode, scope = excluded.scope, fields = excluded.fields,
      shared_sections = coalesce(v_sections,s.shared_sections),
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
  v_sections := coalesce(v_settings.shared_sections, v_default_sections);

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
      select jsonb_object_agg(key, case when profile_private.visibility_section(key) = any(v_sections)
        then 'heredar' else 'nadie' end)
        into v_fields from unnest(v_field_keys) as keys(key);
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
    || case when p_action = 'settings_v2' then jsonb_build_object('mode', v_mode, 'sections', v_sections)
      else '{}'::jsonb end;
end
$$;

notify pgrst, 'reload schema';
