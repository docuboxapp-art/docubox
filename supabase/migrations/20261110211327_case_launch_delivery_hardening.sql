ALTER TABLE case_runtime_private.dispatch_config ENABLE ROW LEVEL SECURITY;
CREATE INDEX case_launches_creator ON public.case_launches(created_by);
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
 code_ok:=cfg.access_mode='private' OR (g.code_verified AND g.expires_at>now());
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

ALTER TABLE public.case_participant_invitations ADD COLUMN launch_configured boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.case_launch_configured(p_template uuid,p_actor uuid,p_title text,p_subject_name text,p_subject_user uuid,p_assignments jsonb,p_operation uuid,p_subject_email text,p_participants jsonb,p_deliveries jsonb,p_origin text,p_settings jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE saved public.case_launches; fingerprint text;result jsonb;i public.case_participant_invitations;cred jsonb;scheduled timestamptz;hours numeric;mode text;method text;
BEGIN
 mode:=p_settings->>'accessMode';method:=p_settings->>'signatureType';hours:=(p_settings->>'expirationHours')::numeric;scheduled:=(p_settings->>'scheduledAt')::timestamptz;
 IF mode NOT IN ('private','public') OR method NOT IN ('click_sign','autografa_digital','efirma_sat') OR hours IS NULL OR hours<0.0166666666 OR hours>720 OR jsonb_typeof(p_settings->'requireLiveness')<>'boolean' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_settings->>'timezone') THEN RAISE EXCEPTION 'CASE_LAUNCH_SETTINGS_INVALID';END IF;
 fingerprint:=encode(extensions.digest(jsonb_build_object('template',p_template,'actor',p_actor,'title',p_title,'name',p_subject_name,'user',p_subject_user,'email',lower(p_subject_email),'participants',p_participants,'assignments',p_assignments,'settings',p_settings)::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 SELECT * INTO saved FROM public.case_launches WHERE case_file_id=p_operation;
 IF saved.case_file_id IS NOT NULL THEN
  IF NOT public.case_invitation_authorize(p_operation,p_actor) THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
  IF saved.request_hash<>fingerprint THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT';END IF;
  RETURN jsonb_build_object('id',p_operation,'scheduledAt',saved.scheduled_at);
 END IF;
 IF scheduled IS NOT NULL AND (scheduled<=now()+interval '1 minute' OR scheduled>now()+interval '365 days') THEN RAISE EXCEPTION 'CASE_SCHEDULE_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM public.case_files WHERE id=p_operation) THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT';END IF;
 result:=public.case_launch_invited(p_template,p_actor,p_title,p_subject_name,p_subject_user,p_assignments,p_operation,p_subject_email,p_participants,p_deliveries,p_origin);
 INSERT INTO public.case_launches(case_file_id,workspace_id,created_by,access_mode,signature_type,require_liveness,expiration_hours,scheduled_at,timezone,request_hash)
 SELECT c.id,c.workspace_id,p_actor,mode,method,mode='public' OR (p_settings->>'requireLiveness')::boolean,hours,scheduled,p_settings->>'timezone',fingerprint FROM public.case_files c WHERE c.id=p_operation;
 -- A linked form must support the method selected for this launch.
 IF EXISTS(SELECT 1 FROM public.case_file_forms f JOIN public.form_templates t ON t.id=f.form_template_id WHERE f.case_file_id=p_operation AND f.requires_signature AND NOT method=ANY(t.allowed_signature_types)) THEN RAISE EXCEPTION 'CASE_SIGNATURE_METHOD_UNAVAILABLE';END IF;
 UPDATE public.case_participant_invitations SET launch_configured=true,not_before=coalesce(scheduled,now()),expires_at=coalesce(scheduled,now())+hours*interval '1 hour' WHERE case_file_id=p_operation;
 IF mode='public' THEN
  FOR i IN SELECT * FROM public.case_participant_invitations WHERE case_file_id=p_operation LOOP
   SELECT value INTO cred FROM jsonb_array_elements(p_deliveries) WHERE value->>'hash'=i.token_hash;
   IF coalesce(cred->>'codeHash','') !~ '^[a-f0-9]{64}$' OR length(coalesce(cred->>'codeCiphertext',''))<40 THEN RAISE EXCEPTION 'CASE_LAUNCH_SETTINGS_INVALID';END IF;
   INSERT INTO public.case_invitation_codes(invitation_id,code_hash,code_ciphertext) VALUES(i.id,cred->>'codeHash',cred->>'codeCiphertext');
  END LOOP;
 END IF;
 RETURN result||jsonb_build_object('scheduledAt',scheduled);
END;$$;

CREATE OR REPLACE FUNCTION public.case_invitation_manage(p_case uuid,p_actor uuid,p_id uuid,p_action text,p_operation uuid,p_credential jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE renewed_id uuid;cfg public.case_launches;
BEGIN
 renewed_id:=case_runtime_private.case_invitation_manage_legacy(p_case,p_actor,p_id,p_action,p_operation,p_credential);
 SELECT * INTO cfg FROM public.case_launches WHERE case_file_id=p_case;
 IF p_action='renew' AND cfg.case_file_id IS NOT NULL THEN
  UPDATE public.case_participant_invitations SET launch_configured=true,not_before=greatest(coalesce(cfg.scheduled_at,now()),now()),expires_at=greatest(coalesce(cfg.scheduled_at,now()),now())+cfg.expiration_hours*interval '1 hour' WHERE case_participant_invitations.id=renewed_id AND sent_at IS NULL AND NOT launch_configured;
  IF cfg.access_mode='public' AND NOT EXISTS(SELECT 1 FROM public.case_invitation_codes WHERE invitation_id=renewed_id) THEN
   IF coalesce(p_credential->>'codeHash','')!~'^[a-f0-9]{64}$' OR length(coalesce(p_credential->>'codeCiphertext',''))<40 THEN RAISE EXCEPTION 'CASE_LAUNCH_SETTINGS_INVALID';END IF;
   INSERT INTO public.case_invitation_codes(invitation_id,code_hash,code_ciphertext) VALUES(renewed_id,p_credential->>'codeHash',p_credential->>'codeCiphertext');
  END IF;
 END IF;RETURN renewed_id;
END;$$;
