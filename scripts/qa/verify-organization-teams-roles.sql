-- Production-safe regression: all example rows, memberships and grants roll back.
-- No credentials, invitations, messages, sessions or external side effects.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';
DO $qa$
DECLARE ws uuid; owner_user uuid; owner_member uuid; other_user uuid; other_member uuid;
  v_unit uuid; v_child uuid; v_role uuid; v_permission uuid; before_name text;
BEGIN
  SELECT w.id,w.owner_id,m.id INTO ws,owner_user,owner_member
  FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id
    AND m.user_id=w.owner_id AND m.status='active' WHERE w.workspace_type='business' ORDER BY w.created_at LIMIT 1;
  IF ws IS NULL THEN RAISE EXCEPTION 'Business fixture missing'; END IF;
  SELECT u.id INTO other_user FROM auth.users u WHERE u.id<>owner_user
    AND NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=u.id) LIMIT 1;
  IF other_user IS NULL THEN RAISE EXCEPTION 'Second fixture account missing'; END IF;
  INSERT INTO public.workspace_members(workspace_id,user_id,role,status)
    VALUES(ws,other_user,'member','active') RETURNING id INTO other_member;
  SELECT id INTO v_permission FROM public.organization_permissions WHERE permission_key='teams.read';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_unit:=public.save_organization_unit_bundle(ws,jsonb_build_object('name','QA rollback team','unit_type','team',
    'leader_member_id',owner_member),ARRAY[]::uuid[]);
  IF NOT EXISTS(SELECT 1 FROM public.organization_unit_members WHERE unit_id=v_unit AND member_id=owner_member AND is_lead) THEN
    RAISE EXCEPTION 'Leader is missing from team'; END IF;
  v_child:=public.save_organization_unit_bundle(ws,jsonb_build_object('name','QA rollback child','unit_type','team',
    'parent_id',v_unit,'leader_member_id',other_member),NULL);
  IF NOT EXISTS(SELECT 1 FROM public.organization_unit_members WHERE unit_id=v_child AND member_id=other_member AND is_lead) THEN
    RAISE EXCEPTION 'Omitted membership selection did not include leader'; END IF;
  PERFORM public.set_organization_member_units(ws,other_member,ARRAY[v_unit,v_child]);
  IF NOT EXISTS(SELECT 1 FROM public.organization_unit_members WHERE unit_id=v_unit AND member_id=other_member AND NOT is_lead)
    OR NOT EXISTS(SELECT 1 FROM public.organization_unit_members WHERE unit_id=v_child AND member_id=other_member AND is_lead) THEN
    RAISE EXCEPTION 'Member team assignments or leader flags are wrong'; END IF;
  BEGIN
    PERFORM public.set_organization_member_units(ws,other_member,ARRAY[v_unit]);
    RAISE EXCEPTION 'Member editor removed a team leader';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.set_organization_unit_members(ws,v_child,ARRAY[]::uuid[]);
    RAISE EXCEPTION 'Team editor removed a team leader';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.set_organization_member_units(ws,other_member,ARRAY[v_child,gen_random_uuid()]);
    RAISE EXCEPTION 'Member assigned to a foreign team';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.save_organization_unit_bundle(ws,jsonb_build_object('id',v_unit,'name','Must roll back','unit_type','team','parent_id',v_child),NULL);
    RAISE EXCEPTION 'Circular team hierarchy accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.save_organization_unit_bundle(ws,jsonb_build_object('id',v_unit,'name','Must roll back','unit_type','team','cost_center_id',gen_random_uuid()),NULL);
    RAISE EXCEPTION 'Foreign cost center accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.workspaces SET name=name WHERE id=ws;
  BEGIN
    UPDATE public.workspaces SET owner_id=other_user WHERE id=ws;
    RAISE EXCEPTION 'Direct owner transfer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.workspace_members SET role='member' WHERE id=owner_member;
    RAISE EXCEPTION 'Owner role changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.workspace_members SET status='suspended' WHERE id=owner_member;
    RAISE EXCEPTION 'Owner was suspended';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.save_organization_unit_bundle(ws,jsonb_build_object('id',v_unit,'name','Must roll back','unit_type','team'),ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'Foreign member accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT name INTO before_name FROM public.organization_units WHERE id=v_unit;
  IF before_name<>'QA rollback team' THEN RAISE EXCEPTION 'Partial team update survived'; END IF;
  -- Administrative permissions require organization scope; limited resource
  -- scopes are exercised separately by the resource-boundary regression.
  v_role:=public.save_organization_role_bundle(ws,jsonb_build_object('name','QA rollback role','scope_type','organization'),ARRAY[v_permission]);
  IF NOT EXISTS(SELECT 1 FROM public.organization_role_permissions rp WHERE rp.role_id=v_role AND rp.permission_id=v_permission) THEN
    RAISE EXCEPTION 'Permission IDs were not converted to keys'; END IF;
  BEGIN
    PERFORM public.save_organization_role_bundle(ws,jsonb_build_object('id',v_role,'name','Must roll back','scope_type','organization'),ARRAY[gen_random_uuid()]);
    RAISE EXCEPTION 'Unknown permission accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT name FROM public.organization_roles WHERE id=v_role)<>'QA rollback role' THEN
    RAISE EXCEPTION 'Partial role update survived'; END IF;
  PERFORM public.set_organization_member_roles(ws,other_member,ARRAY[v_role]);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
  IF NOT public.has_organization_permission(ws,'teams.read') OR public.has_organization_permission(ws,'teams.manage') THEN
    RAISE EXCEPTION 'Custom role effective permissions are wrong'; END IF;
  BEGIN
    PERFORM public.save_organization_unit_bundle(ws,jsonb_build_object('name','Forbidden team','unit_type','team'),ARRAY[]::uuid[]);
    RAISE EXCEPTION 'Reader edited a team';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.has_organization_permission(gen_random_uuid(),'teams.read') THEN RAISE EXCEPTION 'Cross-tenant access'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
  UPDATE public.organization_roles SET status='archived' WHERE id=v_role;
  BEGIN
    PERFORM public.set_organization_member_roles(ws,other_member,ARRAY[v_role]);
    RAISE EXCEPTION 'Archived role assigned';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
  IF public.has_organization_permission(ws,'teams.read') THEN RAISE EXCEPTION 'Archived role retained access'; END IF;
  IF has_function_privilege('anon','public.save_organization_unit_bundle(uuid,jsonb,uuid[])','EXECUTE')
    OR has_function_privilege('anon','public.save_organization_role_bundle(uuid,jsonb,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous mutation exposed'; END IF;
END $qa$;
ROLLBACK;
