CREATE OR REPLACE FUNCTION public.case_control_otp(p_case uuid,p_actor uuid,p_challenge uuid,p_valid boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files; invitation public.case_file_invitations; proof jsonb;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF c.id IS NULL OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'member') THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF c.runtime_version<>1 OR c.status IN ('sealed','cancelled') THEN RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
 SELECT * INTO invitation FROM public.case_file_invitations WHERE id=p_challenge AND case_file_id=c.id AND participant_id=c.runtime_subject_id FOR UPDATE;
 IF invitation.id IS NULL OR invitation.revoked_at IS NOT NULL OR invitation.delivery_status<>'sent' OR invitation.expires_at<=now() OR invitation.otp_attempts>=5 OR invitation.otp_verified_at IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.case_file_invitations SET otp_attempts=otp_attempts+1,otp_verified_at=CASE WHEN p_valid THEN now() ELSE NULL END WHERE id=invitation.id;
 IF NOT p_valid THEN RETURN false; END IF;
 proof:=jsonb_build_object('type','email_otp','sourceId',invitation.id,'subjectId',c.runtime_subject_id);
 UPDATE public.case_file_identity_checks SET status='approved',verified_at=now(),reviewed_by=p_actor,result=result||jsonb_build_object('proof',proof),evidence_hash=encode(extensions.digest(proof::text,'sha256'),'hex') WHERE case_file_id=c.id AND template_verification_id=invitation.verification_id AND participant_id=c.runtime_subject_id AND method='email_otp';
 IF NOT FOUND THEN RAISE EXCEPTION 'CASE_VERIFICATION_INVALID'; END IF;
 UPDATE public.case_files SET review_approval='{}',version=version+1,updated_at=now() WHERE id=c.id;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata)
  VALUES(c.workspace_id,c.id,p_actor,'Usuario autorizado','case_runtime:email_verified','identity_check',invitation.verification_id,encode(extensions.digest(proof::text,'sha256'),'hex'),jsonb_build_object('challengeId',invitation.id));
 RETURN true;
END; $$;
