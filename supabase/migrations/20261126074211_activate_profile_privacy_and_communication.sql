set local lock_timeout = '4s';

-- Activate profile privacy with the app that uses the consent and privacy APIs.
alter table public.contacts add column profile_user_id uuid references auth.users(id) on delete set null;
create unique index contacts_owner_profile_idx on public.contacts(user_id, profile_user_id) where profile_user_id is not null;

create function profile_private.scope_rank(p_scope text)
returns integer language sql immutable set search_path = '' as $$
  select case p_scope when 'workspaces' then 1 when 'contactos' then 2 when 'cualquiera' then 3 else 0 end
$$;

create function profile_private.is_blocked(p_actor uuid, p_peer uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from profile_private.blocks b
    where (b.owner_id = p_actor and b.blocked_id = p_peer)
       or (b.owner_id = p_peer and b.blocked_id = p_actor)
  )
$$;

create function profile_private.audience(p_actor uuid, p_peer uuid)
returns integer language sql stable set search_path = '' as $$
  select case
    when p_actor = p_peer then 0
    when profile_private.is_blocked(p_actor, p_peer) then 4
    when exists (
      select 1 from public.workspace_members m
      join public.workspace_members peer on peer.workspace_id = m.workspace_id
      where m.user_id = p_actor and peer.user_id = p_peer
        and m.status = 'active' and peer.status = 'active'
        and (m.access_expires_at is null or m.access_expires_at > now())
        and (peer.access_expires_at is null or peer.access_expires_at > now())
    ) then 1
    when exists (
      select 1 from profile_private.requests r
      where r.requester_id = p_actor and r.recipient_id = p_peer and r.status = 'approved'
    ) or exists (
      select 1 from public.contacts c
      join auth.users a on a.id = p_actor
      where c.user_id = p_peer and (
        c.profile_user_id = p_actor or (c.profile_user_id is null and lower(c.email) = lower(a.email))
      )
    ) then 2
    else 3
  end
$$;

create function profile_private.private_field(p_field text)
returns boolean language sql immutable set search_path = '' as $$
  select p_field in ('rfc','curp','regimen_fiscal','codigo_postal','estado','municipio','colonia','localidad',
    'calle','num_exterior','num_interior','last_sign_in_at','account_type')
$$;

create function profile_private.fields_for(p_actor uuid, p_peer uuid)
returns jsonb language sql stable set search_path = '' as $$
  with permission as (
    select profile_private.audience(p_actor, p_peer) as audience,
      coalesce(s.scope, 'workspaces') as scope, coalesce(s.fields, '{}'::jsonb) as fields
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
      and profile_private.scope_rank(perm.scope) >= perm.audience
      and profile_private.scope_rank(case coalesce(perm.fields->>f.key,
        case when profile_private.private_field(f.key) then 'nadie' else 'heredar' end)
        when 'heredar' then perm.scope else perm.fields->>f.key end) >= perm.audience
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

create function profile_private.visible_name(p_fields jsonb, p_fallback text default 'Usuario de Docubox')
returns text language sql immutable set search_path = '' as $$
  select coalesce(nullif(p_fields->>'full_name',''),
    nullif(concat_ws(' ', p_fields->>'nombre', p_fields->>'apellido_paterno', p_fields->>'apellido_materno'),''),
    p_fallback)
$$;

create function profile_private.peer_for_contact(p_actor uuid, p_contact uuid)
returns uuid language sql stable set search_path = '' as $$
  select a.id
  from public.contacts c
  join auth.users a on a.id = c.profile_user_id
    or (c.profile_user_id is null and lower(a.email) = lower(c.email))
  join public.user_profiles p on p.id = a.id and p.is_active is distinct from false
  where c.id = p_contact and c.user_id = p_actor and a.id <> p_actor
    and a.email_confirmed_at is not null
  limit 1
$$;

-- Registered accounts can enter an agenda through approval. Existing address-book
-- entries and manually entered external participants retain their existing behavior.
create function profile_private.enforce_contact_consent()
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
  if v_peer = new.user_id or profile_private.is_blocked(new.user_id, v_peer)
     or not exists (
       select 1 from profile_private.requests r
       where r.requester_id = new.user_id and r.recipient_id = v_peer and r.status = 'approved'
     ) then
    raise exception 'profile_contact_consent_required' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger enforce_contacts_profile_consent
before insert or update of user_id, email, profile_user_id on public.contacts
for each row execute function profile_private.enforce_contact_consent();

create function profile_private.lock_pair(p_actor uuid, p_peer uuid)
returns void language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(concat_ws(':', least(p_actor,p_peer), greatest(p_actor,p_peer)), 0))
$$;

create function profile_private.save_approved_contact(p_requester uuid, p_peer uuid)
returns void language plpgsql set search_path = '' as $$
declare
  v_profile jsonb := profile_private.fields_for(p_requester, p_peer);
  v_existing uuid;
  v_email text;
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
  insert into public.contacts(user_id, profile_user_id, nombre, email)
  values (p_requester, p_peer, profile_private.visible_name(v_profile), v_profile->>'email')
  on conflict do nothing;
end
$$;

create function profile_private.request_contact(p_actor uuid, p_peer uuid)
returns text language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  if p_peer is null or p_actor = p_peer then raise exception 'profile_unavailable'; end if;
  perform profile_private.lock_pair(p_actor, p_peer);
  if profile_private.is_blocked(p_actor, p_peer)
    or not exists (
      select 1 from public.user_profiles p join profile_private.settings s on s.user_id = p.id
      where p.id = p_peer and p.is_active is distinct from false and s.allow_contacts
    ) then
    raise exception 'profile_requests_closed';
  end if;

  insert into profile_private.requests(requester_id, requester_name, recipient_id)
  values (p_actor, left(profile_private.visible_name(profile_private.fields_for(p_actor, p_actor)), 200), p_peer)
  on conflict (requester_id, recipient_id) do update set status = 'pending',
    requester_name = excluded.requester_name, updated_at = now(), created_at = now()
  where requests.status in ('declined','revoked') and requests.updated_at < now() - interval '1 day'
  returning status into v_status;
  if v_status is null then
    select status into v_status from profile_private.requests
      where requester_id = p_actor and recipient_id = p_peer;
  end if;
  if v_status = 'approved' then
    perform profile_private.save_approved_contact(p_actor, p_peer);
  end if;
  return v_status;
end
$$;

create function profile_private.decide_request(p_actor uuid, p_request uuid, p_decision text)
returns text language plpgsql set search_path = '' as $$
declare
  v_request profile_private.requests%rowtype;
  v_status text;
begin
  select * into v_request from profile_private.requests where id = p_request and recipient_id = p_actor;
  if not found then raise exception 'profile_unavailable'; end if;
  perform profile_private.lock_pair(p_actor, v_request.requester_id);
  select * into v_request from profile_private.requests
    where id = p_request and recipient_id = p_actor for update;
  if not found or profile_private.is_blocked(p_actor, v_request.requester_id) then
    raise exception 'profile_unavailable';
  end if;
  if p_decision = 'revoke' and v_request.status = 'approved' then
    v_status := 'revoked';
  elsif p_decision = 'decline' and v_request.status = 'pending' then
    v_status := 'declined';
  elsif p_decision = 'approve' and v_request.status = 'pending' and exists (
    select 1 from profile_private.settings where user_id = p_actor and allow_contacts
  ) then
    v_status := 'approved';
  else
    raise exception 'profile_request_changed';
  end if;

  update profile_private.requests set status = v_status, updated_at = now() where id = v_request.id;
  if v_status = 'approved' then
    perform profile_private.save_approved_contact(v_request.requester_id, p_actor);
  end if;
  return v_status;
end
$$;

create function profile_private.lookup(p_actor uuid, p_payload jsonb)
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

create function profile_private.document_peers(p_document uuid)
returns table(user_id uuid, display_label text) language sql stable set search_path = '' as $$
  with document as (
    select d.owner_id, d.participantes from public.documentos d where d.id = p_document
      and d.deleted_at is null and lower(coalesce(d.estado::text,'')) <> 'borrador'
  ), peers as (
    select d.owner_id as id, 'Propietario'::text as label, true as is_owner
    from document d
    union all
    select u.id, coalesce(nullif(btrim(participant->>'nombre'),''), nullif(btrim(participant->>'name'),'')), false
    from document d
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.participantes) = 'array'
      then d.participantes else '[]'::jsonb end) participant
    join auth.users u on (
      (nullif(participant->>'user_id', '') is not null
        and u.id = public.try_uuid(participant->>'user_id'))
      or (nullif(participant->>'user_id', '') is null and (
        u.id = public.try_uuid(participant->>'id') or lower(u.email) = lower(btrim(participant->>'email'))
      ))
    )
    where lower(coalesce(participant->>'current_access','true')) not in ('false','0','no')
      and participant->>'portal_token_invalidated_at' is null
  )
  select distinct on (p.id) p.id, p.label from peers p
    join auth.users u on u.id = p.id and u.email_confirmed_at is not null
    join public.user_profiles profile on profile.id = p.id and profile.is_active is distinct from false
  where not exists (
    select 1 from public.document_user_visibility v
    where v.user_id = p.id and v.document_id = p_document
      and (v.hidden_at is not null or (v.trashed_at is not null and v.restored_at is null))
  )
  order by p.id, p.is_owner desc, p.label nulls last
$$;

create function profile_private.channel_for(p_actor uuid, p_peer uuid, p_label text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_peer,
    'name', profile_private.visible_name(profile_private.fields_for(p_actor, p_peer),
      coalesce(p_label, 'Usuario · ' || left(p_peer::text, 8))),
    'messages', not blocked and coalesce(s.allow_messages, false),
    'notes', not blocked and coalesce(s.allow_notes, false)
  )
  from (select profile_private.is_blocked(p_actor,p_peer) as blocked) rule
  left join profile_private.settings s on s.user_id = p_peer
$$;

create function profile_private.communicate(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_document uuid := public.try_uuid(p_payload->>'documentId');
  v_contact uuid := public.try_uuid(p_payload->>'contactId');
  v_peer uuid := public.try_uuid(p_payload->>'peerId');
  v_peers uuid[];
  v_peer_labels jsonb;
  v_kind text := p_payload->>'kind';
  v_message_id uuid := coalesce(public.try_uuid(p_payload->>'messageId'), gen_random_uuid());
  v_row profile_private.communications%rowtype;
  v_messages jsonb;
begin
  if v_document is not null then
    select array_agg(user_id), jsonb_object_agg(user_id, display_label)
      into v_peers, v_peer_labels from profile_private.document_peers(v_document);
    if not coalesce(p_actor = any(v_peers), false) then raise exception 'profile_unavailable'; end if;
    if v_peer is not null and (v_peer = p_actor or not v_peer = any(v_peers)) then
      raise exception 'profile_unavailable';
    end if;
  elsif v_contact is not null then
    v_peer := profile_private.peer_for_contact(p_actor, v_contact);
    if v_peer is null then raise exception 'profile_contact_not_registered'; end if;
    v_peers := array[v_peer];
    select jsonb_build_object(v_peer::text, nullif(btrim(c.nombre), '')) into v_peer_labels
      from public.contacts c where c.id = v_contact and c.user_id = p_actor;
  elsif v_peer is not null then
    if not exists (
      select 1 from profile_private.communications m
      where m.document_id is null and ((m.sender_id = p_actor and m.recipient_id = v_peer)
        or (m.sender_id = v_peer and m.recipient_id = p_actor))
    ) then raise exception 'profile_unavailable'; end if;
    v_peers := array[v_peer];
  end if;

  if p_action = 'send' then
    if v_peer is null or v_peer = p_actor then raise exception 'profile_unavailable'; end if;
    perform profile_private.lock_pair(p_actor, v_peer);
    if not exists (
      select 1 from profile_private.settings s join public.user_profiles p on p.id = s.user_id
      where s.user_id = v_peer and p.is_active is distinct from false
        and case v_kind when 'note' then s.allow_notes when 'message' then s.allow_messages else false end
    ) or profile_private.is_blocked(p_actor,v_peer) then
      raise exception 'profile_communication_closed';
    end if;
    insert into profile_private.communications(id, sender_id, recipient_id, document_id, kind, content)
      values (v_message_id, p_actor, v_peer, v_document, v_kind, btrim(p_payload->>'content'))
      on conflict (id) do nothing returning * into v_row;
    if not found then
      select * into v_row from profile_private.communications
      where id = v_message_id and sender_id = p_actor and recipient_id = v_peer
        and document_id is not distinct from v_document and kind = v_kind and content = btrim(p_payload->>'content');
      if not found then raise exception 'profile_unavailable'; end if;
    end if;
    return to_jsonb(v_row);
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) || jsonb_build_object(
    'peer', other.id,
    'peer_name', profile_private.visible_name(profile_private.fields_for(p_actor, other.id),
      coalesce(v_peer_labels->>(other.id::text), 'Usuario · ' || left(other.id::text, 8))),
    'document_name', d.nombre
  ) order by m.created_at desc, m.id desc), '[]'::jsonb) into v_messages
  from (
    select entry.* from profile_private.communications entry
    where (entry.sender_id = p_actor or entry.recipient_id = p_actor)
      and case when p_action = 'inbox' then true else entry.document_id is not distinct from v_document end
      and (v_peer is null or entry.sender_id = v_peer or entry.recipient_id = v_peer)
      and (entry.document_id is null or (
        exists (select 1 from profile_private.document_peers(entry.document_id) x where x.user_id = p_actor)
        and exists (select 1 from profile_private.document_peers(entry.document_id) x
          where x.user_id = case when entry.sender_id = p_actor then entry.recipient_id else entry.sender_id end)
      ))
    order by entry.created_at desc, entry.id desc limit 100
  ) m left join public.documentos d on d.id = m.document_id
  cross join lateral (select case when m.sender_id = p_actor then m.recipient_id else m.sender_id end as id) other;

  return jsonb_build_object(
    'viewerId', p_actor, 'messages', v_messages,
    'peers', coalesce((select jsonb_agg(profile_private.channel_for(p_actor, id, v_peer_labels->>(id::text)))
      from unnest(v_peers) id
      where id <> p_actor and not profile_private.is_blocked(p_actor,id)), '[]'::jsonb)
  );
end
$$;

create function profile_private.execute(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_peer uuid := public.try_uuid(p_payload->>'peerId');
  v_fields jsonb;
  v_email text;
  v_status text;
  v_result jsonb;
begin
  if not exists (
    select 1 from auth.users a join public.user_profiles p on p.id = a.id
    where a.id = p_actor and a.email_confirmed_at is not null and p.is_active is distinct from false
  ) then
    raise exception 'profile_unavailable';
  end if;

  case p_action
    when 'save' then
      insert into profile_private.settings(user_id, scope, fields, allow_contacts, allow_messages, allow_notes)
      values (p_actor, p_payload->>'scope', p_payload->'fields', (p_payload->>'allowContacts')::boolean,
        (p_payload->>'allowMessages')::boolean, (p_payload->>'allowNotes')::boolean)
      on conflict (user_id) do update set scope = excluded.scope, fields = excluded.fields,
        allow_contacts = excluded.allow_contacts, allow_messages = excluded.allow_messages, allow_notes = excluded.allow_notes;
      return '{}'::jsonb;
    when 'settings' then
      select jsonb_build_object('scope',coalesce(s.scope,'workspaces'), 'fields',coalesce(s.fields,'{}'::jsonb),
        'allowContacts',coalesce(s.allow_contacts,false), 'allowMessages',coalesce(s.allow_messages,false),
        'allowNotes',coalesce(s.allow_notes,false)) into v_result
      from (select 1) base left join profile_private.settings s on s.user_id = p_actor;
      return v_result;
    when 'search' then
      return profile_private.lookup(p_actor, p_payload);
    when 'cards' then
      select coalesce(jsonb_agg(jsonb_build_object('id',ids.id, 'name',profile_private.visible_name(f.fields),
        'email',f.fields->>'email','avatarUrl',f.fields->>'avatar_url')) filter (where f.fields <> '{}'::jsonb), '[]'::jsonb)
      into v_result
      from (select distinct public.try_uuid(id) id from jsonb_array_elements_text(p_payload->'ids') id) ids
      cross join lateral (select profile_private.fields_for(p_actor, ids.id) as fields) f;
      return v_result;
    when 'profile' then
      if p_payload ? 'contactId' then
        v_peer := profile_private.peer_for_contact(p_actor, public.try_uuid(p_payload->>'contactId'));
      end if;
      v_fields := profile_private.fields_for(p_actor, v_peer);
      if v_fields <> '{}'::jsonb and p_actor <> v_peer then
        insert into profile_private.visits(profile_id, viewer_id) values (v_peer, p_actor)
        on conflict (profile_id, viewer_id) do update set viewed_at = now()
        where visits.viewed_at < now() - interval '5 minutes';
      end if;
      return jsonb_build_object('fields',v_fields);
    when 'request' then
      return jsonb_build_object('status', profile_private.request_contact(p_actor, v_peer));
    when 'register' then
      v_email := nullif(lower(btrim(p_payload->>'email')),'');
      select a.id into v_peer from auth.users a where lower(a.email) = v_email;
      if exists (select 1 from public.contacts where user_id = p_actor and lower(email) = v_email) then
        return jsonb_build_object('status','saved');
      end if;
      if v_peer is not null then
        v_status := profile_private.request_contact(p_actor, v_peer);
        return jsonb_build_object('status',v_status);
      end if;
      insert into public.contacts (user_id, nombre, email, telefono)
      values (p_actor, btrim(p_payload->>'name'), v_email, nullif(btrim(p_payload->>'phone'),''))
      on conflict do nothing;
      return jsonb_build_object('status','saved');
    when 'requests' then
      select coalesce(jsonb_agg(to_jsonb(r)
        order by (r.status = 'pending') desc, r.created_at desc), '[]'::jsonb) into v_result
      from (
        select id, requester_id, requester_name as name, status, created_at, updated_at
        from profile_private.requests where recipient_id = p_actor order by (status = 'pending') desc, created_at desc limit 100
      ) r;
      return v_result;
    when 'decide' then
      return jsonb_build_object('status',profile_private.decide_request(
        p_actor, public.try_uuid(p_payload->>'requestId'), p_payload->>'decision'));
    when 'visits' then
      select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
        'name', profile_private.visible_name(profile_private.fields_for(p_actor, v.viewer_id))
      ) order by v.viewed_at desc), '[]'::jsonb) into v_result
      from (select viewer_id, viewed_at from profile_private.visits
        where profile_id = p_actor order by viewed_at desc limit 100) v;
      return v_result;
    when 'blocks' then
      select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc), '[]'::jsonb) into v_result
      from (select blocked_id, label, created_at from profile_private.blocks
        where owner_id = p_actor order by created_at desc limit 100) b;
      return v_result;
    when 'block' then
      v_email := nullif(lower(btrim(p_payload->>'email')),'');
      if v_peer is null then
        select id into v_peer from auth.users where lower(email) = v_email;
      end if;
      if v_peer is null or p_actor = v_peer or not exists (select 1 from public.user_profiles where id = v_peer) then
        raise exception 'profile_unavailable';
      end if;
      perform profile_private.lock_pair(p_actor, v_peer);
      insert into profile_private.blocks(owner_id, blocked_id, label)
      values (p_actor, v_peer, coalesce(v_email, profile_private.visible_name(profile_private.fields_for(p_actor,v_peer))))
      on conflict do nothing;
      update profile_private.requests set status = 'revoked', updated_at = now()
      where status in ('pending','approved') and (
        (requester_id = p_actor and recipient_id = v_peer)
        or (requester_id = v_peer and recipient_id = p_actor)
      );
      return '{}'::jsonb;
    when 'unblock' then
      perform profile_private.lock_pair(p_actor, v_peer);
      delete from profile_private.blocks where owner_id = p_actor and blocked_id = v_peer;
      return '{}'::jsonb;
    when 'send', 'conversation', 'inbox' then
      return profile_private.communicate(p_actor, p_action, p_payload);
    else
      raise exception 'profile_invalid_action';
  end case;
end
$$;

-- Full rows include signatures, tax identifiers, and security settings. Colleagues
-- use the same field-filtered projection as the contact interface.
drop policy if exists workspace_members_read_shared_profiles on public.user_profiles;

revoke all on all functions in schema profile_private from public, anon, authenticated;
grant execute on function profile_private.execute(uuid,text,jsonb) to service_role;

create function public.docubox_profile_privacy(p_actor uuid, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select profile_private.execute(p_actor, p_action, p_payload)
$$;
revoke all on function public.docubox_profile_privacy(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.docubox_profile_privacy(uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';
