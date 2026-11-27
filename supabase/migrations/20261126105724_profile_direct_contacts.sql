set local lock_timeout = '4s';

create or replace function profile_private.enforce_contact_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_peer uuid;
  v_email text;
begin
  if TG_OP = 'UPDATE' then
    if old.user_id = new.user_id and old.email is not distinct from new.email
       and (old.profile_user_id is not distinct from new.profile_user_id or new.profile_user_id is null) then
      return new;
    end if;
  end if;
  select a.id, a.email into v_peer, v_email from auth.users a
    where a.id = new.profile_user_id or lower(a.email) = lower(new.email)
    order by (a.id = new.profile_user_id) desc nulls last limit 1;
  if v_peer is null then
    return new;
  end if;
  if new.profile_user_id is not null and new.email is not null and lower(new.email) is distinct from lower(v_email) then
    raise exception 'profile_contact_consent_required' using errcode = '42501';
  end if;
  if new.profile_user_id is null and TG_OP = 'INSERT' and exists (
    select 1 from public.contacts c where c.user_id = new.user_id and c.email = new.email
  ) then
    return new;
  end if;
  if v_peer = new.user_id or profile_private.is_blocked(new.user_id, v_peer) then
    raise exception 'profile_contact_consent_required' using errcode = '42501';
  end if;
  if exists (
    select 1 from profile_private.settings s where s.user_id = v_peer and s.allow_contacts
  ) then
    if not exists (
      select 1 from profile_private.requests r
      where r.requester_id = new.user_id and r.recipient_id = v_peer and r.status = 'approved'
    ) then
      raise exception 'profile_contact_consent_required' using errcode = '42501';
    end if;
  elsif new.profile_user_id is not null and (
    not exists (select 1 from auth.users a where a.id = v_peer and a.email_confirmed_at is not null)
    or profile_private.fields_for(new.user_id, v_peer) = '{}'::jsonb
  ) then
    raise exception 'profile_unavailable' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function profile_private.lookup(p_actor uuid, p_payload jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with input as (
    select btrim(p_payload->>'query') as q, p_payload->>'criterion' as criterion,
      p_payload->>'purpose' = 'participant' as is_participant
  ), candidates as (
    select p.id, i.criterion, i.is_participant, s.allow_contacts,
      r.status, r.updated_at, c.id as contact_id,
      profile_private.fields_for(p_actor, p.id) as fields
    from input i
    join auth.users a on a.email_confirmed_at is not null
    join public.user_profiles p on p.id = a.id and case i.criterion
      when 'correo' then lower(a.email) = lower(i.q)
      when 'rfc' then upper(p.rfc) = upper(i.q)
      when 'curp' then upper(p.curp) = upper(i.q)
      when 'telefono' then regexp_replace(coalesce(nullif(p.telefono,''),p.phone),'[^0-9]','','g') = regexp_replace(i.q,'[^0-9]','','g')
      when 'nombre' then lower(p.full_name) = lower(i.q)
      else false end
    left join profile_private.settings s on s.user_id = p.id
    left join profile_private.requests r on r.requester_id = p_actor and r.recipient_id = p.id
    left join lateral (
      select id from public.contacts
      where user_id = p_actor and (profile_user_id = p.id
        or (profile_user_id is null and lower(email) = lower(a.email)))
      order by (profile_user_id = p.id) desc nulls last, created_at, id limit 1
    ) c on true
    where p.is_active is distinct from false
      and (i.is_participant or p.id <> p_actor)
      and not profile_private.is_blocked(p_actor, p.id)
    order by p.id
    limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'full_name', case when fields = '{}'::jsonb then null else profile_private.visible_name(fields) end,
    'email', fields->'email', 'phone', fields->'phone', 'rfc', fields->'rfc', 'curp', fields->'curp',
    'contactId', contact_id, 'requestStatus', status, 'canView', fields <> '{}'::jsonb,
    'canAddDirectly', not is_participant and contact_id is null and not coalesce(allow_contacts, false),
    'canRequest', coalesce(allow_contacts, false) and contact_id is null and (
      status is null or status = 'approved'
      or (status in ('declined','revoked') and updated_at < now() - interval '1 day')
    )
  )), '[]'::jsonb)
  from candidates
  where (fields ? case criterion when 'correo' then 'email' when 'telefono' then 'phone'
    when 'nombre' then 'full_name' else criterion end and (not is_participant or fields ? 'email'))
    or (not is_participant and criterion = 'correo' and (allow_contacts or contact_id is not null))
$$;

create function profile_private.add_contact_directly(p_actor uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_address text := nullif(lower(btrim(p_payload->>'email')), '');
  v_peer uuid := public.try_uuid(p_payload->>'peerId');
  v_by_profile boolean := p_payload ? 'peerId';
  v_peer_email text;
  v_confirmed boolean;
  v_fields jsonb := '{}'::jsonb;
  v_link uuid;
  v_existing uuid;
  v_approval boolean;
begin
  if v_by_profile and v_peer is null then raise exception 'profile_unavailable'; end if;

  if v_by_profile then
    select a.email, true into v_peer_email, v_confirmed
    from auth.users a join public.user_profiles p on p.id = a.id
    where a.id = v_peer and a.email_confirmed_at is not null and p.is_active is distinct from false;
    if not found then raise exception 'profile_unavailable'; end if;
  elsif v_address is not null then
    select a.id, a.email, a.email_confirmed_at is not null into v_peer, v_peer_email, v_confirmed
    from auth.users a where lower(a.email) = v_address;
  end if;

  if v_peer is not null then
    perform profile_private.lock_pair(p_actor, v_peer);
    if v_peer = p_actor or profile_private.is_blocked(p_actor, v_peer)
      then raise exception 'profile_unavailable'; end if;
    select s.allow_contacts into v_approval from profile_private.settings s
    where s.user_id = v_peer for share;
    if v_confirmed then v_fields := profile_private.fields_for(p_actor, v_peer); end if;
    if v_by_profile and v_fields = '{}'::jsonb then raise exception 'profile_unavailable'; end if;
    if v_by_profile or v_fields ? 'email' then
      v_link := v_peer;
    else
      v_fields := '{}'::jsonb;
    end if;
  end if;

  -- Match an address supplied by the caller. Copy only data the profile already shares.
  if v_by_profile then
    v_address := coalesce(lower(v_fields->>'email'),
      case when lower(v_peer_email) = v_address then v_address end);
  end if;

  select c.id into v_existing from public.contacts c
  where c.user_id = p_actor and (
    c.profile_user_id = v_peer or (v_address is not null and lower(c.email) = v_address)
  )
  order by (c.profile_user_id = v_peer) desc nulls last, c.created_at, c.id limit 1;
  if v_existing is not null then return jsonb_build_object('status', 'saved'); end if;
  if coalesce(v_approval, false) then raise exception 'profile_contact_consent_required'; end if;

  insert into public.contacts (user_id, profile_user_id, nombre, email, telefono)
  values (p_actor, v_link,
    coalesce(nullif(btrim(p_payload->>'name'), ''),
      profile_private.visible_name(v_fields, coalesce(v_address, 'Usuario de Docubox'))),
    v_address, nullif(btrim(p_payload->>'phone'), ''))
  on conflict do nothing;
  return jsonb_build_object('status', 'saved');
end
$$;

revoke execute on function profile_private.add_contact_directly(uuid,jsonb)
  from public, anon, authenticated;

create or replace function profile_private.contact_request_inbox(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_hint text;
  v_received jsonb;
  v_sent jsonb;
  v_allow_contacts boolean;
begin
  if not exists (
    select 1 from auth.users a join public.user_profiles p on p.id = a.id
    where a.id = p_actor and a.email_confirmed_at is not null and p.is_active is distinct from false
  ) then raise exception 'profile_unavailable'; end if;

  if p_action = 'add_contact' or (
    p_action = 'register' and not exists (
      select 1 from auth.users a join profile_private.settings s on s.user_id = a.id
      where lower(a.email) = lower(btrim(p_payload->>'email')) and s.allow_contacts
    )
  ) then
    return profile_private.add_contact_directly(p_actor, p_payload);
  end if;

  if p_action in ('request', 'register') then
    v_result := profile_private.execute(p_actor, p_action, p_payload);
    v_hint := nullif(lower(btrim(p_payload->>(case
      when p_action = 'register' then 'email' else 'emailHint' end))), '');

    if v_result->>'status' <> 'saved' and char_length(v_hint) between 1 and 254 then
      update profile_private.requests r set sender_email_hint = v_hint
      from auth.users recipient
      where r.requester_id = p_actor and recipient.id = r.recipient_id
        and lower(recipient.email) = v_hint
        and (p_action = 'register' or r.recipient_id = public.try_uuid(p_payload->>'peerId'))
        and r.sender_email_hint is distinct from v_hint;
    end if;
    return v_result;
  end if;

  if p_action is distinct from 'requests_v2' then raise exception 'profile_unavailable'; end if;

  select coalesce((
    select s.allow_contacts from profile_private.settings s where s.user_id = p_actor
  ), false) into v_allow_contacts;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.requester_name, 'status', r.status, 'created_at', r.created_at
  ) order by (r.status = 'pending') desc, r.created_at desc, r.id), '[]'::jsonb)
  into v_received
  from profile_private.requests r
  join public.user_profiles requester on requester.id = r.requester_id and requester.is_active is distinct from false
  where v_allow_contacts and r.recipient_id = p_actor
    and not profile_private.is_blocked(p_actor, r.requester_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', profile_private.visible_name(profile.fields, null),
    'email', coalesce(profile.fields->>'email', r.sender_email_hint),
    'contactId', c.id, 'status', r.status, 'created_at', r.created_at
  ) order by (r.status = 'pending') desc, r.created_at desc, r.id), '[]'::jsonb)
  into v_sent
  from profile_private.requests r
  join profile_private.settings recipient on recipient.user_id = r.recipient_id and recipient.allow_contacts
  join public.user_profiles peer on peer.id = r.recipient_id and peer.is_active is distinct from false
  left join public.contacts c on r.status = 'approved'
    and c.user_id = p_actor and c.profile_user_id = r.recipient_id
  cross join lateral (select profile_private.fields_for(p_actor, r.recipient_id) as fields) profile
  where r.requester_id = p_actor and not profile_private.is_blocked(p_actor, r.recipient_id);

  return jsonb_build_object('allowContacts', v_allow_contacts, 'received', v_received, 'sent', v_sent);
end
$$;

create or replace function public.docubox_profile_privacy(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select case
    when p_action in ('settings', 'save', 'settings_v2', 'save_v2')
      then profile_private.visibility_preferences(p_actor, p_action, p_payload)
    when p_action in ('requests_v2', 'request', 'register', 'add_contact')
      then profile_private.contact_request_inbox(p_actor, p_action, p_payload)
    else profile_private.execute(p_actor, p_action, p_payload)
  end
$$;

notify pgrst, 'reload schema';
