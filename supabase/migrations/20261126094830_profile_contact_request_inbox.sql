set local lock_timeout = '4s';

-- Keep the sender's search email on their request only when it matches the selected account.
alter table profile_private.requests
  add column sender_email_hint text check (char_length(sender_email_hint) <= 254);

create function profile_private.contact_request_inbox(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_hint text;
  v_received jsonb;
  v_sent jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.requester_name, 'status', r.status, 'created_at', r.created_at
  ) order by (r.status = 'pending') desc, r.created_at desc, r.id), '[]'::jsonb)
  into v_received
  from profile_private.requests r
  join profile_private.settings recipient on recipient.user_id = r.recipient_id and recipient.allow_contacts
  join public.user_profiles requester on requester.id = r.requester_id and requester.is_active is distinct from false
  where r.recipient_id = p_actor and not profile_private.is_blocked(p_actor, r.requester_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', profile_private.visible_name(profile.fields, null),
    'email', coalesce(profile.fields->>'email', r.sender_email_hint),
    'status', r.status, 'created_at', r.created_at
  ) order by (r.status = 'pending') desc, r.created_at desc, r.id), '[]'::jsonb)
  into v_sent
  from profile_private.requests r
  join profile_private.settings recipient on recipient.user_id = r.recipient_id and recipient.allow_contacts
  join public.user_profiles peer on peer.id = r.recipient_id and peer.is_active is distinct from false
  cross join lateral (select profile_private.fields_for(p_actor, r.recipient_id) as fields) profile
  where r.requester_id = p_actor and not profile_private.is_blocked(p_actor, r.recipient_id);

  return jsonb_build_object('received', v_received, 'sent', v_sent);
end
$$;

revoke execute on function profile_private.contact_request_inbox(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function profile_private.contact_request_inbox(uuid,text,jsonb) to service_role;

create or replace function public.docubox_profile_privacy(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select case
    when p_action in ('settings', 'save', 'settings_v2', 'save_v2')
      then profile_private.visibility_preferences(p_actor, p_action, p_payload)
    when p_action in ('requests_v2', 'request', 'register')
      then profile_private.contact_request_inbox(p_actor, p_action, p_payload)
    else profile_private.execute(p_actor, p_action, p_payload)
  end
$$;

notify pgrst, 'reload schema';
