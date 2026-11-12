CREATE OR REPLACE FUNCTION public.case_portal_form_token(p_hash text,p_form uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE ctx jsonb;f public.case_file_forms;t public.form_tokens;ft public.form_templates;cfg public.case_launches;grant_row public.case_invitation_access_grants;
BEGIN
 ctx:=public.case_portal_context(p_hash,true);
 SELECT * INTO f FROM public.case_file_forms WHERE id=p_form AND case_file_id=(ctx#>>'{case,id}')::uuid AND participant_id=(ctx#>>'{participant,id}')::uuid FOR UPDATE;
 IF f.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT * INTO cfg FROM public.case_launches WHERE case_file_id=f.case_file_id;
 IF cfg.access_mode='public' THEN
  SELECT * INTO grant_row FROM public.case_invitation_access_grants WHERE invitation_id=(ctx#>>'{invitation,id}')::uuid AND user_id=(ctx#>>'{participant,user_id}')::uuid AND code_verified AND expires_at>now() AND liveness_verified_at>now()-interval '24 hours';
  IF grant_row.invitation_id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_LIVENESS_REQUIRED';END IF;
 END IF;
 SELECT tok.* INTO t FROM public.case_portal_form_tokens b JOIN public.form_tokens tok ON tok.id=b.token_id WHERE b.invitation_id=(ctx#>>'{invitation,id}')::uuid AND b.case_form_id=f.id AND tok.expires_at>now() ORDER BY b.created_at DESC LIMIT 1;
 IF t.id IS NOT NULL THEN RETURN jsonb_build_object('token',t.token,'resume',t.used_at IS NOT NULL,'accessMode',t.access_mode);END IF;
 IF f.status IN ('approved','locked','completed','signed') OR EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_form_id=f.id AND submitted_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_ITEM_LOCKED';END IF;
 SELECT * INTO ft FROM public.form_templates WHERE id=f.form_template_id AND workspace_id=(ctx#>>'{case,workspace_id}')::uuid AND status='published';
 IF ft.id IS NULL OR ft.version_number::text IS DISTINCT FROM f.settings->>'sourceVersion' OR ft.revision_number::text IS DISTINCT FROM f.settings->>'sourceRevision' THEN RAISE EXCEPTION 'CASE_FORM_REVISION_CHANGED';END IF;
 SELECT tok.* INTO t FROM public.case_portal_form_tokens b JOIN public.form_tokens tok ON tok.id=b.token_id WHERE b.invitation_id=(ctx#>>'{invitation,id}')::uuid AND b.case_form_id=f.id AND tok.used_at IS NULL AND tok.expires_at>now() ORDER BY b.created_at DESC LIMIT 1;
 IF t.id IS NULL THEN
  INSERT INTO public.form_tokens(template_id,recipient_email,recipient_name,recipient_user_id,access_mode,expires_at,signature_type,require_liveness,launched_by_user_id,launcher_name,launch_prefill,liveness_verified_at,liveness_reference,sent_to_self)
  VALUES(ft.id,ctx#>>'{invitation,recipient}',ctx#>>'{participant,name}',(ctx#>>'{participant,user_id}')::uuid,coalesce(cfg.access_mode,'private'),least((ctx#>>'{invitation,expires_at}')::timestamptz,coalesce(grant_row.liveness_verified_at+interval '24 hours',(ctx#>>'{invitation,expires_at}')::timestamptz)),coalesce((SELECT signature_type FROM public.case_launches WHERE case_file_id=f.case_file_id),ft.allowed_signature_types[1],'autografa_digital'),false,(ctx#>>'{case,owner_user_id}')::uuid,ctx#>>'{invitation,sender_name}',coalesce((SELECT subject_prefill FROM public.case_launches WHERE case_file_id=f.case_file_id),'{}'::jsonb),grant_row.liveness_verified_at,CASE WHEN grant_row.liveness_session_id IS NOT NULL THEN 'case:'||grant_row.liveness_session_id::text ELSE NULL END,false) RETURNING * INTO t;
  INSERT INTO public.case_portal_form_tokens(token_id,invitation_id,case_form_id) VALUES(t.id,(ctx#>>'{invitation,id}')::uuid,f.id);
 END IF;
 RETURN jsonb_build_object('token',t.token,'accessMode',t.access_mode);
END;$$;

CREATE OR REPLACE FUNCTION case_runtime_private.case_launch_signature_method_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg record;person jsonb;types jsonb;expected text;
BEGIN
 IF NEW.action_type<>'signature' OR NEW.status NOT IN ('claimed','committed') OR (TG_OP='UPDATE' AND OLD.status='committed') THEN RETURN NEW;END IF;
 FOR cfg IN SELECT l.signature_type,p.user_id,p.email,d.participantes FROM public.case_file_documents b JOIN public.case_file_requirements r ON r.id=b.requirement_id JOIN public.case_files c ON c.id=b.case_file_id JOIN public.case_launches l ON l.case_file_id=c.id JOIN public.case_file_participants p ON p.id=c.runtime_subject_id JOIN public.documentos d ON d.id=b.source_document_id WHERE b.source_document_id=NEW.document_id AND r.requires_signature LOOP
  expected:=CASE cfg.signature_type WHEN 'click_sign' THEN 'click_sign' WHEN 'efirma_sat' THEN 'efirma' ELSE 'autografa' END;
  SELECT value INTO person FROM jsonb_array_elements(coalesce(cfg.participantes,'[]')) WHERE (cfg.user_id IS NOT NULL AND value->>'user_id'=cfg.user_id::text) OR lower(value->>'email')=lower(cfg.email) LIMIT 1;
  types:=coalesce(person->'signature_types',person->'signatureTypes',person->'tipoFirma');
  IF jsonb_typeof(types) IS DISTINCT FROM 'array' OR jsonb_array_length(types)<>1 OR coalesce(types->>0,'') NOT IN (expected,cfg.signature_type,CASE WHEN cfg.signature_type='click_sign' THEN 'clicksign' ELSE expected END) OR coalesce(NEW.signature_method,'') NOT IN (expected,cfg.signature_type,CASE WHEN cfg.signature_type='click_sign' THEN 'clicksign' ELSE expected END) THEN RAISE EXCEPTION 'CASE_SIGNATURE_METHOD_UNAVAILABLE';END IF;
 END LOOP;RETURN NEW;
END;$$;
