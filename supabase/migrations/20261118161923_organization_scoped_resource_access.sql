-- Add a resource boundary to existing permission/entitlement/audience policies.
-- No existing permissive policy is removed and no DML grant is introduced.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated,service_role;

-- API readiness check: deployment must never treat missing restrictive policies as a broad grant.
CREATE OR REPLACE FUNCTION public.organization_resource_scope_version(ws_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
 WHERE m.workspace_id=ws_id AND m.user_id=(SELECT auth.uid()) AND m.status='active'
 AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) AND w.workspace_type='business'
 AND coalesce(w.organization_enabled,true)) THEN 1 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.organization_resource_scope_version(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.organization_resource_scope_version(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.organization_scope_uuid(value text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN value::uuid ELSE NULL END
$$;
REVOKE ALL ON FUNCTION private.organization_scope_uuid(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.organization_resource_context(ws uuid,kind text,resource uuid,depth integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE table_name text;row jsonb;owners uuid[]:='{}';assigned uuid[]:='{}';units uuid[]:='{}';parent jsonb;parent_kind text;parent_id uuid;entry record;
BEGIN
 IF depth>6 OR resource IS NULL THEN RETURN NULL;END IF;
 table_name:=CASE kind
 WHEN 'task' THEN 'tareas' WHEN 'document' THEN 'documentos' WHEN 'form' THEN 'form_templates' WHEN 'form_response' THEN 'form_responses' WHEN 'template' THEN 'plantillas'
 WHEN 'case_file' THEN 'case_files' WHEN 'space' THEN 'collaboration_spaces' WHEN 'request' THEN 'collaboration_document_requests'
 WHEN 'request_item' THEN 'collaboration_request_items' WHEN 'request_file' THEN 'collaboration_request_files'
 WHEN 'review' THEN 'collaboration_review_rounds' WHEN 'version' THEN 'document_versions' WHEN 'comment' THEN 'collaboration_comments'
 WHEN 'room' THEN 'collaboration_rooms' WHEN 'automation' THEN 'collaboration_automations' WHEN 'milestone' THEN 'collaboration_milestones' WHEN 'activity' THEN 'collaboration_activity_events'
 WHEN 'negotiation' THEN 'collaboration_negotiation_items' WHEN 'committee' THEN 'collaboration_committees' WHEN 'closing' THEN 'collaboration_closing_rooms' END;
 IF table_name IS NULL THEN RETURN NULL;END IF;
 -- The identifier comes exclusively from the closed mapping above; values are bound.
 EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE r.id=$1 AND r.workspace_id=$2',table_name) INTO row USING resource,ws;
 IF row IS NULL OR row->>'deleted_at' IS NOT NULL THEN RETURN NULL;END IF;
 SELECT coalesce(array_agg(value),'{}') INTO owners FROM (SELECT DISTINCT private.organization_scope_uuid(row->>key) value FROM unnest(ARRAY['owner_id','created_by','requested_by','author_id','actor_user_id']) key) ids WHERE value IS NOT NULL;
 SELECT coalesce(array_agg(value),'{}') INTO assigned FROM (SELECT DISTINCT private.organization_scope_uuid(row->>key) value FROM unnest(ARRAY['assigned_to','responsible_user_id','custodian_user_id']) key) ids WHERE value IS NOT NULL;
 IF kind IN('space','room','milestone','negotiation') AND row->>'owner_id' IS NOT NULL THEN assigned:=array_append(assigned,private.organization_scope_uuid(row->>'owner_id'));END IF;
 SELECT coalesce(array_agg(value),'{}') INTO units FROM (SELECT DISTINCT private.organization_scope_uuid(row->>key) value FROM unnest(ARRAY['assigned_team_id','organization_unit_id','unit_id']) key) ids WHERE value IS NOT NULL;

 IF kind='task' THEN SELECT assigned||coalesce(array_agg(c.user_id),'{}') INTO assigned FROM public.task_collaborators c WHERE c.workspace_id=ws AND c.task_id=resource;
 ELSIF kind='review' THEN SELECT assigned||coalesce(array_agg(r.user_id),'{}') INTO assigned FROM public.collaboration_reviewers r WHERE r.workspace_id=ws AND r.review_round_id=resource;
 ELSIF kind='space' THEN SELECT assigned||coalesce(array_agg(m.user_id),'{}') INTO assigned FROM public.collaboration_space_members m WHERE m.workspace_id=ws AND m.space_id=resource AND m.status='active';
 ELSIF kind='document' THEN
  SELECT assigned||coalesce(array_agg(private.organization_scope_uuid(p->>'user_id')) FILTER(WHERE private.organization_scope_uuid(p->>'user_id') IS NOT NULL),'{}') INTO assigned FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row->'participantes')='array' THEN row->'participantes' ELSE '[]'::jsonb END) p;
  SELECT assigned||coalesce(array_agg(u.id),'{}') INTO assigned FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row->'participantes')='array' THEN row->'participantes' ELSE '[]'::jsonb END) p JOIN auth.users u ON lower(u.email)=lower(p->>'email') AND u.email_confirmed_at IS NOT NULL;
  SELECT assigned||coalesce(array_agg(reviewer.user_id),'{}') INTO assigned FROM public.collaboration_review_rounds round JOIN public.collaboration_reviewers reviewer ON reviewer.review_round_id=round.id AND reviewer.workspace_id=ws WHERE round.document_id=resource AND round.workspace_id=ws;
 ELSIF kind='request' THEN
  SELECT assigned||coalesce(array_agg(u.id),'{}') INTO assigned FROM auth.users u WHERE lower(u.email)=lower(row->>'recipient_email') AND u.email_confirmed_at IS NOT NULL;
 ELSIF kind='form' THEN
  SELECT assigned||coalesce(array_agg(u.id),'{}') INTO assigned FROM public.form_tokens t JOIN auth.users u ON u.id=t.recipient_user_id OR (lower(u.email)=lower(t.recipient_email) AND u.email_confirmed_at IS NOT NULL) WHERE t.template_id=resource;
 ELSIF kind='form_response' THEN
  SELECT assigned||coalesce(array_agg(u.id),'{}') INTO assigned FROM public.form_tokens t JOIN auth.users u ON u.id=t.recipient_user_id OR (lower(u.email)=lower(t.recipient_email) AND u.email_confirmed_at IS NOT NULL) WHERE t.id=private.organization_scope_uuid(row->>'token_id') AND t.template_id=private.organization_scope_uuid(row->>'template_id');
 END IF;

 parent_kind:=CASE kind WHEN 'request_item' THEN 'request' WHEN 'request_file' THEN 'request_item' WHEN 'form_response' THEN 'form' WHEN 'review' THEN 'document' WHEN 'version' THEN 'document' WHEN 'comment' THEN CASE WHEN row->>'review_round_id' IS NOT NULL THEN 'review' ELSE 'document' END END;
 parent_id:=private.organization_scope_uuid(CASE kind WHEN 'request_item' THEN row->>'request_id' WHEN 'request_file' THEN row->>'request_item_id' WHEN 'form_response' THEN row->>'template_id' WHEN 'comment' THEN coalesce(row->>'review_round_id',row->>'document_id') ELSE row->>'document_id' END);
 IF kind='activity' THEN
  parent_kind:=CASE row->>'resource_type' WHEN 'task' THEN 'task' WHEN 'document' THEN 'document' WHEN 'form' THEN 'form' WHEN 'review' THEN 'review' WHEN 'review_round' THEN 'review' WHEN 'space' THEN 'space' WHEN 'collaboration_space' THEN 'space' WHEN 'document_request' THEN 'request' WHEN 'request' THEN 'request' WHEN 'collaboration_room' THEN 'room' WHEN 'collaboration_automation' THEN 'automation' END;
  parent_id:=private.organization_scope_uuid(row->>'resource_id');
 END IF;
 FOR entry IN SELECT parent_kind AS kind,parent_id AS id WHERE parent_kind IS NOT NULL AND parent_id IS NOT NULL
   UNION ALL SELECT 'space',private.organization_scope_uuid(coalesce(row->>'space_id',row->>'collaboration_space_id')) WHERE kind<>'space' AND coalesce(row->>'space_id',row->>'collaboration_space_id') IS NOT NULL LOOP
  parent:=private.organization_resource_context(ws,entry.kind,entry.id,depth+1);
  IF parent IS NULL THEN RETURN NULL;END IF;
  SELECT owners||coalesce(array_agg(value::uuid),'{}') INTO owners FROM jsonb_array_elements_text(parent->'owners');
  IF kind<>'form_response' THEN
   SELECT assigned||coalesce(array_agg(value::uuid),'{}') INTO assigned FROM jsonb_array_elements_text(parent->'assigned');
   SELECT units||coalesce(array_agg(value::uuid),'{}') INTO units FROM jsonb_array_elements_text(parent->'units');
  END IF;
 END LOOP;
 SELECT units||coalesce(array_agg(DISTINCT u.id),'{}') INTO units FROM public.organization_units u JOIN public.organization_unit_members um ON um.unit_id=u.id JOIN public.workspace_members m ON m.id=um.member_id AND m.workspace_id=ws
 WHERE u.workspace_id=ws AND u.status='active' AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) AND m.user_id=ANY(owners||assigned);
 RETURN jsonb_build_object('owners',owners,'assigned',assigned,'units',units);
END;$$;
REVOKE ALL ON FUNCTION private.organization_resource_context(uuid,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.organization_context_allowed(ws uuid,permission text,context jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE member public.workspace_members;workspace public.workspaces;role record;selected_units uuid[];my_teams uuid[];
BEGIN
 IF auth.uid() IS NULL THEN RETURN false;END IF;
 IF context IS NULL THEN RETURN false;END IF;
 SELECT * INTO workspace FROM public.workspaces WHERE id=ws;
 IF workspace.id IS NULL THEN RETURN false;END IF;
 -- Keep existing personal-workspace RLS unchanged; this is an additional org boundary.
 IF workspace.workspace_type<>'business' THEN RETURN true;END IF;
 IF NOT coalesce(workspace.organization_enabled,true) THEN RETURN false;END IF;
 SELECT * INTO member FROM public.workspace_members WHERE workspace_id=ws AND user_id=auth.uid() AND status='active' AND (access_expires_at IS NULL OR access_expires_at>now());
 IF member.id IS NULL THEN RETURN false;END IF;
 IF member.role IN('owner','admin') THEN RETURN true;END IF;
 SELECT coalesce(array_agg(u.id),'{}') INTO my_teams FROM public.organization_units u JOIN public.organization_unit_members um ON um.unit_id=u.id WHERE um.member_id=member.id AND u.workspace_id=ws AND u.status='active' AND u.unit_type='team';
 FOR role IN SELECT r.scope_type,r.scope_config FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws AND r.status='active' JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
 WHERE mr.member_id=member.id AND mr.workspace_id=ws AND p.permission_key=permission LOOP
  IF role.scope_type='organization' THEN RETURN true;END IF;
  IF role.scope_type IN('own','custom') AND (role.scope_type='own' OR role.scope_config->>'include_own'='true') AND context->'owners' ? auth.uid()::text THEN RETURN true;END IF;
  IF role.scope_type IN('assigned','custom') AND (role.scope_type='assigned' OR role.scope_config->>'include_assigned'='true') AND context->'assigned' ? auth.uid()::text THEN RETURN true;END IF;
  IF role.scope_type='team' AND EXISTS(SELECT 1 FROM unnest(my_teams) id WHERE context->'units' ? id::text) THEN RETURN true;END IF;
  IF role.scope_type IN('units','custom') AND jsonb_typeof(role.scope_config->'unit_ids')='array' THEN
   SELECT coalesce(array_agg(u.id),'{}') INTO selected_units FROM jsonb_array_elements_text(role.scope_config->'unit_ids') configured(id) JOIN public.organization_units u ON u.id=private.organization_scope_uuid(configured.id) AND u.workspace_id=ws AND u.status='active';
   IF EXISTS(SELECT 1 FROM unnest(selected_units) id WHERE context->'units' ? id::text) THEN RETURN true;END IF;
  END IF;
 END LOOP;
 RETURN false;
END;$$;
REVOKE ALL ON FUNCTION private.organization_context_allowed(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.organization_resource_allowed(ws uuid,permission text,kind text,resource uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN false;END IF;
 RETURN private.organization_context_allowed(ws,permission,private.organization_resource_context(ws,kind,resource));
END;$$;
REVOKE ALL ON FUNCTION private.organization_resource_allowed(uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.organization_resource_allowed(uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.organization_can_access_resource(ws_id uuid,requested_permission text,resource_type text,resource_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND private.organization_resource_allowed(ws_id,requested_permission,resource_type,resource_id)
$$;
REVOKE ALL ON FUNCTION public.organization_can_access_resource(uuid,text,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.organization_can_access_resource(uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.organization_filter_resource_ids(ws_id uuid,requested_permissions text[],resource_type text,resource_ids uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN cardinality(resource_ids)>500 OR cardinality(requested_permissions)>20 THEN '{}'::uuid[] ELSE coalesce(array_agg(DISTINCT resource.id),'{}') END
 FROM unnest(resource_ids) resource(id) WHERE cardinality(resource_ids)<=500 AND cardinality(requested_permissions)<=20 AND EXISTS(SELECT 1 FROM unnest(requested_permissions) permission(key) WHERE private.organization_resource_allowed(ws_id,permission.key,resource_type,resource.id))
$$;
REVOKE ALL ON FUNCTION public.organization_filter_resource_ids(uuid,text[],text,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.organization_filter_resource_ids(uuid,text[],text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION private.organization_new_resource_allowed(ws uuid,permission text,kind text,assigned_users uuid[],assigned_units uuid[],parent_space uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE units uuid[];context jsonb;parent jsonb;
BEGIN
 IF auth.uid() IS NULL OR (NOT(kind='task' AND permission='tasks.assign') AND permission IS DISTINCT FROM (CASE kind WHEN 'task' THEN 'tasks.create' WHEN 'review' THEN 'reviews.create' WHEN 'negotiation' THEN 'reviews.create' WHEN 'request' THEN 'requests.create' WHEN 'room' THEN 'rooms.create' WHEN 'automation' THEN 'automations.manage' WHEN 'space' THEN 'collaboration_spaces.create' WHEN 'milestone' THEN 'collaboration_spaces.create' WHEN 'committee' THEN 'collaboration_spaces.create' WHEN 'closing' THEN 'collaboration_spaces.create' END)) THEN RETURN false;END IF;
 IF cardinality(coalesce(assigned_users,'{}'))>100 OR cardinality(coalesce(assigned_units,'{}'))>200 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM unnest(assigned_users) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=requested.id AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()))) OR EXISTS(SELECT 1 FROM unnest(assigned_units) requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.organization_units u WHERE u.id=requested.id AND u.workspace_id=ws AND u.status='active')) THEN RETURN false;END IF;
 SELECT coalesce(assigned_units,'{}')||coalesce(array_agg(DISTINCT u.id),'{}') INTO units FROM public.organization_units u JOIN public.organization_unit_members um ON um.unit_id=u.id JOIN public.workspace_members m ON m.id=um.member_id AND m.workspace_id=ws AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) WHERE u.workspace_id=ws AND u.status='active' AND m.user_id=ANY(CASE WHEN permission='tasks.assign' THEN coalesce(assigned_users,'{}') ELSE array_append(coalesce(assigned_users,'{}'),auth.uid()) END);
 context:=jsonb_build_object('owners',ARRAY[auth.uid()],'assigned',coalesce(assigned_users,'{}'),'units',units);
 IF parent_space IS NOT NULL THEN
  IF NOT private.organization_resource_allowed(ws,permission,'space',parent_space) THEN RETURN false;END IF;
  parent:=private.organization_resource_context(ws,'space',parent_space);
  context:=jsonb_build_object('owners',(context->'owners')||(parent->'owners'),'assigned',(context->'assigned')||(parent->'assigned'),'units',(context->'units')||(parent->'units'));
 END IF;
 RETURN private.organization_context_allowed(ws,permission,context);
END;$$;
REVOKE ALL ON FUNCTION private.organization_new_resource_allowed(uuid,text,text,uuid[],uuid[],uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.organization_can_create_resource(ws_id uuid,requested_permission text,resource_type text,assigned_user_ids uuid[] DEFAULT '{}',assigned_unit_ids uuid[] DEFAULT '{}',parent_space_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT private.organization_new_resource_allowed(ws_id,requested_permission,resource_type,assigned_user_ids,assigned_unit_ids,parent_space_id)
$$;
-- The wrapper needs a callable private entry point, not access to caller-supplied
-- row contents. Identity always comes from auth.uid().
GRANT EXECUTE ON FUNCTION private.organization_new_resource_allowed(uuid,text,text,uuid[],uuid[],uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.organization_can_create_resource(uuid,text,text,uuid[],uuid[],uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.organization_can_create_resource(uuid,text,text,uuid[],uuid[],uuid) TO authenticated;

-- The shared form index keeps canonical RLS and additionally scopes each response
-- independently. Being one recipient of a form does not expose other responses.
CREATE OR REPLACE FUNCTION public.colabora_forms_overview(ws uuid)
RETURNS TABLE(id uuid,name text,description text,status text,version_number integer,revision_number integer,updated_at timestamptz,response_count bigint,request_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT f.id,f.name,f.description,f.status,f.version_number,f.revision_number,f.updated_at,
  (SELECT count(*) FROM public.form_responses r WHERE r.template_id=f.id AND r.workspace_id=ws AND private.organization_resource_allowed(ws,'requests.view','form_response',r.id)),
  (SELECT count(DISTINCT i.request_id) FROM public.collaboration_request_items i WHERE i.form_template_id=f.id AND i.workspace_id=ws)
 FROM public.form_templates f WHERE f.workspace_id=ws AND (private.organization_resource_allowed(ws,'requests.view','form',f.id) OR EXISTS(SELECT 1 FROM public.collaboration_request_items i WHERE i.form_template_id=f.id AND i.workspace_id=ws)) ORDER BY f.updated_at DESC LIMIT 500
$$;

-- Menu/module permission remains coarse. Administrative permissions in a scoped
-- role must never imply organization-wide administration.
CREATE OR REPLACE FUNCTION public.has_organization_permission(ws_id uuid,requested_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
 WHERE m.workspace_id=ws_id AND w.workspace_type='business' AND coalesce(w.organization_enabled,true) AND m.user_id=auth.uid() AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())
 AND (m.role='owner' OR (m.role='admin' AND requested_permission<>'organization.transfer_ownership') OR EXISTS(
 SELECT 1 FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws_id AND r.status='active' JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
 WHERE mr.member_id=m.id AND mr.workspace_id=ws_id AND p.permission_key=requested_permission AND (r.scope_type='organization' OR requested_permission ~ '^(tasks|reviews|versions|collaboration_spaces|requests|rooms|automations)\.' OR requested_permission='collaboration.view_dashboard'))))
$$;
REVOKE ALL ON FUNCTION public.has_organization_permission(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_organization_permission(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.validate_organization_role_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE configured text;allowed_keys text[];
BEGIN
 IF jsonb_typeof(NEW.scope_config) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'organization_scope_invalid' USING ERRCODE='23514';END IF;
 allowed_keys:=CASE WHEN NEW.scope_type='units' THEN ARRAY['unit_ids'] WHEN NEW.scope_type='custom' THEN ARRAY['unit_ids','include_own','include_assigned'] ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.scope_config) key WHERE NOT key=ANY(allowed_keys)) THEN RAISE EXCEPTION 'organization_scope_invalid' USING ERRCODE='23514';END IF;
 IF NEW.scope_type IN('units','custom') THEN
  IF NEW.scope_config ? 'unit_ids' AND jsonb_typeof(NEW.scope_config->'unit_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'organization_scope_invalid' USING ERRCODE='23514';END IF;
  IF coalesce(jsonb_array_length(NEW.scope_config->'unit_ids'),0)>200 OR (NEW.scope_type='units' AND coalesce(jsonb_array_length(NEW.scope_config->'unit_ids'),0)=0) THEN RAISE EXCEPTION 'organization_scope_invalid' USING ERRCODE='23514';END IF;
  FOR configured IN SELECT value FROM jsonb_array_elements_text(coalesce(NEW.scope_config->'unit_ids','[]')) LOOP
   IF NOT EXISTS(SELECT 1 FROM public.organization_units WHERE id=private.organization_scope_uuid(configured) AND workspace_id=NEW.workspace_id AND status='active') THEN RAISE EXCEPTION 'organization_scope_invalid' USING ERRCODE='23514';END IF;
  END LOOP;
  IF NEW.scope_type='custom' AND ((NEW.scope_config ? 'include_own' AND jsonb_typeof(NEW.scope_config->'include_own')<>'boolean') OR (NEW.scope_config ? 'include_assigned' AND jsonb_typeof(NEW.scope_config->'include_assigned')<>'boolean') OR (NEW.scope_config->>'include_own' IS DISTINCT FROM 'true' AND NEW.scope_config->>'include_assigned' IS DISTINCT FROM 'true' AND coalesce(jsonb_array_length(NEW.scope_config->'unit_ids'),0)=0)) THEN RAISE EXCEPTION 'organization_scope_invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.validate_organization_role_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_organization_role_scope BEFORE INSERT OR UPDATE OF scope_type,scope_config ON public.organization_roles FOR EACH ROW EXECUTE FUNCTION private.validate_organization_role_scope();

-- Restrictive policies intersect existing membership, entitlement and audience
-- policies. In particular, private/formal comment rules are preserved.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('tareas','tasks.view','task','id'),('task_checklist_items','tasks.view','task','tarea_id'),('task_comments','tasks.view','task','tarea_id'),('task_attachments','tasks.view','task','tarea_id'),('task_history','tasks.view','task','tarea_id'),('task_dependencies','tasks.view','task','tarea_id'),('task_collaborators','tasks.view','task','task_id'),('task_followers','tasks.view','task','task_id'),
 ('document_versions','versions.view','version','id'),('collaboration_review_rounds','reviews.view','review','id'),('collaboration_reviewers','reviews.view','review','review_round_id'),('collaboration_comments','reviews.view','comment','id'),('collaboration_comment_mentions','reviews.view','comment','comment_id'),('collaboration_annotations','reviews.view','comment','comment_id'),
 ('collaboration_spaces','collaboration_spaces.view','space','id'),('collaboration_space_members','collaboration_spaces.view','space','space_id'),('collaboration_space_resources','collaboration_spaces.view','space','space_id'),('collaboration_milestones','collaboration_spaces.view','milestone','id'),
 ('collaboration_activity_events','collaboration.view_dashboard','activity','id'),
 ('collaboration_document_requests','requests.view','request','id'),('collaboration_request_items','requests.view','request','request_id'),('collaboration_request_files','requests.view','request_item','request_item_id'),
 ('collaboration_rooms','rooms.view','room','id'),('collaboration_room_guests','rooms.view','room','room_id'),('collaboration_room_resources','rooms.view','room','room_id'),('collaboration_external_events','rooms.view','room','room_id'),
 ('collaboration_automations','automations.view','automation','id'),('collaboration_automation_versions','automations.view','automation','automation_id'),('collaboration_automation_runs','automations.view','automation','automation_id'),
 ('collaboration_negotiation_items','reviews.view','negotiation','id'),('collaboration_committees','collaboration_spaces.view','committee','id'),('collaboration_committee_votes','collaboration_spaces.view','committee','committee_id'),('collaboration_closing_rooms','collaboration_spaces.view','closing','id')
 ) AS bindings(table_name,permission,kind,id_column) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.table_name);
  EXECUTE format('CREATE POLICY organization_resource_scope ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING(private.organization_resource_allowed(workspace_id,%L,%L,%I))',item.table_name,item.permission,item.kind,item.id_column);
 END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS organization_unit_members_member_unit_scope_idx ON public.organization_unit_members(member_id,unit_id);
CREATE INDEX IF NOT EXISTS workspace_members_active_scope_idx ON public.workspace_members(workspace_id,user_id) WHERE status='active';

-- Canonical task mutations already use /api/tareas or /api/colabora/tasks. Force
-- root writes through those action-aware routes, including manual completion.
REVOKE INSERT,UPDATE,DELETE ON public.tareas FROM authenticated;
DO $$ DECLARE item record;extra text;BEGIN
 FOR item IN SELECT * FROM (VALUES('task_checklist_items'),('task_comments'),('task_attachments'),('task_history'),('task_dependencies')) t(table_name) LOOP
  extra:=CASE item.table_name WHEN 'task_dependencies' THEN ' AND private.organization_resource_allowed(workspace_id,''tasks.view'',''task'',depends_on_id)' WHEN 'task_comments' THEN ' AND author_id=(select auth.uid())' WHEN 'task_history' THEN ' AND actor_id=(select auth.uid())' WHEN 'task_attachments' THEN ' AND uploaded_by=(select auth.uid())' ELSE '' END;
  EXECUTE format('CREATE POLICY organization_resource_insert_scope ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(private.organization_resource_allowed(workspace_id,''tasks.edit'',''task'',tarea_id)%s)',item.table_name,extra);
  EXECUTE format('CREATE POLICY organization_resource_update_scope ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING(private.organization_resource_allowed(workspace_id,''tasks.edit'',''task'',tarea_id)) WITH CHECK(private.organization_resource_allowed(workspace_id,''tasks.edit'',''task'',tarea_id)%s)',item.table_name,CASE WHEN item.table_name='task_dependencies' THEN extra ELSE '' END);
  EXECUTE format('CREATE POLICY organization_resource_delete_scope ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING(private.organization_resource_allowed(workspace_id,''tasks.edit'',''task'',tarea_id))',item.table_name);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
