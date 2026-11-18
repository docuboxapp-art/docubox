-- Compute granted permissions in one relational query rather than invoking an
-- authorization function separately for every catalog entry.
CREATE OR REPLACE FUNCTION public.get_my_organization_permissions(ws_id uuid)
RETURNS TABLE(permission_key text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH member AS MATERIALIZED (
  SELECT m.id,m.role FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
  WHERE m.workspace_id=ws_id AND m.user_id=(SELECT auth.uid()) AND m.status='active'
   AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) AND w.workspace_type='business' AND coalesce(w.organization_enabled,true)
 )
 SELECT p.permission_key FROM public.organization_permissions p WHERE EXISTS(
  SELECT 1 FROM member m WHERE m.role='owner' OR (m.role='admin' AND p.permission_key<>'organization.transfer_ownership')
   OR EXISTS(SELECT 1 FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws_id AND r.status='active'
    JOIN public.organization_role_permissions rp ON rp.role_id=r.id AND rp.permission_id=p.id
    WHERE mr.workspace_id=ws_id AND mr.member_id=m.id AND (r.scope_type='organization' OR p.permission_key ~ '^(tasks|reviews|versions|collaboration_spaces|requests|rooms|automations)\.' OR p.permission_key='collaboration.view_dashboard'))
 ) ORDER BY p.permission_key
$$;
REVOKE ALL ON FUNCTION public.get_my_organization_permissions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_organization_permissions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.organization_broad_resource_workspaces(permission text)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT m.workspace_id),'{}') FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
 WHERE m.user_id=(SELECT auth.uid()) AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())
 AND (w.workspace_type<>'business' OR (coalesce(w.organization_enabled,true) AND (m.role IN('owner','admin') OR EXISTS(
  SELECT 1 FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=m.workspace_id AND r.status='active' AND r.scope_type='organization'
  JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
  WHERE mr.workspace_id=m.workspace_id AND mr.member_id=m.id AND p.permission_key=permission))))
$$;
REVOKE ALL ON FUNCTION private.organization_broad_resource_workspaces(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.organization_broad_resource_workspaces(text) TO authenticated;

-- Only root rows can use the precomputed broad-workspace list. Their ID and
-- workspace come from the actual RLS row. Children still validate their parents;
-- public resource-check RPCs still reject forged IDs from another workspace.
DO $$DECLARE item record;BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('tareas','tasks.view','task','collaboration_space_id IS NULL'),
 ('collaboration_spaces','collaboration_spaces.view','space','true'),
 ('collaboration_milestones','collaboration_spaces.view','milestone','space_id IS NULL'),
 ('collaboration_activity_events','collaboration.view_dashboard','activity','space_id IS NULL AND resource_id IS NULL'),
 ('collaboration_document_requests','requests.view','request','space_id IS NULL'),
 ('collaboration_rooms','rooms.view','room','space_id IS NULL'),
 ('collaboration_automations','automations.view','automation','true'),
 ('collaboration_negotiation_items','reviews.view','negotiation','space_id IS NULL'),
 ('collaboration_committees','collaboration_spaces.view','committee','space_id IS NULL'),
 ('collaboration_closing_rooms','collaboration_spaces.view','closing','space_id IS NULL')) binding(table_name,permission,kind,parentless) LOOP
  EXECUTE format('ALTER POLICY organization_resource_scope ON public.%I USING(((%s) AND workspace_id=ANY((SELECT private.organization_broad_resource_workspaces(%L))::uuid[])) OR private.organization_resource_allowed(workspace_id,%L,%L,id))',item.table_name,item.parentless,item.permission,item.permission,item.kind);
 END LOOP;
END$$;
NOTIFY pgrst,'reload schema';
