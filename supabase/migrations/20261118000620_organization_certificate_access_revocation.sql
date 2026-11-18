CREATE OR REPLACE FUNCTION public.remove_organization_certificate_access(ws_id uuid,actor_user_id uuid,permission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $remove$
BEGIN
 IF current_user NOT IN('service_role','postgres') OR NOT EXISTS(
  SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws_id AND m.user_id=actor_user_id AND m.status='active'
   AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) AND (m.role IN('owner','admin') OR EXISTS(
    SELECT 1 FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws_id AND r.status='active'
    JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
    WHERE mr.member_id=m.id AND mr.workspace_id=ws_id AND p.permission_key='certificates.manage'))) THEN
   RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.organization_certificate_permissions WHERE id=permission_id AND workspace_id=ws_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002'; END IF;
 DELETE FROM public.organization_certificate_permissions WHERE id=permission_id AND workspace_id=ws_id;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module)
 VALUES(ws_id,actor_user_id,'certificate.permission.revoked','organization_certificate_permission',permission_id::text,'Permiso de certificado revocado','certificates');
 RETURN jsonb_build_object('id',permission_id);
END; $remove$;
REVOKE ALL ON FUNCTION public.remove_organization_certificate_access(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_certificate_access(uuid,uuid,uuid) TO service_role;
