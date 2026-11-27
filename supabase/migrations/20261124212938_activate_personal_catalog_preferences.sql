-- Enable private catalog preferences and contact and case labels for each account.
grant select, insert, delete on public.user_catalog_hidden to authenticated;
grant select on public.user_catalog_entries to authenticated;
grant insert (user_id, kind, name, group_key, color), update (name, group_key, color, archived)
  on public.user_catalog_entries to authenticated;

-- Change one contact tag atomically, including when another tab edits the contact.
create function public.set_contact_catalog_tag(p_contact uuid, p_tag text, p_remove boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_tag is null or char_length(btrim(p_tag)) not between 1 and 162 or p_remove is null then
    return false;
  end if;
  update public.contacts as c
    set tags = case
      when p_remove then array_remove(c.tags, p_tag)
      when p_tag = any(c.tags) then c.tags
      else array_append(c.tags, p_tag)
    end,
    etiqueta_rol = case
      when p_remove and p_tag = 'Tipo: ' || c.etiqueta_rol then null
      else c.etiqueta_rol
    end
    where c.id = p_contact and c.user_id = (select auth.uid());
  return found;
end;
$$;
revoke all on function public.set_contact_catalog_tag(uuid,text,boolean) from public, anon;
grant execute on function public.set_contact_catalog_tag(uuid,text,boolean) to authenticated;

create function public.rename_contact_catalog_assignments()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  previous_label text := old.group_key || ': ' || old.name;
  next_label text := new.group_key || ': ' || new.name;
begin
  if new.kind = 'contact-tag' and previous_label <> next_label then
    update public.contacts as c
      set tags = array(
        select distinct on (replaced.label) replaced.label
        from unnest(c.tags) as tag(label)
        cross join lateral (select case when tag.label = previous_label then next_label else tag.label end as label) replaced
        order by replaced.label
      )
      where c.user_id = new.user_id and c.tags @> array[previous_label];
  end if;
  return new;
end;
$$;
create trigger rename_contact_catalog_assignments after update of name, group_key
  on public.user_catalog_entries for each row execute function public.rename_contact_catalog_assignments();

-- Carry the published classification into each launch in the same transaction.
create function public.copy_case_catalog_tags()
returns trigger language plpgsql set search_path = '' as $$
declare
  labels jsonb;
begin
  if new.template_version_id is null or coalesce(cardinality(new.tags), 0) > 0 then
    return new;
  end if;
  select snapshot #> '{requirements_schema,catalogTags}' into labels
    from public.case_file_template_versions
    where id = new.template_version_id and template_id = new.template_id;
  if jsonb_typeof(labels) = 'array' then
    new.tags := array(
      select distinct btrim(item->>'nombre')
      from jsonb_array_elements(labels) item
      where jsonb_typeof(item->'nombre') = 'string'
        and char_length(btrim(item->>'nombre')) between 1 and 80
      order by 1
      limit 100
    );
  end if;
  return new;
end;
$$;
create trigger copy_case_catalog_tags before insert on public.case_files
  for each row execute function public.copy_case_catalog_tags();
