CREATE OR REPLACE FUNCTION public.case_portal_authorize_actor(p_hash text,p_actor uuid,p_code_hash text DEFAULT NULL,p_capture_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;i public.case_participant_invitations;cfg public.case_launches;person public.case_file_participants;actor auth.users;g public.case_invitation_access_grants;capture public.mobile_upload_sessions;proof public.id_capture_logs;code_ok boolean;live_at timestamptz;capture_id uuid;
BEGIN
 ctx:=public.case_portal_context(p_hash,false);
 SELECT * INTO i FROM public.case_participant_invitations WHERE id=(ctx#>>'{invitation,id}')::uuid;
 SELECT * INTO cfg FROM public.case_launches WHERE case_file_id=i.case_file_id;
 IF cfg.case_file_id IS NULL THEN RETURN jsonb_build_object('authorized',true,'legacy',true);END IF;
 SELECT * INTO actor FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL AND coalesce(is_anonymous,false)=false;
 IF actor.id IS NULL OR lower(actor.email) IS DISTINCT FROM lower(i.recipient) THEN RAISE EXCEPTION 'CASE_PORTAL_ACCOUNT_REQUIRED' USING ERRCODE='42501';END IF;
 SELECT * INTO person FROM public.case_file_participants WHERE id=i.participant_id;
 IF person.user_id IS NOT NULL AND person.user_id<>actor.id THEN RAISE EXCEPTION 'CASE_PORTAL_SCOPE' USING ERRCODE='42501';END IF;
 SELECT * INTO g FROM public.case_invitation_access_grants WHERE invitation_id=i.id AND user_id=actor.id;
 code_ok:=cfg.access_mode='private' OR coalesce(g.code_verified AND g.expires_at>now(),false);
 IF p_code_hash IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.case_invitation_codes WHERE invitation_id=i.id AND code_hash=p_code_hash) THEN RAISE EXCEPTION 'CASE_PORTAL_CODE_INVALID' USING ERRCODE='42501';END IF;code_ok:=true;
 END IF;
 IF NOT code_ok THEN RETURN jsonb_build_object('authorized',false,'reason','code');END IF;
 live_at:=g.liveness_verified_at;capture_id:=g.liveness_session_id;
 IF p_capture_hash IS NOT NULL THEN
  SELECT * INTO capture FROM public.mobile_upload_sessions WHERE token_hash=p_capture_hash AND user_id=actor.id AND status='completed' AND metadata->>'mode'='case_portal_liveness' AND metadata->>'case_invitation_id'=i.id::text AND expires_at>now() AND metadata->>'identity_match'='true' AND metadata#>>'{provider,liveness_passed}'='true' AND metadata#>>'{provider,face_match}'='true';
  IF capture.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_LIVENESS_REQUIRED';END IF;
  SELECT * INTO proof FROM public.id_capture_logs WHERE id=CASE WHEN capture.metadata->>'capture_log_id' ~ '^[a-f0-9-]{36}$' THEN (capture.metadata->>'capture_log_id')::uuid ELSE NULL END AND session_token=capture.token_hash AND user_id=actor.id AND identity_match=true AND nubarium_aprobado=true AND raw_nubarium_response->>'case_invitation_id'=i.id::text AND raw_nubarium_response->>'liveness_passed'='true' AND raw_nubarium_response->>'face_match'='true' AND created_at>now()-interval '10 minutes';
  IF proof.id IS NULL THEN RAISE EXCEPTION 'CASE_PORTAL_LIVENESS_REQUIRED';END IF;
  live_at:=proof.created_at;capture_id:=capture.id;
 END IF;
 INSERT INTO public.case_invitation_access_grants(invitation_id,user_id,code_verified,liveness_session_id,liveness_verified_at,expires_at)
 VALUES(i.id,actor.id,code_ok,capture_id,live_at,least(i.expires_at,now()+interval '24 hours'))
 ON CONFLICT(invitation_id,user_id) DO UPDATE SET code_verified=excluded.code_verified,liveness_session_id=excluded.liveness_session_id,liveness_verified_at=excluded.liveness_verified_at,expires_at=excluded.expires_at;
 IF cfg.require_liveness AND (live_at IS NULL OR live_at<now()-interval '24 hours') THEN RETURN jsonb_build_object('authorized',false,'reason','liveness');END IF;
 IF ctx#>>'{case,status}' NOT IN ('sealed','cancelled') THEN
  UPDATE public.case_file_participants SET user_id=actor.id WHERE id=person.id AND user_id IS NULL;
 END IF;
 RETURN jsonb_build_object('authorized',true);
END;$$;
