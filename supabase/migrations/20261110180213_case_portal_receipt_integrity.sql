CREATE OR REPLACE FUNCTION case_runtime_private.guard_portal_response() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.case_portal_form_tokens;ctx jsonb;f public.case_file_forms;uid uuid;tok public.form_tokens;
BEGIN
 SELECT * INTO b FROM public.case_portal_form_tokens WHERE token_id=CASE WHEN TG_OP='DELETE' THEN OLD.token_id ELSE NEW.token_id END;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.case_portal_form_tokens WHERE token_id=OLD.token_id) AND ROW(NEW.token_id,NEW.template_id,NEW.workspace_id,NEW.id) IS DISTINCT FROM ROW(OLD.token_id,OLD.template_id,OLD.workspace_id,OLD.id) THEN RAISE EXCEPTION 'CASE_FORM_RECEIPT_IMMUTABLE';END IF;
 IF TG_OP='DELETE' THEN IF b.token_id IS NOT NULL THEN RAISE EXCEPTION 'CASE_FORM_RECEIPT_IMMUTABLE';END IF;RETURN OLD;END IF;
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

DROP TRIGGER case_portal_response_guard ON public.form_responses;
CREATE TRIGGER case_portal_response_guard BEFORE INSERT OR UPDATE OR DELETE ON public.form_responses FOR EACH ROW EXECUTE FUNCTION case_runtime_private.guard_portal_response();
CREATE OR REPLACE FUNCTION case_runtime_private.bind_portal_response() RETURNS trigger
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
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata) VALUES(c.workspace_id,c.id,NEW.respondent_user_id,'Participante del expediente','participant_form_received','form',f.id::text,encode(extensions.digest(NEW.id::text||NEW.pdf_output_hash,'sha256'),'hex'),jsonb_build_object('participant_id',f.participant_id,'response_id',NEW.id,'invitation_id',b.invitation_id));
 INSERT INTO public.case_file_tasks(workspace_id,case_file_id,title,status) VALUES(c.workspace_id,c.id,'case_runtime:refresh','pending') ON CONFLICT (case_file_id) WHERE title='case_runtime:refresh' AND status='pending' DO NOTHING;
 RETURN NULL;
END;$$;
