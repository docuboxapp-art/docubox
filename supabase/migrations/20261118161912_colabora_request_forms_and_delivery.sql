-- Request requirements use the existing form and signature engines. No public
-- identity capability is minted here: forms retain private recipient access.
ALTER TABLE public.collaboration_request_items
  ADD COLUMN IF NOT EXISTS form_template_id uuid REFERENCES public.form_templates(id),
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documentos(id),
  ADD COLUMN IF NOT EXISTS form_response_id uuid REFERENCES public.form_responses(id),
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.collaboration_document_requests
  ADD COLUMN IF NOT EXISTS invitation_status text NOT NULL DEFAULT 'not_requested'
    CHECK(invitation_status IN('not_requested','pending','sent','failed')),
  ADD COLUMN IF NOT EXISTS invitation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invitation_attempted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.collaboration_request_form_links(
  token_id uuid PRIMARY KEY REFERENCES public.form_tokens(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  request_item_id uuid NOT NULL REFERENCES public.collaboration_request_items(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collaboration_request_form_links_item_idx ON public.collaboration_request_form_links(request_item_id);
CREATE INDEX IF NOT EXISTS collaboration_request_items_form_idx ON public.collaboration_request_items(form_template_id) WHERE form_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS collaboration_request_items_document_idx ON public.collaboration_request_items(document_id) WHERE document_id IS NOT NULL;
ALTER TABLE public.collaboration_request_form_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.collaboration_request_form_links FROM anon,authenticated;
GRANT ALL ON public.collaboration_request_form_links TO service_role;

CREATE OR REPLACE FUNCTION public.colabora_assert_actor(ws uuid,actor uuid,requested_permission text DEFAULT 'requests.create')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id
  WHERE w.id=ws AND w.workspace_type='business' AND coalesce(w.organization_enabled,true)
  AND m.user_id=actor AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())
  AND (m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM public.organization_member_roles mr
    JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws AND r.status='active'
    JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
    WHERE mr.member_id=m.id AND mr.workspace_id=ws AND p.permission_key=requested_permission)))
 THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_validate_request_source(ws uuid,recipient text,item jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 IF item->>'item_type' NOT IN('document','identity','form','signature') OR coalesce(length(trim(item->>'title')),0)<2 THEN RAISE EXCEPTION 'invalid_request_item' USING ERRCODE='23514';END IF;
 IF item->>'item_type'='form' AND NOT EXISTS(SELECT 1 FROM public.form_templates f WHERE f.id=(item->>'form_template_id')::uuid AND f.workspace_id=ws AND f.status='published') THEN RAISE EXCEPTION 'form_unavailable' USING ERRCODE='23514';END IF;
 IF item->>'item_type'='signature' AND NOT EXISTS(SELECT 1 FROM public.documentos d WHERE d.id=(item->>'document_id')::uuid AND d.workspace_id=ws AND d.deleted_at IS NULL AND d.estado NOT IN('borrador','cancelado','rechazado','vencido') AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(d.participantes,'[]'::jsonb)) p WHERE lower(trim(p->>'email'))=lower(trim(recipient)))) THEN RAISE EXCEPTION 'signature_recipient_unavailable' USING ERRCODE='23514';END IF;
 IF item->>'item_type'<>'form' AND item->>'form_template_id' IS NOT NULL OR item->>'item_type'<>'signature' AND item->>'document_id' IS NOT NULL THEN RAISE EXCEPTION 'invalid_request_source' USING ERRCODE='23514';END IF;
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_create_document_request(ws uuid,actor uuid,request_values jsonb,items jsonb,token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;item jsonb;position integer:=0;
BEGIN
 PERFORM public.colabora_assert_actor(ws,actor);
 IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 50 OR token_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_request_items' USING ERRCODE='23514';END IF;
 IF request_values->>'space_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.collaboration_spaces WHERE id=(request_values->>'space_id')::uuid AND workspace_id=ws AND status IN('draft','active','on_hold')) THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='23514';END IF;
 IF request_values->>'responsible_user_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=(request_values->>'responsible_user_id')::uuid AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())) THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='23514';END IF;
 INSERT INTO public.collaboration_document_requests(workspace_id,created_by,responsible_user_id,space_id,folio,title,description,recipient_name,recipient_email,due_at,status,sent_at,access_token_hash,access_expires_at,invitation_status)
 VALUES(ws,actor,coalesce((request_values->>'responsible_user_id')::uuid,actor),(request_values->>'space_id')::uuid,'SOL-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),request_values->>'title',request_values->>'description',request_values->>'recipient_name',lower(trim(request_values->>'recipient_email')),(request_values->>'due_at')::timestamptz,'sent',now(),token_hash,coalesce((request_values->>'due_at')::timestamptz,now()+interval '14 days'),CASE WHEN request_values->>'send_invitation'='false' THEN 'not_requested' ELSE 'pending' END) RETURNING * INTO r;
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  PERFORM public.colabora_validate_request_source(ws,r.recipient_email,item);
  INSERT INTO public.collaboration_request_items(workspace_id,request_id,item_type,title,description,required,position,status,form_template_id,document_id,source_snapshot)
  VALUES(ws,r.id,item->>'item_type',item->>'title',item->>'description',coalesce((item->>'required')::boolean,true),position,CASE WHEN item->>'item_type'='signature' AND EXISTS(SELECT 1 FROM public.documentos d WHERE d.id=(item->>'document_id')::uuid AND d.workspace_id=ws AND d.estado='completado') THEN 'uploaded' ELSE 'pending' END,(item->>'form_template_id')::uuid,(item->>'document_id')::uuid,coalesce(item->'source_snapshot','{}'::jsonb));position:=position+1;
 END LOOP;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module)
 VALUES(ws,actor,'collaboration.request_created','document_request',r.id,'Solicitud documental creada','colabora');
 RETURN to_jsonb(r)-'access_token_hash';
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_change_request_item(ws uuid,actor uuid,request_id uuid,operation text,item_id uuid,item_values jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;row public.collaboration_request_items;result_id uuid;
BEGIN
 PERFORM public.colabora_assert_actor(ws,actor);
 SELECT * INTO r FROM public.collaboration_document_requests WHERE id=request_id AND workspace_id=ws FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
 IF r.status NOT IN('sent','in_progress','draft') THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 IF operation='add_item' THEN
  IF (SELECT count(*) FROM public.collaboration_request_items i WHERE i.request_id=r.id)>=50 THEN RAISE EXCEPTION 'request_item_limit' USING ERRCODE='23514';END IF;
  PERFORM public.colabora_validate_request_source(ws,r.recipient_email,item_values);
  INSERT INTO public.collaboration_request_items(workspace_id,request_id,item_type,title,description,required,position,status,form_template_id,document_id,source_snapshot)
  VALUES(ws,r.id,item_values->>'item_type',item_values->>'title',item_values->>'description',coalesce((item_values->>'required')::boolean,true),(SELECT coalesce(max(i.position),-1)+1 FROM public.collaboration_request_items i WHERE i.request_id=r.id),CASE WHEN item_values->>'item_type'='signature' AND EXISTS(SELECT 1 FROM public.documentos d WHERE d.id=(item_values->>'document_id')::uuid AND d.workspace_id=ws AND d.estado='completado') THEN 'uploaded' ELSE 'pending' END,(item_values->>'form_template_id')::uuid,(item_values->>'document_id')::uuid,coalesce(item_values->'source_snapshot','{}'::jsonb)) RETURNING id INTO result_id;
 ELSE
  SELECT * INTO row FROM public.collaboration_request_items i WHERE i.id=item_id AND i.request_id=r.id AND i.workspace_id=ws FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
  IF row.status<>'pending' OR row.form_response_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.collaboration_request_files WHERE request_item_id=row.id) OR EXISTS(SELECT 1 FROM public.collaboration_request_form_links WHERE request_item_id=row.id) THEN RAISE EXCEPTION 'request_item_has_evidence' USING ERRCODE='23514';END IF;
  IF operation='remove_item' THEN
   IF (SELECT count(*) FROM public.collaboration_request_items i WHERE i.request_id=r.id)<=1 THEN RAISE EXCEPTION 'request_item_required' USING ERRCODE='23514';END IF;
   DELETE FROM public.collaboration_request_items WHERE id=row.id;
  ELSIF operation='edit_item' THEN
   PERFORM public.colabora_validate_request_source(ws,r.recipient_email,item_values);
   UPDATE public.collaboration_request_items SET status=CASE WHEN item_values->>'item_type'='signature' AND EXISTS(SELECT 1 FROM public.documentos d WHERE d.id=(item_values->>'document_id')::uuid AND d.workspace_id=ws AND d.estado='completado') THEN 'uploaded' ELSE 'pending' END,item_type=item_values->>'item_type',title=item_values->>'title',description=item_values->>'description',required=coalesce((item_values->>'required')::boolean,true),form_template_id=(item_values->>'form_template_id')::uuid,document_id=(item_values->>'document_id')::uuid,source_snapshot=coalesce(item_values->'source_snapshot','{}'::jsonb) WHERE id=row.id;
  ELSE RAISE EXCEPTION 'invalid_request_action' USING ERRCODE='23514';END IF;
  result_id:=row.id;
 END IF;
 INSERT INTO public.collaboration_activity_events(workspace_id,space_id,actor_user_id,event_type,resource_type,resource_id,summary) VALUES(ws,r.space_id,actor,'request.'||operation,'document_request',r.id,'Se actualizó un requisito de la solicitud.');
 RETURN result_id;
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_request_form_token(request_hash text,session_hash text,item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;item public.collaboration_request_items;f public.form_templates;t public.form_tokens;uid uuid;
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE access_token_hash=request_hash AND status IN('sent','in_progress','in_review') AND access_expires_at>now() FOR UPDATE;
 IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.collaboration_request_external_sessions s WHERE s.request_id=r.id AND s.session_token_hash=session_hash AND s.otp_consumed_at IS NOT NULL AND s.revoked_at IS NULL AND s.expires_at>now()) THEN RAISE EXCEPTION 'request_session_invalid' USING ERRCODE='42501';END IF;
 SELECT * INTO item FROM public.collaboration_request_items i WHERE i.id=item_id AND i.request_id=r.id AND i.workspace_id=r.workspace_id AND i.item_type='form' FOR UPDATE;
 IF item.id IS NULL OR item.status IN('approved','waived','expired') THEN RAISE EXCEPTION 'request_item_locked' USING ERRCODE='23514';END IF;
 SELECT ft.* INTO f FROM public.form_templates ft WHERE ft.id=item.form_template_id AND ft.workspace_id=r.workspace_id AND ft.status='published';
 IF f.id IS NULL OR (item.source_snapshot->>'revision' IS NOT NULL AND item.source_snapshot->>'revision' IS DISTINCT FROM to_jsonb(f)->>'revision_number') THEN RAISE EXCEPTION 'request_form_revision_changed' USING ERRCODE='23514';END IF;
 SELECT ft.* INTO t FROM public.collaboration_request_form_links b JOIN public.form_tokens ft ON ft.id=b.token_id WHERE b.request_item_id=item.id AND ft.expires_at>now() AND (ft.used_at IS NULL OR item.status NOT IN('replacement_requested','rejected')) ORDER BY b.created_at DESC LIMIT 1;
 IF t.id IS NOT NULL THEN RETURN jsonb_build_object('token',t.token,'resume',t.used_at IS NOT NULL);END IF;
 IF r.status='in_review' THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 -- Private form access checks the confirmed Auth email; user-editable profile metadata cannot bind an identity.
 uid:=NULL;
 INSERT INTO public.form_tokens(template_id,recipient_email,recipient_name,recipient_user_id,access_mode,expires_at,signature_type,require_liveness,launched_by_user_id,launcher_name,sent_to_self)
 VALUES(f.id,r.recipient_email,r.recipient_name,uid,'private',least(r.access_expires_at,now()+interval '24 hours'),coalesce(f.allowed_signature_types[1],'click_sign'),false,r.created_by,'Docubox Colabora',false) RETURNING * INTO t;
 INSERT INTO public.collaboration_request_form_links(token_id,workspace_id,request_item_id) VALUES(t.id,r.workspace_id,item.id);
 RETURN jsonb_build_object('token',t.token,'resume',false);
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_rotate_request_invitation(ws uuid,actor uuid,request_id uuid,token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;
BEGIN
 PERFORM public.colabora_assert_actor(ws,actor);
 SELECT * INTO r FROM public.collaboration_document_requests WHERE id=request_id AND workspace_id=ws FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
 IF r.status NOT IN('draft','sent','in_progress','in_review') OR r.access_expires_at<=now() THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 IF r.invitation_attempted_at>now()-interval '60 seconds' THEN RAISE EXCEPTION 'request_invitation_rate_limited' USING ERRCODE='P0001';END IF;
 IF token_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_invitation_token' USING ERRCODE='23514';END IF;
 UPDATE public.collaboration_request_external_sessions s SET revoked_at=now() WHERE s.request_id=r.id AND s.revoked_at IS NULL;
 UPDATE public.form_tokens t SET expires_at=least(t.expires_at,now()) FROM public.collaboration_request_form_links b JOIN public.collaboration_request_items i ON i.id=b.request_item_id WHERE b.token_id=t.id AND i.request_id=r.id AND t.used_at IS NULL;
 UPDATE public.collaboration_document_requests SET access_token_hash=token_hash,invitation_status='pending',invitation_attempted_at=now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module) VALUES(ws,actor,'collaboration.request_invitation_renewed','document_request',r.id,'Se renovó la invitación de la solicitud.','colabora');
 RETURN to_jsonb(r)-'access_token_hash';
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_link_form_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item public.collaboration_request_items;r public.collaboration_document_requests;
BEGIN
 SELECT i.* INTO item FROM public.collaboration_request_form_links b JOIN public.collaboration_request_items i ON i.id=b.request_item_id WHERE b.token_id=NEW.token_id;
 IF item.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE id=item.request_id FOR UPDATE;
 SELECT * INTO item FROM public.collaboration_request_items WHERE id=item.id FOR UPDATE;
 IF NEW.workspace_id IS DISTINCT FROM r.workspace_id OR NEW.template_id IS DISTINCT FROM item.form_template_id THEN RAISE EXCEPTION 'request_form_receipt_scope' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF item.form_response_id IS NOT NULL AND item.status NOT IN('replacement_requested','rejected') THEN RAISE EXCEPTION 'request_form_receipt_exists' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM public.form_templates ft WHERE ft.id=item.form_template_id AND ((item.source_snapshot->>'revision' IS NOT NULL AND item.source_snapshot->>'revision' IS DISTINCT FROM to_jsonb(ft)->>'revision_number') OR (item.source_snapshot->>'version' IS NOT NULL AND item.source_snapshot->>'version' IS DISTINCT FROM to_jsonb(ft)->>'version_number'))) THEN RAISE EXCEPTION 'request_form_revision_changed' USING ERRCODE='23514';END IF;
  IF r.status NOT IN('sent','in_progress') OR r.access_expires_at<=now() OR item.status IN('approved','waived','in_review') THEN RAISE EXCEPTION 'request_item_locked' USING ERRCODE='23514';END IF;
  UPDATE public.collaboration_request_items SET form_response_id=NEW.id,status='uploaded',validation_status='pending',rejection_reason=NULL WHERE id=item.id;
  UPDATE public.collaboration_document_requests SET status='in_progress' WHERE id=r.id;
  INSERT INTO public.collaboration_activity_events(workspace_id,space_id,event_type,resource_type,resource_id,summary,metadata) VALUES(r.workspace_id,r.space_id,'request.form_received','document_request',r.id,'Se recibió una respuesta del formulario vinculado.',jsonb_build_object('request_item_id',item.id,'response_id',NEW.id));
 ELSIF ROW(NEW.token_id,NEW.template_id,NEW.workspace_id,NEW.response_data,NEW.field_hashes) IS DISTINCT FROM ROW(OLD.token_id,OLD.template_id,OLD.workspace_id,OLD.response_data,OLD.field_hashes) THEN RAISE EXCEPTION 'request_form_receipt_immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER colabora_link_form_receipt AFTER INSERT OR UPDATE ON public.form_responses FOR EACH ROW EXECUTE FUNCTION public.colabora_link_form_receipt();

CREATE OR REPLACE FUNCTION public.colabora_sync_signature_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.estado='completado' AND OLD.estado IS DISTINCT FROM NEW.estado THEN
  UPDATE public.collaboration_request_items i SET status='uploaded',validation_status='pending'
  FROM public.collaboration_document_requests r WHERE i.document_id=NEW.id AND i.item_type='signature'
   AND i.request_id=r.id AND i.workspace_id=NEW.workspace_id AND r.workspace_id=NEW.workspace_id
   AND r.status IN('sent','in_progress') AND i.status='pending';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER colabora_sync_signature_receipt AFTER UPDATE OF estado ON public.documentos FOR EACH ROW EXECUTE FUNCTION public.colabora_sync_signature_receipt();

CREATE OR REPLACE FUNCTION public.colabora_revoke_request_access() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status IN('cancelled','expired') AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE public.collaboration_request_external_sessions SET revoked_at=now() WHERE request_id=NEW.id AND revoked_at IS NULL;
  UPDATE public.form_tokens t SET expires_at=least(t.expires_at,now()) FROM public.collaboration_request_form_links b JOIN public.collaboration_request_items i ON i.id=b.request_item_id WHERE b.token_id=t.id AND i.request_id=NEW.id;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER colabora_revoke_request_access AFTER UPDATE OF status ON public.collaboration_document_requests FOR EACH ROW EXECUTE FUNCTION public.colabora_revoke_request_access();

REVOKE ALL ON FUNCTION public.colabora_link_form_receipt() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_sync_signature_receipt(),public.colabora_revoke_request_access() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_assert_actor(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_validate_request_source(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_create_document_request(uuid,uuid,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_change_request_item(uuid,uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_request_form_token(text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.colabora_rotate_request_invitation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_rotate_request_invitation(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.colabora_assert_actor(uuid,uuid,text),public.colabora_validate_request_source(uuid,text,jsonb),public.colabora_create_document_request(uuid,uuid,jsonb,jsonb,text),public.colabora_change_request_item(uuid,uuid,uuid,text,uuid,jsonb),public.colabora_request_form_token(text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.colabora_review_request_item(ws uuid,actor uuid,request_id uuid,operation text,item_id uuid,reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;i public.collaboration_request_items;f public.collaboration_request_files;response public.form_responses;canonical_id uuid;complete boolean;next_status text;
BEGIN
 PERFORM public.colabora_assert_actor(ws,actor,'requests.review_items');
 SELECT * INTO r FROM public.collaboration_document_requests WHERE id=request_id AND workspace_id=ws FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
 IF r.status NOT IN('sent','in_progress','in_review') THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 IF operation='complete' THEN
  IF EXISTS(SELECT 1 FROM public.collaboration_request_items t WHERE t.request_id=r.id AND t.required AND t.status NOT IN('approved','waived')) THEN RAISE EXCEPTION 'request_required_items_pending' USING ERRCODE='23514';END IF;
 ELSE
  IF operation NOT IN('approve_item','reject_item','request_replacement','waive_item') THEN RAISE EXCEPTION 'invalid_request_action' USING ERRCODE='23514';END IF;
  IF operation<>'approve_item' AND coalesce(length(trim(reason)),0)=0 THEN RAISE EXCEPTION 'request_reason_required' USING ERRCODE='23514';END IF;
  SELECT * INTO i FROM public.collaboration_request_items t WHERE t.id=item_id AND t.request_id=r.id AND t.workspace_id=ws FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
  IF operation='approve_item' THEN
   IF i.item_type='form' THEN
    SELECT fr.* INTO response FROM public.form_responses fr JOIN public.collaboration_request_form_links b ON b.token_id=fr.token_id AND b.request_item_id=i.id WHERE fr.id=i.form_response_id AND fr.workspace_id=ws AND fr.template_id=i.form_template_id;
    IF response.id IS NULL THEN RAISE EXCEPTION 'form_response_required' USING ERRCODE='23514';END IF;
    IF coalesce((i.source_snapshot->>'requiresSignature')::boolean,true) AND coalesce(to_jsonb(response)->>'status','')<>'signed' AND NOT EXISTS(SELECT 1 FROM public.documentos WHERE id=response.document_id AND workspace_id=ws AND estado='completado') THEN RAISE EXCEPTION 'form_signature_pending' USING ERRCODE='23514';END IF;
    canonical_id:=response.document_id;
   ELSIF i.item_type='signature' THEN
    IF NOT EXISTS(SELECT 1 FROM public.documentos d WHERE d.id=i.document_id AND d.workspace_id=ws AND d.estado='completado' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(d.participantes,'[]')) p WHERE lower(trim(p->>'email'))=r.recipient_email)) THEN RAISE EXCEPTION 'signature_pending' USING ERRCODE='23514';END IF;
    canonical_id:=i.document_id;
   ELSE
    SELECT * INTO f FROM public.collaboration_request_files WHERE request_item_id=i.id AND workspace_id=ws ORDER BY version DESC LIMIT 1 FOR UPDATE;
    IF f.id IS NULL THEN RAISE EXCEPTION 'request_file_required' USING ERRCODE='23514';END IF;
    IF f.malware_scan_status<>'clean' THEN RAISE EXCEPTION 'request_file_security_scan_required' USING ERRCODE='23514';END IF;
    canonical_id:=public.incorporate_collaboration_request_file(f.id,ws,actor);
   END IF;
  END IF;
  UPDATE public.collaboration_request_items SET status=CASE operation WHEN 'approve_item' THEN 'approved' WHEN 'reject_item' THEN 'rejected' WHEN 'request_replacement' THEN 'replacement_requested' ELSE 'waived' END,
   validation_status=CASE operation WHEN 'approve_item' THEN 'valid' WHEN 'waive_item' THEN 'not_checked' ELSE 'invalid' END,
   rejection_reason=CASE WHEN operation IN('reject_item','request_replacement') THEN reason ELSE NULL END,
   waiver_reason=CASE WHEN operation='waive_item' THEN reason ELSE NULL END,waived_by=CASE WHEN operation='waive_item' THEN actor ELSE NULL END,reviewed_by=actor,reviewed_at=now() WHERE id=i.id;
 END IF;
 complete:=NOT EXISTS(SELECT 1 FROM public.collaboration_request_items t WHERE t.request_id=r.id AND t.required AND t.status NOT IN('approved','waived'));
 next_status:=CASE WHEN operation='complete' OR complete THEN 'completed' WHEN operation IN('reject_item','request_replacement') THEN 'in_progress' ELSE r.status END;
 UPDATE public.collaboration_document_requests SET status=next_status,completed_at=CASE WHEN next_status='completed' THEN now() ELSE NULL END WHERE id=r.id;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,payload,module) VALUES(ws,actor,'collaboration.request_'||operation,'document_request',r.id,'Se revisó un requisito de la solicitud.',jsonb_build_object('item_id',i.id,'canonical_document_id',canonical_id),'colabora');
 INSERT INTO public.collaboration_activity_events(workspace_id,space_id,actor_user_id,event_type,resource_type,resource_id,summary) VALUES(ws,r.space_id,actor,'request.'||operation,'document_request',r.id,CASE WHEN next_status='completed' THEN 'La solicitud se completó.' ELSE 'Se actualizó la revisión de la solicitud.' END);
 RETURN jsonb_build_object('status',next_status,'canonical_document_id',canonical_id);
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_receive_request_file(request_hash text,session_hash text,item_id uuid,file_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;i public.collaboration_request_items;s public.collaboration_request_external_sessions;previous public.collaboration_request_files;received public.collaboration_request_files;
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE access_token_hash=request_hash AND status IN('sent','in_progress') AND access_expires_at>now() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM public.collaboration_request_external_sessions WHERE request_id=r.id AND session_token_hash=session_hash AND otp_consumed_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now();
 IF s.id IS NULL THEN RAISE EXCEPTION 'request_session_invalid' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.collaboration_request_items t WHERE t.id=item_id AND t.workspace_id=r.workspace_id AND t.request_id=r.id FOR UPDATE;
 IF i.id IS NULL OR i.item_type NOT IN('document','identity') OR i.status IN('approved','waived','expired') THEN RAISE EXCEPTION 'request_item_locked' USING ERRCODE='23514';END IF;
 IF file_values->>'mime_type' NOT IN('application/pdf','image/jpeg','image/png') OR (file_values->>'byte_size')::bigint NOT BETWEEN 1 AND 26214400 OR file_values->>'sha256'!~'^[a-f0-9]{64}$' OR file_values->>'storage_path' NOT LIKE 'collaboration-requests/'||r.workspace_id::text||'/'||r.id::text||'/'||i.id::text||'/%' THEN RAISE EXCEPTION 'invalid_request_file' USING ERRCODE='23514';END IF;
 SELECT * INTO previous FROM public.collaboration_request_files WHERE request_item_id=i.id ORDER BY version DESC LIMIT 1;
 INSERT INTO public.collaboration_request_files(workspace_id,request_item_id,original_name,storage_path,mime_type,byte_size,sha256,malware_scan_status,version,replaced_file_id,uploaded_by_external_session_id)
 VALUES(r.workspace_id,i.id,file_values->>'original_name',file_values->>'storage_path',file_values->>'mime_type',(file_values->>'byte_size')::bigint,file_values->>'sha256','pending',coalesce(previous.version,0)+1,previous.id,s.id) RETURNING * INTO received;
 UPDATE public.collaboration_request_items SET status='uploaded',validation_status='pending',rejection_reason=NULL WHERE id=i.id;
 UPDATE public.collaboration_document_requests SET status='in_progress' WHERE id=r.id;
 INSERT INTO public.collaboration_activity_events(workspace_id,space_id,event_type,resource_type,resource_id,summary,metadata) VALUES(r.workspace_id,r.space_id,'request.file_received','document_request',r.id,'Se recibió un archivo para la solicitud documental.',jsonb_build_object('request_item_id',i.id,'file_id',received.id,'version',received.version));
 RETURN jsonb_build_object('id',received.id,'original_name',received.original_name,'mime_type',received.mime_type,'byte_size',received.byte_size,'sha256',received.sha256,'malware_scan_status',received.malware_scan_status,'version',received.version,'received_at',received.received_at);
END;$$;
REVOKE ALL ON FUNCTION public.colabora_review_request_item(uuid,uuid,uuid,text,uuid,text),public.colabora_receive_request_file(text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_review_request_item(uuid,uuid,uuid,text,uuid,text),public.colabora_receive_request_file(text,text,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.colabora_create_review(ws uuid,actor uuid,document_id uuid,version_id uuid,review_title text,reviewer_ids uuid[],due_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE version public.document_versions;review public.collaboration_review_rounds;
BEGIN
 PERFORM public.colabora_assert_actor(ws,actor,'reviews.create');
 PERFORM 1 FROM public.documentos d WHERE d.id=document_id AND d.workspace_id=ws AND d.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='23514';END IF;
 SELECT * INTO version FROM public.document_versions v WHERE v.id=version_id AND v.document_id=colabora_create_review.document_id AND v.workspace_id=ws FOR UPDATE;
 IF version.id IS NULL OR version.status IN('sent','signed','obsolete') THEN RAISE EXCEPTION 'review_version_mismatch' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM public.collaboration_review_rounds WHERE document_version_id=version.id AND status IN('draft','open')) THEN RAISE EXCEPTION 'review_already_open' USING ERRCODE='23514';END IF;
 IF coalesce(cardinality(reviewer_ids),0) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM unnest(reviewer_ids) uid WHERE NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=uid AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now()))) THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='23514';END IF;
 INSERT INTO public.collaboration_review_rounds(workspace_id,document_id,document_version_id,title,round_number,status,requested_by,due_at)
 VALUES(ws,document_id,version.id,review_title,(SELECT coalesce(max(r.round_number),0)+1 FROM public.collaboration_review_rounds r WHERE r.document_id=colabora_create_review.document_id),'open',actor,due_at) RETURNING * INTO review;
 INSERT INTO public.collaboration_reviewers(workspace_id,review_round_id,user_id) SELECT ws,review.id,uid FROM (SELECT DISTINCT unnest(reviewer_ids) uid) reviewers;
 UPDATE public.document_versions SET status='in_review' WHERE id=version.id;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module) VALUES(ws,actor,'collaboration.review_created','review_round',review.id,'Se abrió una ronda de revisión documental.','colabora');
 RETURN to_jsonb(review);
END;$$;

CREATE OR REPLACE FUNCTION public.colabora_decide_review(ws uuid,actor uuid,document_id uuid,review_id uuid,operation text,expected_version integer,note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE review public.collaboration_review_rounds;permission text;next_status text;
BEGIN
 permission:=CASE operation WHEN 'approve' THEN 'reviews.approve' WHEN 'request_changes' THEN 'reviews.request_changes' WHEN 'close_review' THEN 'reviews.resolve_comments' ELSE NULL END;
 IF permission IS NULL THEN RAISE EXCEPTION 'invalid_review_action' USING ERRCODE='23514';END IF;
 PERFORM public.colabora_assert_actor(ws,actor,permission);
 PERFORM 1 FROM public.documentos d WHERE d.id=document_id AND d.workspace_id=ws FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='23514';END IF;
 SELECT * INTO review FROM public.collaboration_review_rounds r WHERE r.id=review_id AND r.document_id=colabora_decide_review.document_id AND r.workspace_id=ws FOR UPDATE;
 IF review.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
 IF review.optimistic_version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'catalog_record_conflict' USING ERRCODE='40001';END IF;
 IF review.status IN('closed','cancelled') OR (review.status='approved' AND operation<>'close_review') THEN RAISE EXCEPTION 'review_closed' USING ERRCODE='23514';END IF;
 IF operation<>'close_review' AND EXISTS(SELECT 1 FROM public.collaboration_review_rounds newer WHERE newer.workspace_id=ws AND newer.document_version_id=review.document_version_id AND newer.round_number>review.round_number) THEN RAISE EXCEPTION 'review_closed' USING ERRCODE='23514';END IF;
 IF operation='approve' AND review.blocking_comments_required AND EXISTS(SELECT 1 FROM public.collaboration_comments WHERE review_round_id=review.id AND workspace_id=ws AND is_blocking AND status='open') THEN RAISE EXCEPTION 'review_blocking_comments' USING ERRCODE='23514';END IF;
 IF operation='request_changes' AND coalesce(length(trim(note)),0)=0 THEN RAISE EXCEPTION 'request_reason_required' USING ERRCODE='23514';END IF;
 next_status:=CASE operation WHEN 'approve' THEN 'approved' WHEN 'request_changes' THEN 'changes_requested' ELSE 'closed' END;
 UPDATE public.collaboration_review_rounds SET status=next_status,decision_note=note,decided_by=actor,decided_at=now() WHERE id=review.id RETURNING * INTO review;
 UPDATE public.collaboration_reviewers SET status=CASE operation WHEN 'approve' THEN 'approved' WHEN 'request_changes' THEN 'changes_requested' ELSE status END,responded_at=now() WHERE review_round_id=review.id AND user_id=actor;
 IF operation='approve' THEN UPDATE public.document_versions SET status='approved' WHERE id=review.document_version_id AND workspace_id=ws AND status='in_review';END IF;
 IF operation='request_changes' OR (operation='close_review' AND NOT EXISTS(SELECT 1 FROM public.collaboration_review_rounds active WHERE active.document_version_id=review.document_version_id AND active.status='open')) THEN UPDATE public.document_versions SET status='draft' WHERE id=review.document_version_id AND workspace_id=ws AND status='in_review';END IF;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,module) VALUES(ws,actor,'collaboration.review_'||operation,'review_round',review.id,'Se registró la decisión de la ronda de revisión.','colabora');
 RETURN to_jsonb(review);
END;$$;
REVOKE ALL ON FUNCTION public.colabora_create_review(uuid,uuid,uuid,uuid,text,uuid[],timestamptz),public.colabora_decide_review(uuid,uuid,uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_create_review(uuid,uuid,uuid,uuid,text,uuid[],timestamptz),public.colabora_decide_review(uuid,uuid,uuid,uuid,text,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.colabora_submit_request(request_hash text,session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE access_token_hash=request_hash AND access_expires_at>now() FOR UPDATE;
 IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.collaboration_request_external_sessions s WHERE s.request_id=r.id AND s.session_token_hash=session_hash AND s.otp_consumed_at IS NOT NULL AND s.revoked_at IS NULL AND s.expires_at>now()) THEN RAISE EXCEPTION 'request_session_invalid' USING ERRCODE='42501';END IF;
 IF r.status NOT IN('sent','in_progress') THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 -- Existing signed documents can be linked after their signature was completed.
 UPDATE public.collaboration_request_items i SET status='uploaded',validation_status='pending' FROM public.documentos d WHERE i.request_id=r.id AND i.workspace_id=r.workspace_id AND i.item_type='signature' AND i.document_id=d.id AND d.workspace_id=r.workspace_id AND d.estado='completado' AND i.status='pending';
 IF EXISTS(SELECT 1 FROM public.collaboration_request_items i WHERE i.request_id=r.id AND i.required AND i.status NOT IN('uploaded','in_review','approved','waived')) THEN RAISE EXCEPTION 'request_required_items_pending' USING ERRCODE='23514';END IF;
 UPDATE public.collaboration_request_items SET status='in_review' WHERE request_id=r.id AND status='uploaded';
 UPDATE public.collaboration_document_requests SET status='in_review' WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.collaboration_activity_events(workspace_id,space_id,event_type,resource_type,resource_id,summary) VALUES(r.workspace_id,r.space_id,'request.submitted','document_request',r.id,'La persona invitada envió la solicitud a revisión.');
 RETURN jsonb_build_object('id',r.id,'workspace_id',r.workspace_id,'status',r.status,'reviewer_id',coalesce(r.responsible_user_id,r.created_by),'version',r.optimistic_version);
END;$$;
REVOKE ALL ON FUNCTION public.colabora_submit_request(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_submit_request(text,text) TO service_role;

-- Consume a challenge once while retaining failed-attempt counters on rejection.
CREATE OR REPLACE FUNCTION public.colabora_verify_request_otp(request_hash text,challenge_id uuid,received_hash text,new_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;s public.collaboration_request_external_sessions;expiry timestamptz;
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE access_token_hash=request_hash AND access_expires_at>now() AND status IN('sent','in_progress','in_review','completed') FOR UPDATE;
 IF r.id IS NULL THEN RETURN jsonb_build_object('status',410,'code','request_expired');END IF;
 SELECT * INTO s FROM public.collaboration_request_external_sessions WHERE id=challenge_id AND request_id=r.id FOR UPDATE;
 IF s.id IS NULL OR s.otp_consumed_at IS NOT NULL OR s.revoked_at IS NOT NULL OR s.otp_expires_at<=now() OR s.otp_hash IS NULL THEN RETURN jsonb_build_object('status',400,'code','otp_expired');END IF;
 IF s.failed_attempts>=5 THEN RETURN jsonb_build_object('status',429,'code','otp_attempts_exceeded');END IF;
 IF s.otp_hash IS DISTINCT FROM received_hash THEN
  UPDATE public.collaboration_request_external_sessions SET failed_attempts=failed_attempts+1 WHERE id=s.id;
  RETURN jsonb_build_object('status',400,'code','otp_invalid');
 END IF;
 IF new_session_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'request_session_invalid' USING ERRCODE='23514';END IF;
 expiry:=least(r.access_expires_at,now()+interval '30 minutes');
 UPDATE public.collaboration_request_external_sessions SET session_token_hash=new_session_hash,otp_consumed_at=now(),expires_at=expiry,last_seen_at=now() WHERE id=s.id;
 UPDATE public.collaboration_document_requests SET status='in_progress' WHERE id=r.id AND status='sent';
 RETURN jsonb_build_object('status',200,'expires_at',expiry);
END;$$;
REVOKE ALL ON FUNCTION public.colabora_verify_request_otp(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_verify_request_otp(text,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.colabora_issue_request_otp(request_hash text,code_hash text,new_session_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.collaboration_document_requests;challenge uuid;
BEGIN
 IF current_user NOT IN('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE access_token_hash=request_hash AND access_expires_at>now() AND status IN('sent','in_progress','in_review','completed') FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'request_locked' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM public.collaboration_request_external_sessions s WHERE s.request_id=r.id AND s.created_at>now()-interval '1 minute') OR (SELECT count(*) FROM public.collaboration_request_external_sessions s WHERE s.request_id=r.id AND s.created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'request_otp_rate_limited' USING ERRCODE='23514';END IF;
 IF code_hash !~ '^[a-f0-9]{64}$' OR new_session_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'request_session_invalid' USING ERRCODE='23514';END IF;
 UPDATE public.collaboration_request_external_sessions SET revoked_at=now() WHERE request_id=r.id AND otp_consumed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO public.collaboration_request_external_sessions(workspace_id,request_id,session_token_hash,otp_hash,otp_expires_at,expires_at) VALUES(r.workspace_id,r.id,new_session_hash,code_hash,least(r.access_expires_at,now()+interval '10 minutes'),least(r.access_expires_at,now()+interval '10 minutes')) RETURNING id INTO challenge;
 RETURN challenge;
END;$$;
REVOKE ALL ON FUNCTION public.colabora_issue_request_otp(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_issue_request_otp(text,text,text) TO service_role;

-- Execute as the caller: canonical form/response and request RLS remains effective.
CREATE OR REPLACE FUNCTION public.colabora_forms_overview(ws uuid)
RETURNS TABLE(id uuid,name text,description text,status text,version_number integer,revision_number integer,updated_at timestamptz,response_count bigint,request_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT f.id,f.name,f.description,f.status,f.version_number,f.revision_number,f.updated_at,
  (SELECT count(*) FROM public.form_responses r WHERE r.template_id=f.id AND r.workspace_id=ws),
  (SELECT count(DISTINCT i.request_id) FROM public.collaboration_request_items i WHERE i.form_template_id=f.id AND i.workspace_id=ws)
 FROM public.form_templates f WHERE f.workspace_id=ws ORDER BY f.updated_at DESC LIMIT 500
$$;
REVOKE ALL ON FUNCTION public.colabora_forms_overview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.colabora_forms_overview(uuid) TO authenticated,service_role;
