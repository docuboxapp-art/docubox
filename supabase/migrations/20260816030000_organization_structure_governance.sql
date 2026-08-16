-- Organization structure and role governance hardening.

ALTER TABLE public.organization_units
  ADD COLUMN IF NOT EXISTS internal_key TEXT,
  ADD COLUMN IF NOT EXISTS unit_type TEXT NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS deputy_member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES public.organization_cost_centers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_overrides JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.organization_units DROP CONSTRAINT IF EXISTS organization_units_unit_type_check;
ALTER TABLE public.organization_units
  ADD CONSTRAINT organization_units_unit_type_check
  CHECK (unit_type IN ('area', 'department', 'team', 'branch', 'business_unit'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_units_internal_key
  ON public.organization_units(workspace_id, lower(internal_key))
  WHERE internal_key IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_organization_units_hierarchy
  ON public.organization_units(workspace_id, parent_id, status, name);

ALTER TABLE public.organization_roles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'organization',
  ADD COLUMN IF NOT EXISTS scope_config JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.organization_roles DROP CONSTRAINT IF EXISTS organization_roles_status_check;
ALTER TABLE public.organization_roles
  ADD CONSTRAINT organization_roles_status_check CHECK (status IN ('active', 'archived'));
ALTER TABLE public.organization_roles DROP CONSTRAINT IF EXISTS organization_roles_scope_type_check;
ALTER TABLE public.organization_roles
  ADD CONSTRAINT organization_roles_scope_type_check
  CHECK (scope_type IN ('organization', 'units', 'team', 'own', 'assigned', 'custom'));

CREATE INDEX IF NOT EXISTS idx_organization_roles_status
  ON public.organization_roles(workspace_id, status, is_system DESC, name);

CREATE OR REPLACE FUNCTION public.set_organization_unit_members(
  ws_id UUID,
  target_unit_id UUID,
  requested_member_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_organization_permission(ws_id, 'teams.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_units
    WHERE id = target_unit_id AND workspace_id = ws_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'organization_unit_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(requested_member_ids, ARRAY[]::UUID[])) requested_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.id = requested_id AND member.workspace_id = ws_id AND member.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'organization_unit_member_scope_invalid' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.organization_unit_members WHERE unit_id = target_unit_id;
  INSERT INTO public.organization_unit_members(unit_id, member_id)
  SELECT target_unit_id, requested_id
  FROM unnest(COALESCE(requested_member_ids, ARRAY[]::UUID[])) requested_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.organization_audit_events(
    workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload, module
  ) VALUES (
    ws_id, auth.uid(), 'organization.unit.members.updated', 'organization_unit', target_unit_id,
    'Membresías de unidad actualizadas', jsonb_build_object('member_count', cardinality(COALESCE(requested_member_ids, ARRAY[]::UUID[]))), 'teams'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_organization_unit_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  related_workspace_id UUID;
BEGIN
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'organization_unit_self_parent' USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE lineage AS (
      SELECT unit.id, unit.parent_id
      FROM public.organization_units unit
      WHERE unit.id = NEW.parent_id AND unit.workspace_id = NEW.workspace_id
      UNION ALL
      SELECT parent.id, parent.parent_id
      FROM public.organization_units parent
      JOIN lineage child ON child.parent_id = parent.id
      WHERE parent.workspace_id = NEW.workspace_id
    )
    SELECT 1 FROM lineage WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'organization_unit_hierarchy_cycle' USING ERRCODE = '23514';
  END IF;

  IF NEW.deputy_member_id IS NOT NULL THEN
    SELECT workspace_id INTO related_workspace_id
    FROM public.workspace_members WHERE id = NEW.deputy_member_id;
    IF related_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'organization_unit_deputy_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.cost_center_id IS NOT NULL THEN
    SELECT workspace_id INTO related_workspace_id
    FROM public.organization_cost_centers WHERE id = NEW.cost_center_id;
    IF related_workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'organization_unit_cost_center_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'inactive' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'inactive') THEN
    NEW.archived_at := COALESCE(NEW.archived_at, CURRENT_TIMESTAMP);
  ELSIF NEW.status = 'active' THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_organization_unit_hierarchy ON public.organization_units;
CREATE TRIGGER validate_organization_unit_hierarchy
  BEFORE INSERT OR UPDATE ON public.organization_units
  FOR EACH ROW EXECUTE FUNCTION public.validate_organization_unit_hierarchy();

CREATE OR REPLACE FUNCTION public.protect_organization_system_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.system_key IS DISTINCT FROM OLD.system_key
    OR NEW.is_system IS DISTINCT FROM OLD.is_system
    OR NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'organization_system_role_is_protected' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    NEW.archived_at := CURRENT_TIMESTAMP;
  ELSIF NEW.status = 'active' THEN
    NEW.archived_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_organization_system_roles ON public.organization_roles;
CREATE TRIGGER protect_organization_system_roles
  BEFORE UPDATE ON public.organization_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_organization_system_roles();

REVOKE ALL ON FUNCTION public.validate_organization_unit_hierarchy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_organization_system_roles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_unit_members(UUID, UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_organization_unit_members(UUID, UUID, UUID[]) TO authenticated;
