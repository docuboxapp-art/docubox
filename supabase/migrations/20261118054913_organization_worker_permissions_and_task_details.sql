-- Recheck a persisted automation/workflow principal without changing JWT claims.
-- Explicit-actor evaluators are private and cannot be invoked by browser roles.
CREATE OR REPLACE FUNCTION private.organization_actor_context_allowed(ws uuid,permission text,context jsonb,actor uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE member public.workspace_members;workspace public.workspaces;role record;selected_units uuid[];my_teams uuid[];
BEGIN
 IF actor IS NULL THEN RETURN false;END IF;
 IF context IS NULL THEN RETURN false;END IF;
 SELECT * INTO workspace FROM public.workspaces WHERE id=ws;
 IF workspace.id IS NULL THEN RETURN false;END IF;
 -- Keep existing personal-workspace RLS unchanged; this is an additional org boundary.
 IF workspace.workspace_type<>'business' THEN RETURN true;END IF;
 IF NOT coalesce(workspace.organization_enabled,true) THEN RETURN false;END IF;
 SELECT * INTO member FROM public.workspace_members WHERE workspace_id=ws AND user_id=actor AND status='active' AND (access_expires_at IS NULL OR access_expires_at>now());
 IF member.id IS NULL THEN RETURN false;END IF;
 IF member.role IN('owner','admin') THEN RETURN true;END IF;
 SELECT coalesce(array_agg(u.id),'{}') INTO my_teams FROM public.organization_units u JOIN public.organization_unit_members um ON um.unit_id=u.id WHERE um.member_id=member.id AND u.workspace_id=ws AND u.status='active' AND u.unit_type='team';
 FOR role IN SELECT r.scope_type,r.scope_config FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws AND r.status='active' JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
 WHERE mr.member_id=member.id AND mr.workspace_id=ws AND p.permission_key=permission AND (r.scope_type='organization' OR permission ~ '^(tasks|reviews|versions|collaboration_spaces|requests|rooms|automations)\.' OR permission='collaboration.view_dashboard') LOOP
  IF role.scope_type='organization' THEN RETURN true;END IF;
  IF role.scope_type IN('own','custom') AND (role.scope_type='own' OR role.scope_config->>'include_own'='true') AND context->'owners' ? actor::text THEN RETURN true;END IF;
  IF role.scope_type IN('assigned','custom') AND (role.scope_type='assigned' OR role.scope_config->>'include_assigned'='true') AND context->'assigned' ? actor::text THEN RETURN true;END IF;
  IF role.scope_type='team' AND EXISTS(SELECT 1 FROM unnest(my_teams) id WHERE context->'units' ? id::text) THEN RETURN true;END IF;
  IF role.scope_type IN('units','custom') AND jsonb_typeof(role.scope_config->'unit_ids')='array' THEN
   SELECT coalesce(array_agg(u.id),'{}') INTO selected_units FROM jsonb_array_elements_text(role.scope_config->'unit_ids') configured(id) JOIN public.organization_units u ON u.id=private.organization_scope_uuid(configured.id) AND u.workspace_id=ws AND u.status='active';
   IF EXISTS(SELECT 1 FROM unnest(selected_units) id WHERE context->'units' ? id::text) THEN RETURN true;END IF;
  END IF;
 END LOOP;
 RETURN false;
END;$$;

CREATE OR REPLACE FUNCTION private.organization_actor_resource_allowed(ws uuid,actor uuid,permission text,kind text,resource uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.organization_actor_context_allowed(ws,permission,private.organization_resource_context(ws,kind,resource),actor)
$$;
REVOKE ALL ON FUNCTION private.organization_actor_context_allowed(uuid,text,jsonb,uuid),private.organization_actor_resource_allowed(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.organization_actor_new_resource_allowed(ws uuid,permission text,kind text,assigned_users uuid[],assigned_units uuid[],parent_space uuid,actor uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE units uuid[];context jsonb;parent jsonb;
BEGIN
 IF actor IS NULL OR (NOT(kind='task' AND permission='tasks.assign') AND permission IS DISTINCT FROM (CASE kind WHEN 'task' THEN 'tasks.create' WHEN 'review' THEN 'reviews.create' WHEN 'negotiation' THEN 'reviews.create' WHEN 'request' THEN 'requests.create' WHEN 'room' THEN 'rooms.create' WHEN 'automation' THEN 'automations.manage' WHEN 'space' THEN 'collaboration_spaces.create' WHEN 'milestone' THEN 'collaboration_spaces.create' WHEN 'committee' THEN 'collaboration_spaces.create' WHEN 'closing' THEN 'collaboration_spaces.create' END)) THEN RETURN false;END IF;
 IF cardinality(coalesce(assigned_users,'{}'))>100 OR cardinality(coalesce(assigned_units,'{}'))>200 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM unnest(assigned_users) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=requested.id AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()))) OR EXISTS(SELECT 1 FROM unnest(assigned_units) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.organization_units u WHERE u.id=requested.id AND u.workspace_id=ws AND u.status='active')) THEN RETURN false;END IF;
 SELECT coalesce(assigned_units,'{}')||coalesce(array_agg(DISTINCT u.id),'{}') INTO units FROM public.organization_units u JOIN public.organization_unit_members um ON um.unit_id=u.id JOIN public.workspace_members m ON m.id=um.member_id AND m.workspace_id=ws AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) WHERE u.workspace_id=ws AND u.status='active' AND m.user_id=ANY(CASE WHEN permission='tasks.assign' THEN coalesce(assigned_users,'{}') ELSE array_append(coalesce(assigned_users,'{}'),actor) END);
 context:=jsonb_build_object('owners',ARRAY[actor],'assigned',coalesce(assigned_users,'{}'),'units',units);
 IF parent_space IS NOT NULL THEN
  IF NOT private.organization_actor_resource_allowed(ws,actor,permission,'space',parent_space) THEN RETURN false;END IF;
  parent:=private.organization_resource_context(ws,'space',parent_space);
  context:=jsonb_build_object('owners',(context->'owners')||(parent->'owners'),'assigned',(context->'assigned')||(parent->'assigned'),'units',(context->'units')||(parent->'units'));
 END IF;
 RETURN private.organization_actor_context_allowed(ws,permission,context,actor);
END;$$;
REVOKE ALL ON FUNCTION private.organization_actor_new_resource_allowed(uuid,text,text,uuid[],uuid[],uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.organization_authorize_automation_action(source_id uuid,source_type text,action_type text,document_id uuid DEFAULT NULL,event_actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source jsonb;ws uuid;principal uuid;permission text;assignee uuid;create_context jsonb;
BEGIN
 IF source_type='automation' THEN SELECT to_jsonb(a) INTO source FROM public.collaboration_automations a WHERE a.id=source_id;
 ELSIF source_type='workflow' THEN SELECT to_jsonb(w) INTO source FROM public.organization_approval_workflows w WHERE w.id=source_id;
 ELSE RETURN jsonb_build_object('allowed',false,'code','automation_source_invalid');END IF;
 ws:=private.organization_scope_uuid(source->>'workspace_id');principal:=private.organization_scope_uuid(source->>'created_by');
 IF ws IS NULL OR principal IS NULL OR source->>'status'<>'active' OR NOT EXISTS(SELECT 1 FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id WHERE w.id=ws AND w.workspace_type='business' AND coalesce(w.organization_enabled,true) AND m.user_id=principal AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())) THEN RETURN jsonb_build_object('allowed',false,'code','automation_principal_inactive');END IF;
 permission:=CASE source_type WHEN 'automation' THEN 'automations.manage' ELSE 'workflows.manage' END;
 IF (source_type='automation' AND NOT private.organization_actor_resource_allowed(ws,principal,permission,'automation',source_id)) OR (source_type='workflow' AND NOT private.organization_actor_context_allowed(ws,permission,jsonb_build_object('owners',ARRAY[principal],'assigned',ARRAY[principal],'units','[]'::jsonb),principal)) THEN RETURN jsonb_build_object('allowed',false,'code','automation_permission_revoked');END IF;
 IF document_id IS NOT NULL AND NOT private.organization_actor_resource_allowed(ws,principal,permission,'document',document_id) THEN RETURN jsonb_build_object('allowed',false,'code','automation_document_out_of_scope');END IF;
 IF action_type NOT IN('notify','activity','webhook','document_metadata','create_task','request_nom151','trigger_lucia_contractual') THEN RETURN jsonb_build_object('allowed',false,'code','automation_action_invalid');END IF;
 IF action_type NOT IN('notify','activity') AND document_id IS NULL THEN RETURN jsonb_build_object('allowed',false,'code','automation_document_required');END IF;
 permission:=CASE action_type WHEN 'webhook' THEN 'integrations.manage' WHEN 'document_metadata' THEN 'resources.manage' WHEN 'trigger_lucia_contractual' THEN 'resources.read' WHEN 'request_nom151' THEN 'certificates.manage' END;
 IF permission IS NOT NULL AND NOT private.organization_actor_resource_allowed(ws,principal,permission,'document',document_id) THEN RETURN jsonb_build_object('allowed',false,'code','automation_action_permission_revoked');END IF;
 IF action_type='create_task' THEN
  assignee:=coalesce(event_actor_id,principal);
  IF NOT private.organization_actor_new_resource_allowed(ws,'tasks.create','task',ARRAY[assignee],'{}',NULL,principal) OR NOT private.organization_actor_resource_allowed(ws,principal,'tasks.create','document',document_id) OR (assignee<>principal AND NOT private.organization_actor_new_resource_allowed(ws,'tasks.assign','task',ARRAY[assignee],'{}',NULL,principal)) THEN RETURN jsonb_build_object('allowed',false,'code','automation_assignment_out_of_scope');END IF;
 END IF;
 RETURN jsonb_build_object('allowed',true,'principal_id',principal,'workspace_id',ws);
END;$$;
REVOKE ALL ON FUNCTION public.organization_authorize_automation_action(uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.organization_authorize_automation_action(uuid,text,text,uuid,uuid) TO service_role;

-- The existing offboarding RPC remains atomic. Revalidate its stored requester
-- inside the transition transaction, including service-role cron executions.
CREATE OR REPLACE FUNCTION private.organization_offboarding_principal_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='processing' AND OLD.status IS DISTINCT FROM 'processing' THEN
  PERFORM 1 FROM public.workspace_members m WHERE m.workspace_id=NEW.workspace_id AND m.user_id=NEW.requested_by AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) FOR SHARE;
  IF NOT FOUND OR NOT private.organization_actor_context_allowed(NEW.workspace_id,'members.offboard',jsonb_build_object('owners',ARRAY[NEW.requested_by],'assigned','[]'::jsonb,'units','[]'::jsonb),NEW.requested_by) THEN RAISE EXCEPTION 'organization_offboarding_permission_revoked' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.organization_offboarding_principal_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER organization_offboarding_principal_guard BEFORE UPDATE OF status ON public.organization_member_offboarding_jobs FOR EACH ROW EXECUTE FUNCTION private.organization_offboarding_principal_guard();

-- Permit authorized team roles without broadening personal-workspace rules or
-- allowing structural changes to terminal tasks. Restrictive policies still apply.
CREATE OR REPLACE FUNCTION private.organization_task_detail_writable(ws uuid,task uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tareas t JOIN public.workspaces w ON w.id=t.workspace_id WHERE t.id=task AND t.workspace_id=ws AND w.workspace_type='business' AND t.estado NOT IN('completada','cancelada','rechazada')) AND private.organization_resource_allowed(ws,'tasks.edit','task',task)
$$;
REVOKE ALL ON FUNCTION private.organization_task_detail_writable(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.organization_task_detail_writable(uuid,uuid) TO authenticated;
CREATE POLICY organization_team_checklist_insert ON public.task_checklist_items FOR INSERT TO authenticated WITH CHECK(created_by=(SELECT auth.uid()) AND private.organization_task_detail_writable(workspace_id,tarea_id));
CREATE POLICY organization_team_checklist_update ON public.task_checklist_items FOR UPDATE TO authenticated USING(private.organization_task_detail_writable(workspace_id,tarea_id)) WITH CHECK(private.organization_task_detail_writable(workspace_id,tarea_id));
CREATE POLICY organization_team_checklist_delete ON public.task_checklist_items FOR DELETE TO authenticated USING(private.organization_task_detail_writable(workspace_id,tarea_id));
CREATE POLICY organization_team_dependency_insert ON public.task_dependencies FOR INSERT TO authenticated WITH CHECK(private.organization_task_detail_writable(workspace_id,tarea_id) AND private.organization_resource_allowed(workspace_id,'tasks.view','task',depends_on_id));
CREATE POLICY organization_team_dependency_delete ON public.task_dependencies FOR DELETE TO authenticated USING(private.organization_task_detail_writable(workspace_id,tarea_id));
NOTIFY pgrst,'reload schema';
