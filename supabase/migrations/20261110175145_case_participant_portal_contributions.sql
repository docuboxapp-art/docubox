-- Personal invitation capabilities are resolved only by the application service.
CREATE TABLE public.case_portal_uploads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invitation_id uuid NOT NULL REFERENCES public.case_participant_invitations(id),
 requirement_id uuid NOT NULL REFERENCES public.case_file_requirements(id), operation_key uuid NOT NULL,
 document_id uuid NOT NULL DEFAULT gen_random_uuid(), version_id uuid NOT NULL DEFAULT gen_random_uuid(),
 file_name text NOT NULL, mime_type text NOT NULL, byte_size bigint NOT NULL CHECK(byte_size>0 AND byte_size<=104857600),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), issue_date date, key_ciphertext text NOT NULL,
 nonce text NOT NULL, base_version integer NOT NULL DEFAULT 0, storage_path text,
 status text NOT NULL DEFAULT 'staging' CHECK(status IN ('staging','committing','completed')),
 claim_id uuid, claim_expires_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(invitation_id,operation_key)
);
CREATE INDEX case_portal_upload_requirement ON public.case_portal_uploads(requirement_id);
ALTER TABLE public.case_portal_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_portal_uploads FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_portal_uploads TO service_role;
CREATE TABLE public.case_portal_form_tokens (
 token_id uuid PRIMARY KEY REFERENCES public.form_tokens(id), invitation_id uuid NOT NULL REFERENCES public.case_participant_invitations(id),
 case_form_id uuid NOT NULL REFERENCES public.case_file_forms(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_portal_form_invitation ON public.case_portal_form_tokens(invitation_id);
CREATE INDEX case_portal_form_assignment ON public.case_portal_form_tokens(case_form_id);
ALTER TABLE public.case_portal_form_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_portal_form_tokens FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_portal_form_tokens TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('case-portal-staging','case-portal-staging',false,104857616,ARRAY['application/octet-stream'])
 ON CONFLICT(id) DO NOTHING;

CREATE FUNCTION public.case_portal_context(p_hash text,p_write boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.case_participant_invitations;c public.case_files;p public.case_file_participants;
BEGIN
 SELECT * INTO i FROM public.case_participant_invitations WHERE token_hash=p_hash;
 IF i.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_INVALID' USING ERRCODE='42501';END IF;
 IF p_write THEN SELECT * INTO c FROM public.case_files WHERE id=i.case_file_id FOR UPDATE;
 ELSE SELECT * INTO c FROM public.case_files WHERE id=i.case_file_id;END IF;
 SELECT * INTO i FROM public.case_participant_invitations WHERE id=i.id;
 SELECT * INTO p FROM public.case_file_participants WHERE id=i.participant_id AND case_file_id=c.id AND workspace_id=c.workspace_id;
 IF i.revoked_at IS NOT NULL OR i.expires_at<=now() OR c.id IS NULL OR p.id IS NULL OR p.status IN ('revoked','cancelled') OR c.status='cancelled' OR c.workspace_id<>i.workspace_id THEN RAISE EXCEPTION 'CASE_PORTAL_INVALID' USING ERRCODE='42501';END IF;
 IF p_write AND (c.status='sealed' OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,c.owner_user_id,'member')) THEN RAISE EXCEPTION 'CASE_TERMINAL';END IF;
 RETURN jsonb_build_object('invitation',to_jsonb(i),'case',to_jsonb(c),'participant',to_jsonb(p));
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
 'forms',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'title',f.title,'required',f.is_required,'status',f.status,'canSubmit',c.status<>'sealed' AND f.status NOT IN ('approved','locked','completed','signed') AND NOT EXISTS(SELECT 1 FROM public.case_file_form_submissions s WHERE s.case_form_id=f.id AND s.submitted_at IS NOT NULL)) ORDER BY f.id) FROM public.case_file_forms f WHERE f.case_file_id=c.id AND f.participant_id=p.id),'[]'));
END;$$;

CREATE FUNCTION public.case_portal_prepare_upload(p_hash text,p_requirement uuid,p_operation uuid,p_meta jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE ctx jsonb;r public.case_file_requirements;u public.case_portal_uploads;n integer;
BEGIN
 ctx:=public.case_portal_context(p_hash,true);
 SELECT * INTO r FROM public.case_file_requirements WHERE id=p_requirement AND case_file_id=(ctx#>>'{case,id}')::uuid FOR UPDATE;
 IF r.id IS NULL OR ctx#>>'{participant,id}' IS DISTINCT FROM ctx#>>'{case,runtime_subject_id}' OR r.settings->>'kind' IS DISTINCT FROM 'requested_document' THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 IF r.status IN ('approved','locked') THEN RAISE EXCEPTION 'CASE_ITEM_LOCKED';END IF;
 SELECT current_version INTO n FROM public.case_file_documents WHERE requirement_id=r.id;
 IF n IS NOT NULL AND NOT coalesce((r.settings->>'allowReplacement')::boolean,true) THEN RAISE EXCEPTION 'CASE_REPLACEMENT_DISABLED';END IF;
 SELECT * INTO u FROM public.case_portal_uploads WHERE invitation_id=(ctx#>>'{invitation,id}')::uuid AND operation_key=p_operation;
 IF u.id IS NOT NULL THEN
  IF u.requirement_id<>r.id OR u.sha256<>p_meta->>'sha256' OR u.byte_size<>(p_meta->>'size')::bigint OR u.file_name<>p_meta->>'name' OR u.issue_date IS DISTINCT FROM (p_meta->>'issueDate')::date THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT';END IF;
  RETURN to_jsonb(u);
 END IF;
 IF (p_meta->>'size')::bigint>least(100,coalesce((r.settings->>'maxSizeMb')::numeric,15))*1048576 THEN RAISE EXCEPTION 'CASE_FILE_TOO_LARGE';END IF;
 IF (coalesce((r.settings->>'askIssueDate')::boolean,false) OR r.settings->>'validityDays' IS NOT NULL) AND ((p_meta->>'issueDate') IS NULL OR (p_meta->>'issueDate')::date>current_date) THEN RAISE EXCEPTION 'CASE_ISSUE_DATE_REQUIRED';END IF;
 INSERT INTO public.case_portal_uploads(invitation_id,requirement_id,operation_key,file_name,mime_type,byte_size,sha256,issue_date,key_ciphertext,nonce,base_version,expires_at)
 VALUES((ctx#>>'{invitation,id}')::uuid,r.id,p_operation,p_meta->>'name',p_meta->>'mime',(p_meta->>'size')::bigint,p_meta->>'sha256',(p_meta->>'issueDate')::date,p_meta->>'keyCiphertext',p_meta->>'nonce',coalesce(n,0),least((ctx#>>'{invitation,expires_at}')::timestamptz,now()+interval '30 minutes')) RETURNING * INTO u;
 RETURN to_jsonb(u);
END;$$;

CREATE FUNCTION public.case_portal_claim_upload(p_hash text,p_upload uuid,p_claim uuid,p_path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE ctx jsonb;u public.case_portal_uploads;r public.case_file_requirements;n integer;
BEGIN
 ctx:=public.case_portal_context(p_hash,true);
 SELECT * INTO u FROM public.case_portal_uploads WHERE id=p_upload AND invitation_id=(ctx#>>'{invitation,id}')::uuid FOR UPDATE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 IF u.status='completed' THEN RETURN to_jsonb(u);END IF;
 SELECT * INTO r FROM public.case_file_requirements WHERE id=u.requirement_id AND case_file_id=(ctx#>>'{case,id}')::uuid FOR UPDATE;
 SELECT current_version INTO n FROM public.case_file_documents WHERE requirement_id=r.id;
 IF ctx#>>'{participant,id}' IS DISTINCT FROM ctx#>>'{case,runtime_subject_id}' OR r.status IN ('approved','locked') OR coalesce(n,0)<>u.base_version OR u.expires_at<=now() THEN RAISE EXCEPTION 'CASE_UPLOAD_STALE';END IF;
 IF u.claim_expires_at>now() AND u.claim_id IS DISTINCT FROM p_claim THEN RAISE EXCEPTION 'CASE_UPLOAD_BUSY';END IF;
 IF u.storage_path IS NOT NULL AND u.storage_path<>p_path THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT';END IF;
 INSERT INTO public.documentos(id,documento_id,workspace_id,owner_id,nombre,file_name,file_type,file_size,file_hash_sha256,estado,deleted_at)
 VALUES(u.document_id,u.document_id,(ctx#>>'{case,workspace_id}')::uuid,(ctx#>>'{case,owner_user_id}')::uuid,r.title,u.file_name,u.mime_type,u.byte_size,u.sha256,'en_proceso',now()) ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.document_versions(id,document_id,workspace_id,version_number,status,storage_path,file_url,mime_type,byte_size,sha256,change_reason,created_by,metadata)
 VALUES(u.version_id,u.document_id,(ctx#>>'{case,workspace_id}')::uuid,1,'draft',p_path,'/api/documentos/'||u.document_id||'/viewer-file',u.mime_type,u.byte_size,u.sha256,'Entrega desde invitación de expediente',(ctx#>>'{case,owner_user_id}')::uuid,jsonb_build_object('source','case_participant_portal','upload_id',u.id)) ON CONFLICT(id) DO NOTHING;
 UPDATE public.case_portal_uploads SET status='committing',claim_id=p_claim,claim_expires_at=now()+interval '3 minutes',storage_path=p_path WHERE id=u.id RETURNING * INTO u;
 RETURN to_jsonb(u);
END;$$;

CREATE FUNCTION public.case_portal_commit_upload(p_hash text,p_upload uuid,p_claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE ctx jsonb;u public.case_portal_uploads;r public.case_file_requirements;snap jsonb;n integer;
BEGIN
 ctx:=public.case_portal_context(p_hash,true);
 SELECT * INTO u FROM public.case_portal_uploads WHERE id=p_upload AND invitation_id=(ctx#>>'{invitation,id}')::uuid FOR UPDATE;
 IF u.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 IF u.status='completed' THEN RETURN jsonb_build_object('id',u.id,'completed',true);END IF;
 IF u.claim_id IS DISTINCT FROM p_claim OR u.claim_expires_at<=now() OR u.expires_at<=now() THEN RAISE EXCEPTION 'CASE_UPLOAD_STALE';END IF;
 SELECT * INTO r FROM public.case_file_requirements WHERE id=u.requirement_id AND case_file_id=(ctx#>>'{case,id}')::uuid FOR UPDATE;
 SELECT current_version INTO n FROM public.case_file_documents WHERE requirement_id=r.id;
 IF ctx#>>'{participant,id}' IS DISTINCT FROM ctx#>>'{case,runtime_subject_id}' OR r.status IN ('approved','locked') OR coalesce(n,0)<>u.base_version THEN RAISE EXCEPTION 'CASE_UPLOAD_STALE';END IF;
 UPDATE public.documentos SET deleted_at=null,storage_path=u.storage_path,file_url='/api/documentos/'||u.document_id||'/viewer-file' WHERE id=u.document_id;
 snap:=public.case_control_snapshot((ctx#>>'{case,id}')::uuid,(ctx#>>'{case,owner_user_id}')::uuid,true);
 PERFORM public.case_control_attach((ctx#>>'{case,id}')::uuid,(ctx#>>'{case,owner_user_id}')::uuid,snap->>'revision',r.settings->>'id',u.document_id,'document',u.id,u.issue_date);
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata)
 VALUES((ctx#>>'{case,workspace_id}')::uuid,(ctx#>>'{case,id}')::uuid,null,'Participante invitado','participant_document_received','document',u.document_id::text,encode(extensions.digest(u.id::text||u.sha256,'sha256'),'hex'),jsonb_build_object('participant_id',ctx#>>'{participant,id}','invitation_id',ctx#>>'{invitation,id}','upload_id',u.id));
 UPDATE public.case_portal_uploads SET status='completed',completed_at=now(),claim_id=null,claim_expires_at=null WHERE id=u.id;
 INSERT INTO public.case_file_tasks(workspace_id,case_file_id,title,status) VALUES((ctx#>>'{case,workspace_id}')::uuid,(ctx#>>'{case,id}')::uuid,'case_runtime:refresh','pending') ON CONFLICT (case_file_id) WHERE title='case_runtime:refresh' AND status='pending' DO NOTHING;
 RETURN jsonb_build_object('id',u.id,'completed',true);
END;$$;

CREATE FUNCTION public.case_portal_form_token(p_hash text,p_form uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE ctx jsonb;f public.case_file_forms;t public.form_tokens;ft public.form_templates;
BEGIN
 ctx:=public.case_portal_context(p_hash,true);
 SELECT * INTO f FROM public.case_file_forms WHERE id=p_form AND case_file_id=(ctx#>>'{case,id}')::uuid AND participant_id=(ctx#>>'{participant,id}')::uuid FOR UPDATE;
 IF f.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 IF f.status IN ('approved','locked','completed','signed') OR EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_form_id=f.id AND submitted_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_ITEM_LOCKED';END IF;
 SELECT * INTO ft FROM public.form_templates WHERE id=f.form_template_id AND workspace_id=(ctx#>>'{case,workspace_id}')::uuid AND status='published';
 IF ft.id IS NULL OR ft.version_number::text IS DISTINCT FROM f.settings->>'sourceVersion' OR ft.revision_number::text IS DISTINCT FROM f.settings->>'sourceRevision' THEN RAISE EXCEPTION 'CASE_FORM_REVISION_CHANGED';END IF;
 SELECT tok.* INTO t FROM public.case_portal_form_tokens b JOIN public.form_tokens tok ON tok.id=b.token_id WHERE b.invitation_id=(ctx#>>'{invitation,id}')::uuid AND b.case_form_id=f.id AND tok.used_at IS NULL AND tok.expires_at>now() ORDER BY b.created_at DESC LIMIT 1;
 IF t.id IS NULL THEN
  INSERT INTO public.form_tokens(template_id,recipient_email,recipient_name,recipient_user_id,access_mode,expires_at,signature_type,require_liveness,launched_by_user_id,launcher_name,sent_to_self)
  VALUES(ft.id,ctx#>>'{invitation,recipient}',ctx#>>'{participant,name}',(ctx#>>'{participant,user_id}')::uuid,'private',(ctx#>>'{invitation,expires_at}')::timestamptz,'autografa_digital',false,(ctx#>>'{case,owner_user_id}')::uuid,ctx#>>'{invitation,sender_name}',false) RETURNING * INTO t;
  INSERT INTO public.case_portal_form_tokens(token_id,invitation_id,case_form_id) VALUES(t.id,(ctx#>>'{invitation,id}')::uuid,f.id);
 END IF;
 RETURN jsonb_build_object('token',t.token);
END;$$;

-- A bound form retains normal private-form login and identity checks. Direct
-- Data API inserts cannot impersonate a participant or manufacture a receipt.
CREATE FUNCTION case_runtime_private.guard_portal_response() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.case_portal_form_tokens;ctx jsonb;f public.case_file_forms;uid uuid;tok public.form_tokens;
BEGIN
 SELECT * INTO b FROM public.case_portal_form_tokens WHERE token_id=NEW.token_id;
 IF b.token_id IS NULL THEN RETURN NEW;END IF;
 IF current_setting('role',true) NOT IN ('service_role','postgres','supabase_admin','none') THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT * INTO tok FROM public.form_tokens WHERE id=b.token_id;
 ctx:=public.case_portal_context((SELECT token_hash FROM public.case_participant_invitations WHERE id=b.invitation_id),true);
 SELECT * INTO f FROM public.case_file_forms WHERE id=b.case_form_id AND case_file_id=(ctx#>>'{case,id}')::uuid AND participant_id=(ctx#>>'{participant,id}')::uuid;
 IF f.id IS NULL OR NEW.template_id<>f.form_template_id OR NEW.workspace_id<>(ctx#>>'{case,workspace_id}')::uuid OR lower(NEW.respondent_email) IS DISTINCT FROM lower(ctx#>>'{invitation,recipient}') OR tok.access_mode<>'private' OR tok.expires_at<=now() OR (TG_OP='INSERT' AND tok.used_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT id INTO uid FROM auth.users WHERE lower(email)=lower(NEW.respondent_email) AND email_confirmed_at IS NOT NULL LIMIT 1;
 IF uid IS NULL OR (NEW.respondent_user_id IS NOT NULL AND NEW.respondent_user_id<>uid) THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 NEW.respondent_user_id:=uid;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_form_id=f.id AND submitted_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_ITEM_LOCKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.form_templates ft WHERE ft.id=f.form_template_id AND ft.status='published' AND ft.version_number::text=f.settings->>'sourceVersion' AND ft.revision_number::text=f.settings->>'sourceRevision') THEN RAISE EXCEPTION 'CASE_FORM_REVISION_CHANGED';END IF;
 UPDATE public.case_file_participants SET user_id=uid WHERE id=f.participant_id AND user_id IS NULL;
 RETURN NEW;
END;$$;
CREATE TRIGGER case_portal_response_guard BEFORE INSERT OR UPDATE OF response_data,pdf_output_hash,submitted_at,respondent_email,respondent_user_id,token_id,template_id,workspace_id ON public.form_responses FOR EACH ROW EXECUTE FUNCTION case_runtime_private.guard_portal_response();

CREATE FUNCTION case_runtime_private.bind_portal_response() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.case_portal_form_tokens;f public.case_file_forms;c public.case_files;snap jsonb;
BEGIN
 SELECT * INTO b FROM public.case_portal_form_tokens WHERE token_id=NEW.token_id;
 IF b.token_id IS NULL OR NEW.submitted_at IS NULL OR length(coalesce(NEW.pdf_output_hash,''))<>64 OR NEW.status NOT IN ('submitted','pdf_generated','signing','completed','signed','approved') THEN RETURN NULL;END IF;
 SELECT * INTO f FROM public.case_file_forms WHERE id=b.case_form_id;
 SELECT * INTO c FROM public.case_files WHERE id=f.case_file_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_form_id=f.id AND form_response_id=NEW.id) THEN RETURN NULL;END IF;
 PERFORM public.case_portal_context((SELECT token_hash FROM public.case_participant_invitations WHERE id=b.invitation_id),true);
 snap:=public.case_control_snapshot(c.id,c.owner_user_id,true);
 PERFORM public.case_control_attach(c.id,c.owner_user_id,snap->>'revision',f.template_item_id,NEW.id,'form',NEW.id);
 INSERT INTO public.case_file_tasks(workspace_id,case_file_id,title,status) VALUES(c.workspace_id,c.id,'case_runtime:refresh','pending') ON CONFLICT (case_file_id) WHERE title='case_runtime:refresh' AND status='pending' DO NOTHING;
 RETURN NULL;
END;$$;
CREATE TRIGGER case_portal_response_bind AFTER INSERT OR UPDATE ON public.form_responses FOR EACH ROW EXECUTE FUNCTION case_runtime_private.bind_portal_response();

CREATE FUNCTION case_runtime_private.revoke_portal_forms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='case_participant_invitations' THEN
  UPDATE public.form_tokens SET expires_at=least(expires_at,CASE WHEN NEW.revoked_at IS NOT NULL THEN now() ELSE NEW.expires_at END) WHERE id IN (SELECT token_id FROM public.case_portal_form_tokens WHERE invitation_id=NEW.id);
 ELSE
  IF NEW.status IN ('sealed','cancelled') THEN UPDATE public.form_tokens SET expires_at=least(expires_at,now()) WHERE id IN (SELECT b.token_id FROM public.case_portal_form_tokens b JOIN public.case_participant_invitations i ON i.id=b.invitation_id WHERE i.case_file_id=NEW.id);END IF;
 END IF;
 RETURN NULL;
END;$$;
CREATE TRIGGER case_portal_invite_revoke AFTER UPDATE OF revoked_at,expires_at ON public.case_participant_invitations FOR EACH ROW EXECUTE FUNCTION case_runtime_private.revoke_portal_forms();
CREATE TRIGGER case_portal_case_stop AFTER UPDATE OF status ON public.case_files FOR EACH ROW EXECUTE FUNCTION case_runtime_private.revoke_portal_forms();

REVOKE ALL ON FUNCTION public.case_portal_context(text,boolean),public.case_portal_prepare_upload(text,uuid,uuid,jsonb),public.case_portal_claim_upload(text,uuid,uuid,text),public.case_portal_commit_upload(text,uuid,uuid),public.case_portal_form_token(text,uuid),case_runtime_private.guard_portal_response(),case_runtime_private.bind_portal_response(),case_runtime_private.revoke_portal_forms() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_portal_context(text,boolean),public.case_portal_prepare_upload(text,uuid,uuid,jsonb),public.case_portal_claim_upload(text,uuid,uuid,text),public.case_portal_commit_upload(text,uuid,uuid),public.case_portal_form_token(text,uuid) TO service_role;
