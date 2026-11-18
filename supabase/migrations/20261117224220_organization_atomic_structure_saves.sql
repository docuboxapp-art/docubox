-- Invoker functions compose existing RLS-protected operations transactionally.
-- No table grants, account memberships or existing role permissions are changed.
CREATE OR REPLACE FUNCTION public.save_organization_unit_bundle(
  ws_id uuid, unit_data jsonb, requested_member_ids uuid[] DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target_id uuid := nullif(unit_data->>'id','')::uuid;
  parent_unit uuid := nullif(unit_data->>'parent_id','')::uuid;
  lead_member uuid := nullif(unit_data->>'leader_member_id','')::uuid;
  deputy_member uuid := nullif(unit_data->>'deputy_member_id','')::uuid;
  center_id uuid := nullif(unit_data->>'cost_center_id','')::uuid;
  selected_members uuid[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_organization_permission(ws_id,'teams.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws_id AND workspace_type='business') THEN
    RAISE EXCEPTION 'organization_workspace_required' USING ERRCODE='23514';
  END IF;
  IF coalesce(length(btrim(unit_data->>'name')),0) NOT BETWEEN 2 AND 120
    OR coalesce(unit_data->>'unit_type','') NOT IN('area','department','team','branch','business_unit') THEN
    RAISE EXCEPTION 'organization_unit_input_invalid' USING ERRCODE='23514';
  END IF;
  IF target_id IS NOT NULL THEN
    PERFORM 1 FROM public.organization_units WHERE id=target_id AND workspace_id=ws_id AND status='active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'organization_unit_not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  IF parent_unit IS NOT NULL AND (parent_unit=target_id OR NOT EXISTS(
    SELECT 1 FROM public.organization_units WHERE id=parent_unit AND workspace_id=ws_id AND status='active')) THEN
    RAISE EXCEPTION 'organization_unit_parent_invalid' USING ERRCODE='23514';
  END IF;
  IF center_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.organization_cost_centers
    WHERE id=center_id AND workspace_id=ws_id AND status='active') THEN
    RAISE EXCEPTION 'organization_cost_center_scope_invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(array_remove(ARRAY[lead_member,deputy_member],NULL)) m(id)
    WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE id=m.id AND workspace_id=ws_id
      AND status='active' AND (access_expires_at IS NULL OR access_expires_at>now()))) THEN
    RAISE EXCEPTION 'organization_unit_member_scope_invalid' USING ERRCODE='23514';
  END IF;
  IF target_id IS NULL THEN
    INSERT INTO public.organization_units(workspace_id,name,internal_key,unit_type,description,parent_id,
      leader_member_id,deputy_member_id,cost_center_id,created_by)
    VALUES(ws_id,btrim(unit_data->>'name'),nullif(upper(btrim(unit_data->>'internal_key')),''),unit_data->>'unit_type',
      nullif(btrim(unit_data->>'description'),''),parent_unit,lead_member,deputy_member,center_id,auth.uid())
    RETURNING id INTO target_id;
  ELSE
    UPDATE public.organization_units SET name=btrim(unit_data->>'name'),
      internal_key=nullif(upper(btrim(unit_data->>'internal_key')),''),unit_type=unit_data->>'unit_type',
      description=nullif(btrim(unit_data->>'description'),''),parent_id=parent_unit,
      leader_member_id=lead_member,deputy_member_id=deputy_member,cost_center_id=center_id,updated_at=now()
      WHERE id=target_id AND workspace_id=ws_id;
  END IF;
  IF requested_member_ids IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT id),'{}') INTO selected_members
      FROM unnest(array_remove(requested_member_ids||ARRAY[lead_member,deputy_member],NULL)) m(id);
    IF cardinality(selected_members)>1000 OR EXISTS(SELECT 1 FROM unnest(selected_members) m(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE id=m.id AND workspace_id=ws_id
        AND status='active' AND (access_expires_at IS NULL OR access_expires_at>now()))) THEN
      RAISE EXCEPTION 'organization_unit_member_scope_invalid' USING ERRCODE='23514';
    END IF;
    PERFORM public.set_organization_unit_members(ws_id,target_id,selected_members);
    UPDATE public.organization_unit_members SET is_lead=coalesce(member_id=lead_member,false)
      WHERE unit_id=target_id;
  END IF;
  INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module)
    VALUES(ws_id,auth.uid(),'organization.unit.saved','organization_unit',target_id::text,'Equipo y membresías guardados','teams');
  RETURN target_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_organization_unit_bundle(uuid,jsonb,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_organization_unit_bundle(uuid,jsonb,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_organization_role_bundle(
  ws_id uuid, role_data jsonb, requested_permission_ids uuid[] DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target_id uuid := nullif(role_data->>'id','')::uuid; target_role public.organization_roles;
  permission_ids uuid[]; keys text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_organization_permission(ws_id,'roles.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=ws_id AND workspace_type='business') THEN
    RAISE EXCEPTION 'organization_workspace_required' USING ERRCODE='23514';
  END IF;
  IF coalesce(length(btrim(role_data->>'name')),0) NOT BETWEEN 2 AND 120
    OR coalesce(role_data->>'scope_type','') NOT IN('organization','units','team','own','assigned','custom')
    OR jsonb_typeof(coalesce(role_data->'scope_config','{}'))<>'object' THEN
    RAISE EXCEPTION 'organization_role_input_invalid' USING ERRCODE='23514';
  END IF;
  IF target_id IS NOT NULL THEN
    SELECT * INTO target_role FROM public.organization_roles WHERE id=target_id AND workspace_id=ws_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'organization_role_not_found' USING ERRCODE='P0002'; END IF;
    IF target_role.is_system OR target_role.status<>'active' THEN
      RAISE EXCEPTION 'system_role_is_read_only' USING ERRCODE='42501';
    END IF;
  END IF;
  IF requested_permission_ids IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT id),'{}') INTO permission_ids FROM unnest(requested_permission_ids) p(id);
    IF cardinality(permission_ids)>300 OR EXISTS(SELECT 1 FROM unnest(permission_ids) p(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.organization_permissions WHERE id=p.id)) THEN
      RAISE EXCEPTION 'organization_permission_selection_invalid' USING ERRCODE='23514';
    END IF;
    SELECT coalesce(array_agg(permission_key),'{}') INTO keys FROM public.organization_permissions WHERE id=ANY(permission_ids);
  END IF;
  IF target_id IS NULL THEN
    INSERT INTO public.organization_roles(workspace_id,name,description,scope_type,scope_config,created_by)
    VALUES(ws_id,btrim(role_data->>'name'),nullif(btrim(role_data->>'description'),''),role_data->>'scope_type',
      coalesce(role_data->'scope_config','{}'),auth.uid()) RETURNING id INTO target_id;
  ELSE
    UPDATE public.organization_roles SET name=btrim(role_data->>'name'),description=nullif(btrim(role_data->>'description'),''),
      scope_type=role_data->>'scope_type',scope_config=coalesce(role_data->'scope_config','{}'),updated_at=now()
      WHERE id=target_id AND workspace_id=ws_id;
  END IF;
  IF requested_permission_ids IS NOT NULL THEN
    PERFORM public.set_organization_role_permissions(ws_id,target_id,keys);
  END IF;
  INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module)
    VALUES(ws_id,auth.uid(),'organization.role.saved','organization_role',target_id::text,'Rol y permisos guardados','roles');
  RETURN target_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_organization_role_bundle(uuid,jsonb,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_organization_role_bundle(uuid,jsonb,uuid[]) TO authenticated;

-- Existing authorization helper: archived or cross-workspace role assignments
-- must never keep granting permissions. Preserve owner/admin behavior.
CREATE OR REPLACE FUNCTION public.has_organization_permission(ws_id uuid, requested_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id=ws_id AND wm.user_id=auth.uid() AND wm.status='active'
      AND (wm.access_expires_at IS NULL OR wm.access_expires_at>CURRENT_TIMESTAMP)
      AND (wm.role='owner' OR (wm.role='admin' AND requested_permission<>'organization.transfer_ownership')
        OR EXISTS(SELECT 1 FROM public.organization_member_roles omr
          JOIN public.organization_roles r ON r.id=omr.role_id AND r.workspace_id=wm.workspace_id AND r.status='active'
          JOIN public.organization_role_permissions orp ON orp.role_id=r.id
          JOIN public.organization_permissions op ON op.id=orp.permission_id
          WHERE omr.member_id=wm.id AND omr.workspace_id=ws_id AND op.permission_key=requested_permission)));
$$;
