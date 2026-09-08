-- LucIA Phase 3 authorization smoke test against existing, non-mutated data.

CREATE TEMP TABLE lucia_phase3_smoke (
  case_name TEXT,
  candidate_found BOOLEAN,
  expected TEXT,
  actual TEXT,
  passed BOOLEAN
);

DO $$
DECLARE
  v_user_id UUID;
  v_workspace_id UUID;
  v_resource_id UUID;
  v_result JSONB;
BEGIN
  SELECT wm.user_id INTO v_user_id
  FROM public.workspace_members wm WHERE wm.status = 'active' LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_user_id, 'role', 'authenticated')::text, true);
    v_result := public.get_lucia_organization_context(gen_random_uuid(), NULL, NULL);
    INSERT INTO lucia_phase3_smoke VALUES (
      'user_without_workspace', true, 'WORKSPACE_ACCESS_DENIED',
      v_result->>'error_code', v_result->>'error_code' = 'WORKSPACE_ACCESS_DENIED');
  ELSE
    INSERT INTO lucia_phase3_smoke VALUES (
      'user_without_workspace', false, 'WORKSPACE_ACCESS_DENIED', NULL, NULL);
  END IF;

  SELECT wm.user_id, wm.workspace_id INTO v_user_id, v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.status = 'active'
    AND lower(wm.role::text) IN ('owner', 'admin', 'workspace_admin')
  LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_user_id, 'role', 'authenticated')::text, true);
    v_result := public.get_lucia_organization_context(v_workspace_id, NULL, NULL);
    INSERT INTO lucia_phase3_smoke VALUES (
      'workspace_manager', true, 'true',
      v_result#>>'{permission,can_view}', v_result#>>'{permission,can_view}' = 'true');
  ELSE
    INSERT INTO lucia_phase3_smoke VALUES ('workspace_manager', false, 'true', NULL, NULL);
  END IF;

  SELECT actor.user_id, actor.workspace_id, target.id
  INTO v_user_id, v_workspace_id, v_resource_id
  FROM public.workspace_members actor
  JOIN public.workspace_members target
    ON target.workspace_id = actor.workspace_id AND target.user_id <> actor.user_id
  WHERE actor.status = 'active'
    AND lower(actor.role::text) NOT IN ('owner', 'admin', 'workspace_admin')
    AND NOT EXISTS (
      SELECT 1
      FROM public.organization_member_roles omr
      JOIN public.organization_role_permissions orp ON orp.role_id = omr.role_id
      JOIN public.organization_permissions op ON op.id = orp.permission_id
      WHERE omr.member_id = actor.id
        AND omr.workspace_id = actor.workspace_id
        AND op.permission_key = 'members.read'
    )
  LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_user_id, 'role', 'authenticated')::text, true);
    v_result := public.get_lucia_organization_context(v_workspace_id, 'miembros', v_resource_id);
    INSERT INTO lucia_phase3_smoke VALUES (
      'member_without_permission', true, 'RESOURCE_NOT_FOUND_OR_DENIED',
      v_result->>'error_code', v_result->>'error_code' = 'RESOURCE_NOT_FOUND_OR_DENIED');
  ELSE
    INSERT INTO lucia_phase3_smoke VALUES (
      'member_without_permission', false, 'RESOURCE_NOT_FOUND_OR_DENIED', NULL, NULL);
  END IF;

  SELECT cfp.user_id, cf.workspace_id, cf.id
  INTO v_user_id, v_workspace_id, v_resource_id
  FROM public.case_file_participants cfp
  JOIN public.case_files cf ON cf.id = cfp.case_file_id
  WHERE cfp.status = 'active' AND cfp.user_id IS NOT NULL
    AND cfp.user_id <> cf.owner_user_id AND cfp.user_id <> cf.created_by
  LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_user_id, 'role', 'authenticated')::text, true);
    v_result := public.get_lucia_case_file_context(v_workspace_id, v_resource_id);
    INSERT INTO lucia_phase3_smoke VALUES (
      'authorized_case_participant', true, 'true',
      v_result#>>'{permission,can_view}', v_result#>>'{permission,can_view}' = 'true');
  ELSE
    INSERT INTO lucia_phase3_smoke VALUES (
      'authorized_case_participant', false, 'true', NULL, NULL);
  END IF;

  SELECT wm.user_id, cf.workspace_id, cf.id
  INTO v_user_id, v_workspace_id, v_resource_id
  FROM public.workspace_members wm
  JOIN public.case_files cf ON cf.workspace_id <> wm.workspace_id
  WHERE wm.status = 'active'
    AND wm.user_id <> cf.owner_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.case_file_participants cfp
      WHERE cfp.case_file_id = cf.id AND cfp.user_id = wm.user_id AND cfp.status = 'active'
    )
  LIMIT 1;
  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_user_id, 'role', 'authenticated')::text, true);
    v_result := public.get_lucia_case_file_context(v_workspace_id, v_resource_id);
    INSERT INTO lucia_phase3_smoke VALUES (
      'external_workspace_user', true, 'WORKSPACE_ACCESS_DENIED',
      v_result->>'error_code', v_result->>'error_code' = 'WORKSPACE_ACCESS_DENIED');
  ELSE
    INSERT INTO lucia_phase3_smoke VALUES (
      'external_workspace_user', false, 'WORKSPACE_ACCESS_DENIED', NULL, NULL);
  END IF;
END;
$$;

SELECT * FROM lucia_phase3_smoke ORDER BY case_name;
