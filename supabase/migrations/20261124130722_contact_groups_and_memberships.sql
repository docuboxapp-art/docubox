CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_user_id_key ON public.contacts (id, user_id);

CREATE FUNCTION public.contact_group_name_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$
  SELECT lower(btrim(regexp_replace(normalize(value, NFC), '[[:space:]]+', ' ', 'g')));
$$;
REVOKE ALL ON FUNCTION public.contact_group_name_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_group_name_key(text) TO authenticated, service_role;

CREATE TABLE public.contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  name_key text GENERATED ALWAYS AS (public.contact_group_name_key(name)) STORED,
  icon text NOT NULL DEFAULT '👥' CHECK (char_length(btrim(icon)) BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (user_id, name_key),
  CHECK (name_key <> '')
);

CREATE TABLE public.contact_group_members (
  group_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id),
  FOREIGN KEY (group_id, user_id) REFERENCES public.contact_groups (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, user_id) REFERENCES public.contacts (id, user_id) ON DELETE CASCADE
);

CREATE INDEX contact_group_members_contact_idx ON public.contact_group_members (contact_id, user_id);
CREATE INDEX contact_group_members_user_idx ON public.contact_group_members (user_id, group_id);

-- Preserve current assignments and restore empty groups recorded as removed from a contact.
WITH legacy AS MATERIALIZED (
  SELECT f.id, f.user_id, f.contact_id, f.created_at,
    btrim(regexp_replace(normalize(f.field_value, NFC), '[[:space:]]+', ' ', 'g')) AS name
  FROM public.contact_custom_fields AS f
  JOIN public.contacts AS c ON c.id = f.contact_id AND c.user_id = f.user_id
  WHERE f.field_name = 'contact_group' AND f.field_value IS NOT NULL
), removed AS (
  SELECT f.id, f.user_id, f.created_at,
    btrim(regexp_replace(normalize(substr(f.field_value, char_length('Grupo retirado · ') + 1), NFC), '[[:space:]]+', ' ', 'g')) AS name
  FROM public.contact_custom_fields AS f
  JOIN public.contacts AS c ON c.id = f.contact_id AND c.user_id = f.user_id
  WHERE f.field_name = 'agenda_history' AND f.field_value LIKE 'Grupo retirado · %'
), catalog AS (
  SELECT l.id, l.user_id, l.created_at, l.name, true AS has_member FROM legacy AS l
  UNION ALL
  SELECT r.id, r.user_id, r.created_at, r.name, false FROM removed AS r
), imported_groups AS (
  INSERT INTO public.contact_groups (user_id, name, created_at)
  SELECT DISTINCT ON (g.user_id, lower(g.name)) g.user_id, g.name, g.created_at
  FROM catalog AS g
  WHERE g.name <> ''
  ORDER BY g.user_id, lower(g.name), g.has_member DESC, g.created_at, g.id
  RETURNING id, user_id, name_key
)
INSERT INTO public.contact_group_members (group_id, contact_id, user_id, created_at)
SELECT g.id, l.contact_id, g.user_id, min(l.created_at)
FROM legacy AS l
JOIN imported_groups AS g ON g.user_id = l.user_id AND g.name_key = lower(l.name)
GROUP BY g.id, l.contact_id, g.user_id;

-- The original UI limited new names to 80 characters. Keep older imported values intact.
ALTER TABLE public.contact_groups ADD CONSTRAINT contact_group_name_length
  CHECK (char_length(name) <= 80) NOT VALID;

ALTER TABLE public.contact_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_group_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.contact_groups, public.contact_group_members FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.contact_groups TO authenticated;
GRANT UPDATE (name, icon) ON public.contact_groups TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.contact_group_members TO authenticated;
GRANT ALL ON public.contact_groups, public.contact_group_members TO service_role;

CREATE POLICY contact_groups_select_own ON public.contact_groups
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY contact_groups_insert_own ON public.contact_groups
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY contact_groups_update_own ON public.contact_groups
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY contact_groups_delete_own ON public.contact_groups
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY contact_group_members_manage_own ON public.contact_group_members
  FOR ALL TO authenticated USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE FUNCTION public.create_contact_group(p_contact_id uuid, p_name text)
RETURNS TABLE (id uuid, name text, assigned_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid := (SELECT auth.uid());
  group_name text := btrim(regexp_replace(normalize(p_name, NFC), '[[:space:]]+', ' ', 'g'));
  selected_group public.contact_groups%ROWTYPE;
BEGIN
  IF owner_id IS NULL OR NOT EXISTS (
    SELECT FROM public.contacts AS c WHERE c.id = p_contact_id AND c.user_id = owner_id
  ) THEN
    RAISE EXCEPTION 'CONTACT_GROUP_CONTACT_DENIED' USING ERRCODE = '42501';
  END IF;
  IF group_name IS NULL OR group_name = '' OR char_length(group_name) > 80 THEN
    RAISE EXCEPTION 'CONTACT_GROUP_NAME_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.contact_groups (user_id, name)
  VALUES (owner_id, group_name)
  ON CONFLICT (user_id, name_key) DO NOTHING
  RETURNING * INTO selected_group;

  IF selected_group.id IS NULL THEN
    SELECT g.* INTO selected_group FROM public.contact_groups AS g
    WHERE g.user_id = owner_id AND g.name_key = lower(group_name);

    -- A retry can return the assignment already made by the same request.
    IF NOT EXISTS (
      SELECT FROM public.contact_group_members AS m
      WHERE m.group_id = selected_group.id AND m.contact_id = p_contact_id AND m.user_id = owner_id
    ) THEN
      RAISE EXCEPTION 'CONTACT_GROUP_NAME_IN_USE' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.contact_group_members (group_id, contact_id, user_id)
    VALUES (selected_group.id, p_contact_id, owner_id);
  END IF;

  RETURN QUERY SELECT selected_group.id, selected_group.name, m.created_at
  FROM public.contact_group_members AS m
  WHERE m.group_id = selected_group.id AND m.contact_id = p_contact_id AND m.user_id = owner_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_contact_group(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_contact_group(uuid, text) TO authenticated;

CREATE FUNCTION public.delete_contact_group(p_group_id uuid, p_reassign_to uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  owner_id uuid := (SELECT auth.uid());
  expected_groups integer := CASE WHEN p_reassign_to IS NULL THEN 1 ELSE 2 END;
  locked_groups integer;
BEGIN
  IF owner_id IS NULL OR p_group_id IS NULL OR p_group_id = p_reassign_to THEN
    RAISE EXCEPTION 'CONTACT_GROUP_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Lock the same pair in a consistent order and serialize with new memberships' foreign keys.
  PERFORM g.id FROM public.contact_groups AS g
  WHERE g.user_id = owner_id AND (g.id = p_group_id OR g.id = p_reassign_to)
  ORDER BY g.id FOR UPDATE;
  GET DIAGNOSTICS locked_groups = ROW_COUNT;
  IF locked_groups <> expected_groups THEN
    RAISE EXCEPTION 'CONTACT_GROUP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_reassign_to IS NOT NULL THEN
    INSERT INTO public.contact_group_members (group_id, contact_id, user_id)
    SELECT p_reassign_to, m.contact_id, m.user_id
    FROM public.contact_group_members AS m
    WHERE m.group_id = p_group_id AND m.user_id = owner_id
    ORDER BY m.contact_id
    ON CONFLICT (group_id, contact_id) DO NOTHING;
  END IF;

  DELETE FROM public.contact_groups AS g WHERE g.id = p_group_id AND g.user_id = owner_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_contact_group(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_contact_group(uuid, uuid) TO authenticated;

-- Older clients still write contact_custom_fields. Keep the membership projection in sync
-- during rollout. The catalog persists even if the last legacy assignment is removed.
CREATE FUNCTION public.sync_legacy_contact_group_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  group_name text;
  catalog_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  IF TG_OP <> 'INSERT' AND OLD.field_name = 'contact_group' THEN
    DELETE FROM public.contact_group_members AS m
    USING public.contact_groups AS g
    WHERE g.id = m.group_id AND g.user_id = OLD.user_id
      AND g.name_key = public.contact_group_name_key(OLD.field_value)
      AND m.contact_id = OLD.contact_id AND m.user_id = OLD.user_id
      AND NOT EXISTS (
        SELECT FROM public.contact_custom_fields AS f
        WHERE f.user_id = OLD.user_id AND f.contact_id = OLD.contact_id
          AND f.field_name = 'contact_group'
          AND public.contact_group_name_key(f.field_value) = g.name_key
      );
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.field_name = 'contact_group' THEN
    group_name := btrim(regexp_replace(normalize(NEW.field_value, NFC), '[[:space:]]+', ' ', 'g'));
    IF group_name IS NULL OR group_name = '' THEN RETURN NULL; END IF;
    IF NOT EXISTS (
      SELECT FROM public.contacts AS c WHERE c.id = NEW.contact_id AND c.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'CONTACT_GROUP_CONTACT_DENIED' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.contact_groups (user_id, name, created_at)
    VALUES (NEW.user_id, group_name, NEW.created_at)
    ON CONFLICT (user_id, name_key) DO NOTHING
    RETURNING id INTO catalog_id;
    IF catalog_id IS NULL THEN
      SELECT g.id INTO catalog_id FROM public.contact_groups AS g
      WHERE g.user_id = NEW.user_id AND g.name_key = lower(group_name);
    END IF;
    INSERT INTO public.contact_group_members (group_id, contact_id, user_id, created_at)
    VALUES (catalog_id, NEW.contact_id, NEW.user_id, NEW.created_at)
    ON CONFLICT (group_id, contact_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER sync_legacy_contact_group_assignment
AFTER INSERT OR DELETE OR UPDATE OF field_name, field_value, user_id, contact_id ON public.contact_custom_fields
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_contact_group_assignment();

CREATE FUNCTION public.sync_catalog_contact_group_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contact_custom_fields (contact_id, user_id, field_name, field_value, created_at)
    SELECT NEW.contact_id, NEW.user_id, 'contact_group', g.name, NEW.created_at
    FROM public.contact_groups AS g
    WHERE g.id = NEW.group_id AND g.user_id = NEW.user_id
      AND NOT EXISTS (
        SELECT FROM public.contact_custom_fields AS f
        WHERE f.contact_id = NEW.contact_id AND f.user_id = NEW.user_id
          AND f.field_name = 'contact_group'
          AND public.contact_group_name_key(f.field_value) = g.name_key
      );
  ELSE
    DELETE FROM public.contact_custom_fields AS f
    USING public.contact_groups AS g
    WHERE g.id = OLD.group_id AND g.user_id = OLD.user_id
      AND f.contact_id = OLD.contact_id AND f.user_id = OLD.user_id
      AND f.field_name = 'contact_group' AND public.contact_group_name_key(f.field_value) = g.name_key;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER sync_catalog_contact_group_assignment
AFTER INSERT OR DELETE ON public.contact_group_members
FOR EACH ROW EXECUTE FUNCTION public.sync_catalog_contact_group_assignment();

CREATE FUNCTION public.sync_legacy_contact_group_name()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.contact_custom_fields AS f
    WHERE f.user_id = OLD.user_id AND f.field_name = 'contact_group'
      AND public.contact_group_name_key(f.field_value) = OLD.name_key;
    RETURN OLD;
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.contact_custom_fields AS f SET field_value = NEW.name
    WHERE f.user_id = OLD.user_id AND f.field_name = 'contact_group'
      AND public.contact_group_name_key(f.field_value) = OLD.name_key;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_legacy_contact_group_name
BEFORE UPDATE OF name OR DELETE ON public.contact_groups
FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_contact_group_name();

REVOKE ALL ON FUNCTION public.sync_legacy_contact_group_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_catalog_contact_group_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_legacy_contact_group_name() FROM PUBLIC, anon, authenticated;
