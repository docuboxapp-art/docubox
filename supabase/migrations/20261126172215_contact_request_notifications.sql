set local lock_timeout = '4s';

create or replace function profile_private.notify_contact_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event text;
  v_recipient uuid;
  v_actor uuid;
  v_title text;
  v_description text;
  v_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;

    -- Once a request is resolved, it no longer needs attention in the bell.
    with resolved as (
      update public.notifications
      set status = 'read'
      where entity_id = new.id and status = 'unread' and (
        (old.status = 'pending' and event_type = 'contact.request.received' and user_id = new.recipient_id)
        or (old.status = 'approved' and event_type = 'contact.request.approved' and user_id = new.requester_id)
      )
      returning id, event_type
    )
    insert into public.notification_event_log (notification_id, event_type, outcome)
    select id, event_type, 'read' from resolved;
  end if;

  if new.status = 'pending' then
    v_event := 'contact.request.received';
    v_recipient := new.recipient_id;
    v_actor := new.requester_id;
    v_title := 'Nueva solicitud de contacto';
    v_description := 'Alguien quiere agregarte a su agenda. Puedes aprobar o rechazar la solicitud.';
  elsif new.status = 'approved' then
    v_event := 'contact.request.approved';
    v_recipient := new.requester_id;
    v_actor := new.recipient_id;
    v_title := 'Solicitud de contacto aceptada';
    v_description := 'La otra persona aceptó tu solicitud y ya está en tu agenda.';
  else
    return new;
  end if;

  if not exists (
    select 1 from public.user_profiles
    where id = v_recipient and is_active is distinct from false
  ) or exists (
    select 1 from public.notification_preferences
    where user_id = v_recipient and category = 'APPROVAL' and not in_app_enabled
  ) then
    return new;
  end if;

  insert into public.notifications (
    user_id, type, title, description, priority, category, event_type, severity,
    entity_type, entity_id, action_url, action_label, idempotency_key
  )
  values (
    v_recipient, 'request', v_title, v_description, 'media', 'APPROVAL', v_event,
    case when new.status = 'approved' then 'success' else 'info' end,
    'contact_request', new.id, '/contactos?vista=solicitudes', 'Ver solicitudes de contacto',
    v_event || ':' || new.id::text || ':' || extract(epoch from new.created_at)::text
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.notification_deliveries (notification_id, channel, status, provider, delivered_at)
    values (v_id, 'in_app', 'delivered', 'docubox', now());

    insert into public.notification_event_log (notification_id, actor_user_id, event_type, outcome, metadata)
    values (v_id, v_actor, v_event, 'created', '{"category":"APPROVAL"}'::jsonb),
           (v_id, v_actor, v_event, 'delivery_sent', '{"channel":"in_app"}'::jsonb);
  end if;

  return new;
end
$$;

revoke all on function profile_private.notify_contact_request() from public, anon, authenticated;

create trigger contact_request_notifications
after insert or update of status on profile_private.requests
for each row execute function profile_private.notify_contact_request();

-- Both notification surfaces already listen for changes to the user's rows.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
