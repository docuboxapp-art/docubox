-- Preserve existing ACL and RLS behavior; reject archived roles and inconsistent leadership.
CREATE OR REPLACE FUNCTION public.set_organization_member_roles(
  ws_id UUID,
  target_member_id UUID,
  requested_role_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_role public.workspace_member_role;
  target_role public.workspace_member_role;
  invalid_role_count INTEGER;
  assigns_admin BOOLEAN;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'roles.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO actor_role
  FROM public.workspace_members
  WHERE workspace_id = ws_id AND user_id = auth.uid() AND status = 'active';

  SELECT role INTO target_role
  FROM public.workspace_members
  WHERE id = target_member_id AND workspace_id = ws_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'organization_member_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF target_role = 'owner'::public.workspace_member_role THEN
    RAISE EXCEPTION 'organization_owner_role_is_protected' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO invalid_role_count
  FROM unnest(COALESCE(requested_role_ids, ARRAY[]::UUID[])) AS requested(requested_id)
  LEFT JOIN public.organization_roles role
    ON role.id = requested_id AND role.workspace_id = ws_id
  WHERE role.id IS NULL OR role.system_key = 'owner' OR role.status <> 'active';

  IF invalid_role_count > 0 THEN
    RAISE EXCEPTION 'organization_role_scope_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_roles
    WHERE workspace_id = ws_id
      AND id = ANY(COALESCE(requested_role_ids, ARRAY[]::UUID[]))
      AND system_key = 'admin'
  ) INTO assigns_admin;

  IF assigns_admin AND actor_role <> 'owner'::public.workspace_member_role THEN
    RAISE EXCEPTION 'organization_admin_assignment_requires_owner' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.organization_member_roles
  WHERE workspace_id = ws_id AND member_id = target_member_id;

  INSERT INTO public.organization_member_roles (workspace_id, member_id, role_id, assigned_by)
  SELECT ws_id, target_member_id, role.id, auth.uid()
  FROM public.organization_roles role
  WHERE role.workspace_id = ws_id
    AND role.id = ANY(COALESCE(requested_role_ids, ARRAY[]::UUID[]));

  UPDATE public.workspace_members
  SET role = CASE
        WHEN assigns_admin THEN 'admin'::public.workspace_member_role
        ELSE 'member'::public.workspace_member_role
      END
  WHERE id = target_member_id AND workspace_id = ws_id;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, severity, module
  ) VALUES (
    ws_id, auth.uid(), 'member.roles.updated', 'workspace_member', target_member_id::TEXT,
    'Roles del miembro actualizados',
    jsonb_build_object('role_ids', COALESCE(requested_role_ids, ARRAY[]::UUID[])),
    'high', 'members'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_member_units(
  ws_id UUID,
  target_member_id UUID,
  requested_unit_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  invalid_unit_count INTEGER;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'teams.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE id = target_member_id AND workspace_id = ws_id AND status = 'active'
      AND (access_expires_at IS NULL OR access_expires_at > CURRENT_TIMESTAMP)
  ) THEN
    RAISE EXCEPTION 'organization_member_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO invalid_unit_count
  FROM unnest(COALESCE(requested_unit_ids, ARRAY[]::UUID[])) AS requested(requested_id)
  LEFT JOIN public.organization_units unit
    ON unit.id = requested_id AND unit.workspace_id = ws_id AND unit.status = 'active'
  WHERE unit.id IS NULL;

  IF invalid_unit_count > 0 THEN
    RAISE EXCEPTION 'organization_unit_scope_invalid' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_units unit WHERE unit.workspace_id=ws_id AND unit.status='active'
    AND (unit.leader_member_id=target_member_id OR unit.deputy_member_id=target_member_id)
    AND NOT (unit.id=ANY(COALESCE(requested_unit_ids,ARRAY[]::uuid[])))) THEN
    RAISE EXCEPTION 'organization_unit_lead_membership_required' USING ERRCODE='23514';
  END IF;

  DELETE FROM public.organization_unit_members membership
  USING public.organization_units unit
  WHERE membership.unit_id = unit.id
    AND membership.member_id = target_member_id
    AND unit.workspace_id = ws_id;

  INSERT INTO public.organization_unit_members (unit_id, member_id, is_lead)
  SELECT unit.id, target_member_id, coalesce(unit.leader_member_id=target_member_id,false)
  FROM public.organization_units unit
  WHERE unit.workspace_id = ws_id
    AND unit.status = 'active'
    AND unit.id = ANY(COALESCE(requested_unit_ids, ARRAY[]::UUID[]));

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, module
  ) VALUES (
    ws_id, auth.uid(), 'member.units.updated', 'workspace_member', target_member_id::TEXT,
    'Equipos del miembro actualizados',
    jsonb_build_object('unit_ids', COALESCE(requested_unit_ids, ARRAY[]::UUID[])),
    'members'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_unit_members(
  ws_id UUID,
  target_unit_id UUID,
  requested_member_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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
        AND (member.access_expires_at IS NULL OR member.access_expires_at>CURRENT_TIMESTAMP)
    )
  ) THEN
    RAISE EXCEPTION 'organization_unit_member_scope_invalid' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_units unit WHERE unit.id=target_unit_id AND unit.workspace_id=ws_id
    AND ((unit.leader_member_id IS NOT NULL AND NOT unit.leader_member_id=ANY(COALESCE(requested_member_ids,ARRAY[]::uuid[])))
      OR (unit.deputy_member_id IS NOT NULL AND NOT unit.deputy_member_id=ANY(COALESCE(requested_member_ids,ARRAY[]::uuid[]))))) THEN
    RAISE EXCEPTION 'organization_unit_lead_membership_required' USING ERRCODE='23514';
  END IF;

  DELETE FROM public.organization_unit_members WHERE unit_id = target_unit_id;
  INSERT INTO public.organization_unit_members(unit_id, member_id, is_lead)
  SELECT target_unit_id, requested_id, coalesce((SELECT leader_member_id=requested_id FROM public.organization_units WHERE id=target_unit_id),false)
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
