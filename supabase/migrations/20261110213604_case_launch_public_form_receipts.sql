-- Finalized case form evidence cannot be overwritten by a PDF retry.
CREATE OR REPLACE FUNCTION case_runtime_private.guard_portal_response() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b public.case_portal_form_tokens;ctx jsonb;f public.case_file_forms;uid uuid;tok public.form_tokens;
BEGIN
 SELECT * INTO b FROM public.case_portal_form_tokens WHERE token_id=CASE WHEN TG_OP='DELETE' THEN OLD.token_id ELSE NEW.token_id END;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.case_portal_form_tokens WHERE token_id=OLD.token_id) AND ROW(NEW.token_id,NEW.template_id,NEW.workspace_id,NEW.id) IS DISTINCT FROM ROW(OLD.token_id,OLD.template_id,OLD.workspace_id,OLD.id) THEN RAISE EXCEPTION 'CASE_FORM_RECEIPT_IMMUTABLE';END IF;
 IF TG_OP='UPDATE' AND OLD.pdf_output_hash IS NOT NULL AND EXISTS(SELECT 1 FROM public.case_portal_form_tokens WHERE token_id=OLD.token_id) AND ROW(NEW.response_data,NEW.field_hashes,NEW.pdf_output_hash,NEW.pdf_output_path,NEW.generated_pdf_id) IS DISTINCT FROM ROW(OLD.response_data,OLD.field_hashes,OLD.pdf_output_hash,OLD.pdf_output_path,OLD.generated_pdf_id) THEN RAISE EXCEPTION 'CASE_FORM_RECEIPT_IMMUTABLE';END IF;
 IF TG_OP='DELETE' THEN IF b.token_id IS NOT NULL THEN RAISE EXCEPTION 'CASE_FORM_RECEIPT_IMMUTABLE';END IF;RETURN OLD;END IF;
 IF b.token_id IS NULL THEN RETURN NEW;END IF;
 IF current_setting('role',true) NOT IN ('service_role','postgres','supabase_admin','none') THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT * INTO tok FROM public.form_tokens WHERE id=b.token_id;
 ctx:=public.case_portal_context((SELECT token_hash FROM public.case_participant_invitations WHERE id=b.invitation_id),true);
 SELECT * INTO f FROM public.case_file_forms WHERE id=b.case_form_id AND case_file_id=(ctx#>>'{case,id}')::uuid AND participant_id=(ctx#>>'{participant,id}')::uuid;
 IF f.id IS NULL OR NEW.template_id<>f.form_template_id OR NEW.workspace_id<>(ctx#>>'{case,workspace_id}')::uuid OR lower(NEW.respondent_email) IS DISTINCT FROM lower(ctx#>>'{invitation,recipient}') OR coalesce(tok.access_mode,'') NOT IN ('private','public') OR tok.expires_at<=now() OR (TG_OP='INSERT' AND tok.used_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT id INTO uid FROM auth.users WHERE lower(email)=lower(NEW.respondent_email) AND email_confirmed_at IS NOT NULL LIMIT 1;
 IF uid IS NULL OR (NEW.respondent_user_id IS NOT NULL AND NEW.respondent_user_id<>uid) THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;

 IF tok.access_mode='public' AND (tok.recipient_user_id IS DISTINCT FROM uid OR tok.liveness_verified_at IS NULL OR tok.liveness_verified_at<now()-interval '24 hours' OR NOT EXISTS(SELECT 1 FROM public.case_launches l JOIN public.case_invitation_access_grants g ON g.invitation_id=b.invitation_id AND g.user_id=uid WHERE l.case_file_id=f.case_file_id AND l.access_mode='public' AND g.code_verified AND g.liveness_verified_at>now()-interval '24 hours' AND g.expires_at>now())) THEN RAISE EXCEPTION 'CASE_PORTAL_LIVENESS_REQUIRED';END IF;
 -- Case forms are per invitation; the global non-null respondent index
 -- remains unchanged for standalone public forms. Identity is bound to the
 -- verified participant, scoped child token and immutable case receipt.
 NEW.respondent_user_id:=null;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_form_id=f.id AND submitted_at IS NOT NULL) THEN RAISE EXCEPTION 'CASE_ITEM_LOCKED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.form_templates ft WHERE ft.id=f.form_template_id AND ft.status='published' AND ft.version_number::text=f.settings->>'sourceVersion' AND ft.revision_number::text=f.settings->>'sourceRevision') THEN RAISE EXCEPTION 'CASE_FORM_REVISION_CHANGED';END IF;
 UPDATE public.case_file_participants SET user_id=uid WHERE id=f.participant_id AND user_id IS NULL;
 RETURN NEW;
END;$$;
