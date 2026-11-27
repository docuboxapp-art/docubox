set local lock_timeout = '4s';

create or replace function profile_private.save_approved_contact(p_requester uuid, p_peer uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_profile jsonb := profile_private.fields_for(p_requester, p_peer);
  v_existing uuid;
  v_email text;
  v_contact_email text;
begin
  select email into v_email from auth.users where id = p_peer;
  select c.id into v_existing from public.contacts c
  where c.user_id = p_requester and (
    c.profile_user_id = p_peer or (c.profile_user_id is null and lower(c.email) = lower(v_email))
  )
  order by (c.profile_user_id = p_peer) desc nulls last, c.created_at, c.id limit 1;

  if v_existing is not null then
    update public.contacts set profile_user_id = p_peer where id = v_existing;
    if found then return; end if;
  end if;

  -- The sender may keep the exact address they supplied as long as it still matches this account.
  select coalesce(v_profile->>'email', (
    select r.sender_email_hint from profile_private.requests r
    where r.requester_id = p_requester and r.recipient_id = p_peer
      and r.sender_email_hint = lower(v_email)
  )) into v_contact_email;

  insert into public.contacts(user_id, profile_user_id, nombre, email)
  values (p_requester, p_peer,
    profile_private.visible_name(v_profile, coalesce(v_contact_email, 'Usuario de Docubox')),
    v_contact_email)
  on conflict do nothing;
end
$$;

create or replace function profile_private.contact_request_inbox(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_hint text;
  v_received jsonb;
  v_sent jsonb;
  v_allow_contacts boolean;
begin
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

  if p_action is distinct from 'requests_v2' or not exists (
    select 1 from auth.users a join public.user_profiles p on p.id = a.id
    where a.id = p_actor and a.email_confirmed_at is not null and p.is_active is distinct from false
  ) then
    raise exception 'profile_unavailable';
  end if;

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

notify pgrst, 'reload schema';
