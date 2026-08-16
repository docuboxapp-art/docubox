-- Organization member detail operations.
-- Keeps role, unit and session changes tenant-scoped, transactional and audited.

CREATE INDEX IF NOT EXISTS idx_org_unit_members_member
  ON public.organization_unit_members(member_id, unit_id);

CREATE INDEX IF NOT EXISTS idx_org_authorities_member
  ON public.organization_authorities(workspace_id, member_id, status);

CREATE INDEX IF NOT EXISTS idx_org_audit_resource
  ON public.organization_audit_events(workspace_id, resource_type, resource_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.set_organization_member_roles(
  ws_id UUID,
  target_member_id UUID,
  requested_role_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  WHERE role.id IS NULL OR role.system_key = 'owner';

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
SET search_path = public
AS $$
DECLARE
  invalid_unit_count INTEGER;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'teams.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE id = target_member_id AND workspace_id = ws_id
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

  DELETE FROM public.organization_unit_members membership
  USING public.organization_units unit
  WHERE membership.unit_id = unit.id
    AND membership.member_id = target_member_id
    AND unit.workspace_id = ws_id;

  INSERT INTO public.organization_unit_members (unit_id, member_id)
  SELECT unit.id, target_member_id
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

CREATE OR REPLACE FUNCTION public.revoke_organization_member_sessions(
  ws_id UUID,
  target_member_id UUID,
  revocation_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  revoked_count INTEGER := 0;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'security.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO target_user_id
  FROM public.workspace_members
  WHERE id = target_member_id AND workspace_id = ws_id;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'organization_member_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH revoked AS (
    UPDATE public.user_sessions
    SET expires_at = CURRENT_TIMESTAMP,
        is_current = FALSE,
        session_token = 'revoked:' || id::TEXT || ':' || extract(epoch from CURRENT_TIMESTAMP)::BIGINT::TEXT
    WHERE user_id = target_user_id
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP OR is_current)
    RETURNING id
  ), recorded AS (
    INSERT INTO public.organization_session_revocations (
      workspace_id, member_id, session_id, scope, reason, revoked_by
    )
    SELECT ws_id, target_member_id, id, 'member_all', NULLIF(trim(revocation_reason), ''), auth.uid()
    FROM revoked
    RETURNING id
  )
  SELECT count(*) INTO revoked_count FROM recorded;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, severity, module
  ) VALUES (
    ws_id, auth.uid(), 'security.member_sessions.revoked', 'workspace_member', target_member_id::TEXT,
    'Sesiones del miembro revocadas',
    jsonb_build_object('revoked_count', revoked_count, 'reason_provided', NULLIF(trim(revocation_reason), '') IS NOT NULL),
    'high', 'security'
  );

  RETURN revoked_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_organization_member_access_status(
  ws_id UUID,
  target_member_id UUID,
  requested_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user_id UUID;
  target_role public.workspace_member_role;
  revoked_count INTEGER := 0;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'members.suspend') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;

  IF requested_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'organization_member_status_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, role INTO target_user_id, target_role
  FROM public.workspace_members
  WHERE id = target_member_id AND workspace_id = ws_id;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'organization_member_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF target_role = 'owner'::public.workspace_member_role THEN
    RAISE EXCEPTION 'organization_owner_access_is_protected' USING ERRCODE = '42501';
  END IF;

  IF target_user_id = auth.uid() AND requested_status = 'suspended' THEN
    RAISE EXCEPTION 'organization_cannot_suspend_self' USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspace_members
  SET status = requested_status,
      suspended_at = CASE WHEN requested_status = 'suspended' THEN CURRENT_TIMESTAMP ELSE NULL END
  WHERE id = target_member_id AND workspace_id = ws_id;

  IF requested_status = 'suspended' THEN
    WITH revoked AS (
      UPDATE public.user_sessions
      SET expires_at = CURRENT_TIMESTAMP,
          is_current = FALSE,
          session_token = 'revoked:' || id::TEXT || ':' || extract(epoch from CURRENT_TIMESTAMP)::BIGINT::TEXT
      WHERE user_id = target_user_id
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP OR is_current)
      RETURNING id
    ), recorded AS (
      INSERT INTO public.organization_session_revocations (
        workspace_id, member_id, session_id, scope, reason, revoked_by
      )
      SELECT ws_id, target_member_id, id, 'member_all', 'Suspensión de acceso', auth.uid()
      FROM revoked
      RETURNING id
    )
    SELECT count(*) INTO revoked_count FROM recorded;
  END IF;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, severity, module
  ) VALUES (
    ws_id, auth.uid(), 'member.' || requested_status, 'workspace_member', target_member_id::TEXT,
    CASE WHEN requested_status = 'suspended' THEN 'Acceso del miembro suspendido' ELSE 'Acceso del miembro reactivado' END,
    jsonb_build_object('status', requested_status, 'revoked_sessions', revoked_count),
    CASE WHEN requested_status = 'suspended' THEN 'high' ELSE 'info' END,
    'members'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_member_roles(UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_member_units(UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_organization_member_sessions(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_member_access_status(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_member_roles(UUID, UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.set_organization_member_units(UUID, UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_organization_member_sessions(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.set_organization_member_access_status(UUID, UUID, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.set_organization_member_roles(UUID, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_member_units(UUID, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_organization_member_sessions(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_organization_member_access_status(UUID, UUID, TEXT) TO authenticated;
