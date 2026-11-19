-- Capture only submitted canonical responses; saving progress is not delivery.
CREATE OR REPLACE FUNCTION public.colabora_link_form_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item public.collaboration_request_items;r public.collaboration_document_requests;
BEGIN
 SELECT i.* INTO item FROM public.collaboration_request_form_links b JOIN public.collaboration_request_items i ON i.id=b.request_item_id WHERE b.token_id=NEW.token_id;
 IF item.id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO r FROM public.collaboration_document_requests WHERE id=item.request_id FOR UPDATE;
 SELECT * INTO item FROM public.collaboration_request_items WHERE id=item.id FOR UPDATE;
 IF NEW.workspace_id IS DISTINCT FROM r.workspace_id OR NEW.template_id IS DISTINCT FROM item.form_template_id THEN RAISE EXCEPTION 'request_form_receipt_scope' USING ERRCODE='23514';END IF;
 -- Draft saves are editable and do not count as delivered requirements.
 IF TG_OP='UPDATE' AND OLD.status IN('submitted','pdf_generated','signing','signed') THEN
  IF ROW(NEW.token_id,NEW.template_id,NEW.workspace_id,NEW.response_data,NEW.field_hashes) IS DISTINCT FROM ROW(OLD.token_id,OLD.template_id,OLD.workspace_id,OLD.response_data,OLD.field_hashes)
    OR NEW.status NOT IN('submitted','pdf_generated','signing','signed') THEN
   RAISE EXCEPTION 'request_form_receipt_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.status NOT IN('submitted','pdf_generated','signing','signed') THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status IN('started','in_progress')) THEN
  IF item.form_response_id IS NOT NULL AND item.status NOT IN('replacement_requested','rejected') THEN RAISE EXCEPTION 'request_form_receipt_exists' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM public.form_templates ft WHERE ft.id=item.form_template_id AND ((item.source_snapshot->>'revision' IS NOT NULL AND item.source_snapshot->>'revision' IS DISTINCT FROM to_jsonb(ft)->>'revision_number') OR (item.source_snapshot->>'version' IS NOT NULL AND item.source_snapshot->>'version' IS DISTINCT FROM to_jsonb(ft)->>'version_number'))) THEN RAISE EXCEPTION 'request_form_revision_changed' USING ERRCODE='23514';END IF;
  IF r.status NOT IN('sent','in_progress') OR r.access_expires_at<=now() OR item.status IN('approved','waived','in_review') THEN RAISE EXCEPTION 'request_item_locked' USING ERRCODE='23514';END IF;
  UPDATE public.collaboration_request_items SET form_response_id=NEW.id,status='uploaded',validation_status='pending',rejection_reason=NULL WHERE id=item.id;
  UPDATE public.collaboration_document_requests SET status='in_progress' WHERE id=r.id;
  INSERT INTO public.collaboration_activity_events(workspace_id,space_id,event_type,resource_type,resource_id,summary,metadata) VALUES(r.workspace_id,r.space_id,'request.form_received','document_request',r.id,'Se recibió una respuesta del formulario vinculado.',jsonb_build_object('request_item_id',item.id,'response_id',NEW.id));
 ELSIF ROW(NEW.token_id,NEW.template_id,NEW.workspace_id,NEW.response_data,NEW.field_hashes) IS DISTINCT FROM ROW(OLD.token_id,OLD.template_id,OLD.workspace_id,OLD.response_data,OLD.field_hashes) THEN RAISE EXCEPTION 'request_form_receipt_immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;

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
    IF response.id IS NULL OR response.status NOT IN('submitted','pdf_generated','signing','signed') THEN RAISE EXCEPTION 'form_response_required' USING ERRCODE='23514';END IF;
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
 IF EXISTS(SELECT 1 FROM public.collaboration_request_items i WHERE i.request_id=r.id AND i.required AND i.item_type='form' AND i.status<>'waived' AND NOT EXISTS(SELECT 1 FROM public.form_responses fr JOIN public.collaboration_request_form_links b ON b.token_id=fr.token_id AND b.request_item_id=i.id WHERE fr.id=i.form_response_id AND fr.workspace_id=r.workspace_id AND fr.template_id=i.form_template_id AND fr.status IN('submitted','pdf_generated','signing','signed'))) THEN RAISE EXCEPTION 'request_required_items_pending' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM public.collaboration_request_items i WHERE i.request_id=r.id AND i.required AND i.status NOT IN('uploaded','in_review','approved','waived')) THEN RAISE EXCEPTION 'request_required_items_pending' USING ERRCODE='23514';END IF;
 UPDATE public.collaboration_request_items SET status='in_review' WHERE request_id=r.id AND status='uploaded';
 UPDATE public.collaboration_document_requests SET status='in_review' WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.collaboration_activity_events(workspace_id,space_id,event_type,resource_type,resource_id,summary) VALUES(r.workspace_id,r.space_id,'request.submitted','document_request',r.id,'La persona invitada envió la solicitud a revisión.');
 RETURN jsonb_build_object('id',r.id,'workspace_id',r.workspace_id,'status',r.status,'reviewer_id',coalesce(r.responsible_user_id,r.created_by),'version',r.optimistic_version);
END;$$;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.colabora_forms_overview(ws uuid)
RETURNS TABLE(id uuid,name text,description text,status text,version_number integer,revision_number integer,updated_at timestamptz,response_count bigint,request_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT f.id,f.name,f.description,f.status,f.version_number,f.revision_number,f.updated_at,
  (SELECT count(*) FROM public.form_responses r WHERE r.template_id=f.id AND r.workspace_id=ws AND r.status IN('submitted','pdf_generated','signing','signed')),
  (SELECT count(DISTINCT i.request_id) FROM public.collaboration_request_items i WHERE i.form_template_id=f.id AND i.workspace_id=ws)
 FROM public.form_templates f WHERE f.workspace_id=ws ORDER BY f.updated_at DESC LIMIT 500
$$;
NOTIFY pgrst,'reload schema';
