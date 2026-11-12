-- Resume the same private form; never create a second receipt while its PDF or signature is pending.
CREATE OR REPLACE FUNCTION public.case_portal_form_token(p_hash text,p_form uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE ctx jsonb;f public.case_file_forms;t public.form_tokens;ft public.form_templates;
BEGIN
 ctx:=public.case_portal_context(p_hash,true);
 SELECT * INTO f FROM public.case_file_forms WHERE id=p_form AND case_file_id=(ctx#>>'{case,id}')::uuid AND participant_id=(ctx#>>'{participant,id}')::uuid FOR UPDATE;
 IF f.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT tok.* INTO t FROM public.case_portal_form_tokens b JOIN public.form_tokens tok ON tok.id=b.token_id WHERE b.invitation_id=(ctx#>>'{invitation,id}')::uuid AND b.case_form_id=f.id AND tok.expires_at>now() ORDER BY b.created_at DESC LIMIT 1;
 IF t.id IS NOT NULL THEN RETURN jsonb_build_object('token',t.token,'resume',t.used_at IS NOT NULL);END IF;
 IF f.status IN ('approved','locked','completed','signed') OR EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_form_id=f.id AND submitted_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_ITEM_LOCKED';END IF;
 SELECT * INTO ft FROM public.form_templates WHERE id=f.form_template_id AND workspace_id=(ctx#>>'{case,workspace_id}')::uuid AND status='published';
 IF ft.id IS NULL OR ft.version_number::text IS DISTINCT FROM f.settings->>'sourceVersion' OR ft.revision_number::text IS DISTINCT FROM f.settings->>'sourceRevision' THEN RAISE EXCEPTION 'CASE_FORM_REVISION_CHANGED';END IF;
 SELECT tok.* INTO t FROM public.case_portal_form_tokens b JOIN public.form_tokens tok ON tok.id=b.token_id WHERE b.invitation_id=(ctx#>>'{invitation,id}')::uuid AND b.case_form_id=f.id AND tok.used_at IS NULL AND tok.expires_at>now() ORDER BY b.created_at DESC LIMIT 1;
 IF t.id IS NULL THEN
  INSERT INTO public.form_tokens(template_id,recipient_email,recipient_name,recipient_user_id,access_mode,expires_at,signature_type,require_liveness,launched_by_user_id,launcher_name,sent_to_self)
  VALUES(ft.id,ctx#>>'{invitation,recipient}',ctx#>>'{participant,name}',(ctx#>>'{participant,user_id}')::uuid,'private',(ctx#>>'{invitation,expires_at}')::timestamptz,coalesce(ft.allowed_signature_types[1],'autografa_digital'),false,(ctx#>>'{case,owner_user_id}')::uuid,ctx#>>'{invitation,sender_name}',false) RETURNING * INTO t;
  INSERT INTO public.case_portal_form_tokens(token_id,invitation_id,case_form_id) VALUES(t.id,(ctx#>>'{invitation,id}')::uuid,f.id);
 END IF;
 RETURN jsonb_build_object('token',t.token);
END;$$;

CREATE OR REPLACE FUNCTION public.case_invitation_portal(p_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.case_participant_invitations;c public.case_files;p public.case_file_participants;
BEGIN
 SELECT * INTO i FROM public.case_participant_invitations WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 SELECT * INTO c FROM public.case_files WHERE id=i.case_file_id AND workspace_id=i.workspace_id AND status<>'cancelled';
 SELECT * INTO p FROM public.case_file_participants WHERE id=i.participant_id AND case_file_id=c.id AND workspace_id=c.workspace_id AND status NOT IN ('revoked','cancelled');
 IF c.id IS NULL OR p.id IS NULL THEN RETURN null;END IF;
 RETURN jsonb_build_object('title',c.title,'folio',c.folio,'status',c.status,'progress',c.progress,'sender',i.sender_name,'participantName',p.name,'role',p.role,'expiresAt',i.expires_at,
 'requirements',CASE WHEN p.id=c.runtime_subject_id THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'description',r.description,'required',r.is_required,'status',r.status,
  'canSubmit',c.status<>'sealed' AND r.settings->>'kind'='requested_document' AND r.status NOT IN ('approved','locked') AND (NOT EXISTS(SELECT 1 FROM public.case_file_documents d WHERE d.requirement_id=r.id) OR coalesce((r.settings->>'allowReplacement')::boolean,true)),
  'formats',coalesce(r.settings->'allowedFormats','["pdf","jpg","png"]'),'maxBytes',least(100,coalesce((r.settings->>'maxSizeMb')::numeric,15))*1048576,
  'askIssueDate',coalesce((r.settings->>'askIssueDate')::boolean,false) OR r.settings->>'validityDays' IS NOT NULL) ORDER BY r.sort_order,r.id) FROM public.case_file_requirements r WHERE r.case_file_id=c.id),'[]') ELSE '[]' END,
 'forms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'required',f.is_required,'status',f.status,'canResume',c.status<>'sealed' AND f.requires_signature AND f.status NOT IN ('approved','locked','completed','signed') AND EXISTS(SELECT 1 FROM public.case_file_form_submissions s WHERE s.case_form_id=f.id AND s.submitted_at IS NOT NULL),'canSubmit',c.status<>'sealed' AND f.status NOT IN ('approved','locked','completed','signed') AND NOT EXISTS(SELECT 1 FROM public.case_file_form_submissions s WHERE s.case_form_id=f.id AND s.submitted_at IS NOT NULL)) ORDER BY f.id) FROM public.case_file_forms f WHERE f.case_file_id=c.id AND f.participant_id=p.id),'[]'));
END;$$;
