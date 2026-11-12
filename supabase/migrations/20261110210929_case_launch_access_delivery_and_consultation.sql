-- A configured launch remains separate from the published definition and from
-- documentary/identity/signature evidence. All mutations use the service API.
ALTER TABLE public.case_participant_invitations ADD COLUMN not_before timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.case_launches (
 case_file_id uuid PRIMARY KEY REFERENCES public.case_files(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 created_by uuid NOT NULL REFERENCES auth.users(id), access_mode text NOT NULL CHECK(access_mode IN ('private','public')),
 signature_type text NOT NULL CHECK(signature_type IN ('click_sign','autografa_digital','efirma_sat')),
 require_liveness boolean NOT NULL DEFAULT false, expiration_hours numeric NOT NULL CHECK(expiration_hours BETWEEN 0.0166666666 AND 720),
 scheduled_at timestamptz,timezone text NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_launches_workspace ON public.case_launches(workspace_id);
ALTER TABLE public.case_launches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_launches FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_launches TO service_role;
CREATE TABLE public.case_invitation_codes (
 invitation_id uuid PRIMARY KEY REFERENCES public.case_participant_invitations(id), code_hash text NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 code_ciphertext text NOT NULL,payload_ciphertext text,delivery_status text NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sending','retrying','failed','sent','attention')),
 attempt_count integer NOT NULL DEFAULT 0,claim_id uuid,claim_expires_at timestamptz,first_attempt_at timestamptz,sent_at timestamptz,provider_message_id text,last_code text
);
ALTER TABLE public.case_invitation_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_invitation_codes FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_invitation_codes TO service_role;
CREATE INDEX case_invitation_due ON public.case_participant_invitations(not_before,case_file_id) WHERE revoked_at IS NULL AND delivery_status IN ('pending','retrying','failed','sending');

CREATE FUNCTION public.case_launch_configured(p_template uuid,p_actor uuid,p_title text,p_subject_name text,p_subject_user uuid,p_assignments jsonb,p_operation uuid,p_subject_email text,p_participants jsonb,p_deliveries jsonb,p_origin text,p_settings jsonb) RETURNS jsonb
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
 UPDATE public.case_participant_invitations SET not_before=coalesce(scheduled,now()),expires_at=coalesce(scheduled,now())+hours*interval '1 hour' WHERE case_file_id=p_operation;
 IF mode='public' THEN
  FOR i IN SELECT * FROM public.case_participant_invitations WHERE case_file_id=p_operation LOOP
   SELECT value INTO cred FROM jsonb_array_elements(p_deliveries) WHERE value->>'hash'=i.token_hash;
   IF coalesce(cred->>'codeHash','') !~ '^[a-f0-9]{64}$' OR length(coalesce(cred->>'codeCiphertext',''))<40 THEN RAISE EXCEPTION 'CASE_LAUNCH_SETTINGS_INVALID';END IF;
   INSERT INTO public.case_invitation_codes(invitation_id,code_hash,code_ciphertext) VALUES(i.id,cred->>'codeHash',cred->>'codeCiphertext');
  END LOOP;
 END IF;
 RETURN result||jsonb_build_object('scheduledAt',scheduled);
END;$$;

CREATE OR REPLACE FUNCTION public.case_invitation_claim(p_case uuid,p_actor uuid) RETURNS SETOF public.case_participant_invitations
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501';END IF;
 IF c.status IN ('sealed','cancelled') THEN RETURN;END IF;
 UPDATE public.case_participant_invitations SET delivery_status='attention',last_code='RETRY_WINDOW_EXPIRED',claim_id=null,claim_expires_at=null
 WHERE case_file_id=p_case AND revoked_at IS NULL AND delivery_status<>'sent' AND first_attempt_at<now()-interval '23 hours';
 RETURN QUERY UPDATE public.case_participant_invitations i SET delivery_status='sending',claim_id=gen_random_uuid(),claim_expires_at=now()+interval '110 seconds',attempt_count=attempt_count+1,first_attempt_at=coalesce(first_attempt_at,now())
 WHERE i.id IN (SELECT id FROM public.case_participant_invitations WHERE case_file_id=p_case AND revoked_at IS NULL AND expires_at>now() AND not_before<=now() AND attempt_count<8
 AND (delivery_status IN ('pending','retrying','failed') OR (delivery_status='sending' AND claim_expires_at<now())) ORDER BY created_at,id LIMIT 21 FOR UPDATE SKIP LOCKED) RETURNING i.*;
END;$$;

CREATE FUNCTION public.case_invitation_code_claim(p_case uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files;outcome jsonb;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501';END IF;
 IF c.status IN ('sealed','cancelled') THEN RETURN '[]';END IF;
 UPDATE public.case_invitation_codes code SET delivery_status='attention',claim_id=null,claim_expires_at=null,last_code='RETRY_WINDOW_EXPIRED'
 FROM public.case_participant_invitations i WHERE i.id=code.invitation_id AND i.case_file_id=p_case AND code.delivery_status<>'sent' AND (code.first_attempt_at<now()-interval '23 hours' OR code.attempt_count>=8);
 WITH claims AS (
  UPDATE public.case_invitation_codes code SET delivery_status='sending',claim_id=gen_random_uuid(),claim_expires_at=now()+interval '110 seconds',first_attempt_at=coalesce(code.first_attempt_at,now()),attempt_count=code.attempt_count+1
  WHERE invitation_id IN(SELECT k.invitation_id FROM public.case_invitation_codes k JOIN public.case_participant_invitations i ON i.id=k.invitation_id WHERE i.case_file_id=p_case AND i.revoked_at IS NULL AND i.expires_at>now() AND i.not_before<=now() AND i.delivery_status='sent' AND k.attempt_count<8 AND (k.delivery_status IN ('pending','retrying','failed') OR (k.delivery_status='sending' AND k.claim_expires_at<now())) ORDER BY i.id LIMIT 21 FOR UPDATE OF k SKIP LOCKED) RETURNING *
 ) SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('kind','code','token_ciphertext',k.code_ciphertext,'payload_ciphertext',k.payload_ciphertext,'claim_id',k.claim_id)),'[]') INTO outcome FROM claims k JOIN public.case_participant_invitations i ON i.id=k.invitation_id;
 RETURN outcome;
END;$$;
CREATE FUNCTION public.case_invitation_code_payload(p_id uuid,p_claim uuid,p_ciphertext text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE saved text;
BEGIN
 PERFORM 1 FROM public.case_files WHERE id=(SELECT case_file_id FROM public.case_participant_invitations WHERE id=p_id) FOR UPDATE;
 UPDATE public.case_invitation_codes code SET payload_ciphertext=coalesce(code.payload_ciphertext,p_ciphertext) FROM public.case_participant_invitations i WHERE code.invitation_id=p_id AND i.id=p_id AND i.revoked_at IS NULL AND i.expires_at>now() AND code.claim_id=p_claim AND code.claim_expires_at>now() AND code.delivery_status='sending' RETURNING code.payload_ciphertext INTO saved;
 IF saved IS NULL THEN RAISE EXCEPTION 'CASE_INVITATION_CLAIM_EXPIRED';END IF;RETURN saved;
END;$$;
CREATE FUNCTION public.case_invitation_code_finish(p_id uuid,p_claim uuid,p_status text,p_provider text,p_code text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF p_status NOT IN ('sent','failed','retrying','pending') OR (p_status='sent' AND coalesce(p_provider,'')='') THEN RAISE EXCEPTION 'CASE_INVITATION_INVALID';END IF;
 PERFORM 1 FROM public.case_files WHERE id=(SELECT case_file_id FROM public.case_participant_invitations WHERE id=p_id) FOR UPDATE;
 UPDATE public.case_invitation_codes SET delivery_status=p_status,provider_message_id=CASE WHEN p_status='sent' THEN left(p_provider,128) ELSE provider_message_id END,sent_at=CASE WHEN p_status='sent' THEN now() ELSE sent_at END,last_code=left(regexp_replace(coalesce(p_code,''),'[^A-Z0-9_]','','g'),64),claim_id=null,claim_expires_at=null WHERE invitation_id=p_id AND claim_id=p_claim AND delivery_status='sending';
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n>0;
END;$$;

CREATE OR REPLACE FUNCTION public.case_invitation_summary(p_case uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.recipient_name,'email',i.recipient,'role',i.participant_role,
 'status',CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.expires_at<=now() THEN 'expired' WHEN i.not_before>now() THEN 'scheduled' WHEN i.delivery_status='sent' AND k.invitation_id IS NOT NULL THEN k.delivery_status WHEN i.attempt_count>=8 AND i.delivery_status<>'sent' THEN 'attention' ELSE i.delivery_status END,
 'sentAt',i.sent_at,'expiresAt',i.expires_at,'codeRequired',k.invitation_id IS NOT NULL,'codeSentAt',k.sent_at,'scheduledAt',CASE WHEN i.not_before>i.created_at+interval '30 seconds' THEN i.not_before ELSE null END) ORDER BY i.recipient_name),'[]') INTO result
 FROM (SELECT DISTINCT ON(participant_id) * FROM public.case_participant_invitations WHERE case_file_id=p_case ORDER BY participant_id,generation DESC) i LEFT JOIN public.case_invitation_codes k ON k.invitation_id=i.id;
 RETURN result;
END;$$;

ALTER FUNCTION public.case_invitation_manage(uuid,uuid,uuid,text,uuid,jsonb) SET SCHEMA case_runtime_private;
ALTER FUNCTION case_runtime_private.case_invitation_manage(uuid,uuid,uuid,text,uuid,jsonb) RENAME TO case_invitation_manage_legacy;
CREATE FUNCTION public.case_invitation_manage(p_case uuid,p_actor uuid,p_id uuid,p_action text,p_operation uuid,p_credential jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE renewed_id uuid;cfg public.case_launches;
BEGIN
 renewed_id:=case_runtime_private.case_invitation_manage_legacy(p_case,p_actor,p_id,p_action,p_operation,p_credential);
 SELECT * INTO cfg FROM public.case_launches WHERE case_file_id=p_case;
 IF p_action='renew' AND cfg.case_file_id IS NOT NULL THEN
  UPDATE public.case_participant_invitations SET not_before=greatest(coalesce(cfg.scheduled_at,now()),now()),expires_at=greatest(coalesce(cfg.scheduled_at,now()),now())+cfg.expiration_hours*interval '1 hour' WHERE case_participant_invitations.id=renewed_id AND sent_at IS NULL;
  IF cfg.access_mode='public' AND NOT EXISTS(SELECT 1 FROM public.case_invitation_codes WHERE invitation_id=renewed_id) THEN
   IF coalesce(p_credential->>'codeHash','')!~'^[a-f0-9]{64}$' OR length(coalesce(p_credential->>'codeCiphertext',''))<40 THEN RAISE EXCEPTION 'CASE_LAUNCH_SETTINGS_INVALID';END IF;
   INSERT INTO public.case_invitation_codes(invitation_id,code_hash,code_ciphertext) VALUES(renewed_id,p_credential->>'codeHash',p_credential->>'codeCiphertext');
  END IF;
 END IF;RETURN renewed_id;
END;$$;

CREATE FUNCTION public.case_dispatch_due(p_limit integer DEFAULT 4) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]') FROM (SELECT DISTINCT c.id,c.owner_user_id FROM public.case_files c JOIN public.case_launches l ON l.case_file_id=c.id JOIN public.case_participant_invitations i ON i.case_file_id=c.id LEFT JOIN public.case_invitation_codes k ON k.invitation_id=i.id
 WHERE c.status NOT IN ('sealed','cancelled') AND i.revoked_at IS NULL AND i.not_before<=now() AND i.expires_at>now() AND public.case_actor_eligible(c.workspace_id,c.owner_user_id,c.owner_user_id,'member')
 AND ((i.attempt_count<8 AND (i.delivery_status IN ('pending','retrying') OR (i.delivery_status='failed' AND coalesce(i.first_attempt_at,now())>now()-interval '23 hours') OR (i.delivery_status='sending' AND i.claim_expires_at<now()))) OR (i.delivery_status='sent' AND k.attempt_count<8 AND (k.delivery_status IN ('pending','retrying','failed') OR (k.delivery_status='sending' AND k.claim_expires_at<now())))) ORDER BY c.id LIMIT greatest(1,least(p_limit,4))) j;
$$;

CREATE TABLE case_runtime_private.dispatch_config(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),url text NOT NULL,secret_id uuid NOT NULL,encryption_secret_id uuid NOT NULL);
REVOKE ALL ON case_runtime_private.dispatch_config FROM PUBLIC,anon,authenticated;
GRANT ALL ON case_runtime_private.dispatch_config TO service_role;
CREATE FUNCTION public.case_configure_dispatch(p_url text,p_secret text,p_encryption_secret text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;eid uuid;
BEGIN
 IF p_url !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/case-invitation-dispatch$' OR length(p_secret)<32 OR length(p_encryption_secret)<32 THEN RAISE EXCEPTION 'CASE_DISPATCH_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('case_dispatch_configuration'));
 SELECT secret_id,encryption_secret_id INTO sid,eid FROM case_runtime_private.dispatch_config WHERE singleton;
 IF sid IS NULL THEN sid:=vault.create_secret(p_secret,'case_dispatch_auth');eid:=vault.create_secret(p_encryption_secret,'case_invitation_encryption');
 ELSE PERFORM vault.update_secret(sid,p_secret);PERFORM vault.update_secret(eid,p_encryption_secret);END IF;
 INSERT INTO case_runtime_private.dispatch_config VALUES(true,p_url,sid,eid) ON CONFLICT(singleton) DO UPDATE SET url=excluded.url,secret_id=excluded.secret_id,encryption_secret_id=excluded.encryption_secret_id;
END;$$;
CREATE FUNCTION public.case_dispatch_secrets() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('auth',s.decrypted_secret,'encryption',e.decrypted_secret) FROM case_runtime_private.dispatch_config c JOIN vault.decrypted_secrets s ON s.id=c.secret_id JOIN vault.decrypted_secrets e ON e.id=c.encryption_secret_id WHERE c.singleton;
$$;
CREATE FUNCTION case_runtime_private.dispatch_due_invitations() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg record;stamp text:=floor(extract(epoch FROM now()))::bigint::text;
BEGIN
 IF public.case_dispatch_due(1)='[]'::jsonb THEN RETURN;END IF;
 SELECT c.url,s.decrypted_secret INTO cfg FROM case_runtime_private.dispatch_config c JOIN vault.decrypted_secrets s ON s.id=c.secret_id WHERE c.singleton;
 IF cfg.url IS NOT NULL THEN PERFORM net.http_post(url:=cfg.url,headers:=jsonb_build_object('Content-Type','application/json','x-docubox-cron-timestamp',stamp,'x-docubox-cron-signature',encode(extensions.hmac(stamp,cfg.decrypted_secret,'sha256'),'hex')),body:='{}'::jsonb,timeout_milliseconds:=10000);END IF;
END;$$;
SELECT cron.schedule('case-invitation-dispatch','* * * * *','SELECT case_runtime_private.dispatch_due_invitations();');

REVOKE ALL ON FUNCTION public.case_launch_configured(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb,jsonb,text,jsonb),public.case_invitation_code_claim(uuid,uuid),public.case_invitation_code_payload(uuid,uuid,text),public.case_invitation_code_finish(uuid,uuid,text,text,text),public.case_invitation_manage(uuid,uuid,uuid,text,uuid,jsonb),public.case_dispatch_due(integer),public.case_configure_dispatch(text,text,text),public.case_dispatch_secrets(),case_runtime_private.dispatch_due_invitations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_launch_configured(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb,jsonb,text,jsonb),public.case_invitation_code_claim(uuid,uuid),public.case_invitation_code_payload(uuid,uuid,text),public.case_invitation_code_finish(uuid,uuid,text,text,text),public.case_invitation_manage(uuid,uuid,uuid,text,uuid,jsonb),public.case_dispatch_due(integer),public.case_configure_dispatch(text,text,text),public.case_dispatch_secrets() TO service_role;

CREATE TABLE public.case_invitation_access_grants (
 invitation_id uuid NOT NULL REFERENCES public.case_participant_invitations(id),user_id uuid NOT NULL REFERENCES auth.users(id),
 code_verified boolean NOT NULL DEFAULT false,liveness_session_id uuid REFERENCES public.mobile_upload_sessions(id),
 liveness_verified_at timestamptz,expires_at timestamptz NOT NULL,PRIMARY KEY(invitation_id,user_id)
);
CREATE INDEX case_invitation_access_user ON public.case_invitation_access_grants(user_id);
CREATE INDEX case_invitation_access_session ON public.case_invitation_access_grants(liveness_session_id);
ALTER TABLE public.case_invitation_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_invitation_access_grants FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_invitation_access_grants TO service_role;
CREATE FUNCTION public.case_portal_authorize_actor(p_hash text,p_actor uuid,p_code_hash text DEFAULT NULL,p_capture_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb;i public.case_participant_invitations;cfg public.case_launches;person public.case_file_participants;actor auth.users;g public.case_invitation_access_grants;capture public.mobile_upload_sessions;code_ok boolean;live_at timestamptz;capture_id uuid;
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
  live_at:=now();capture_id:=capture.id;
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
REVOKE ALL ON FUNCTION public.case_portal_authorize_actor(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_portal_authorize_actor(text,uuid,text,text) TO service_role;

CREATE FUNCTION public.case_cancel_scheduled_launch(p_case uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files;cfg public.case_launches;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO cfg FROM public.case_launches WHERE case_file_id=p_case;
 IF cfg.case_file_id IS NULL OR cfg.scheduled_at IS NULL THEN RAISE EXCEPTION 'CASE_SCHEDULE_CANCEL_DENIED';END IF;
 IF c.status='cancelled' THEN RETURN jsonb_build_object('id',p_case,'cancelled',true);END IF;
 IF cfg.scheduled_at<=now() OR c.status='sealed' OR EXISTS(SELECT 1 FROM public.case_participant_invitations WHERE case_file_id=p_case AND first_attempt_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.case_file_documents WHERE case_file_id=p_case) OR EXISTS(SELECT 1 FROM public.case_file_form_submissions WHERE case_file_id=p_case) THEN RAISE EXCEPTION 'CASE_SCHEDULE_CANCEL_DENIED';END IF;
 UPDATE public.case_participant_invitations SET revoked_at=coalesce(revoked_at,now()) WHERE case_file_id=p_case;
 UPDATE public.case_files SET status='cancelled',updated_at=now(),version=version+1 WHERE id=p_case;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata) VALUES(c.workspace_id,p_case,p_actor,'Responsable del expediente','case_launch:cancelled','case',p_case::text,encode(extensions.digest(p_case::text||'cancel-scheduled','sha256'),'hex'),jsonb_build_object('scheduled_at',cfg.scheduled_at));
 RETURN jsonb_build_object('id',p_case,'cancelled',true);
END;$$;
REVOKE ALL ON FUNCTION public.case_cancel_scheduled_launch(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_cancel_scheduled_launch(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.case_portal_context(p_hash text,p_write boolean DEFAULT false) RETURNS jsonb
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
 IF i.not_before>now() THEN RAISE EXCEPTION 'CASE_INVITATION_NOT_ACTIVE';END IF;
 IF p_write AND (c.status='sealed' OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,c.owner_user_id,'member')) THEN RAISE EXCEPTION 'CASE_TERMINAL';END IF;
 RETURN jsonb_build_object('invitation',to_jsonb(i),'case',to_jsonb(c),'participant',to_jsonb(p));
END;$$;


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
  VALUES(ft.id,ctx#>>'{invitation,recipient}',ctx#>>'{participant,name}',(ctx#>>'{participant,user_id}')::uuid,'private',(ctx#>>'{invitation,expires_at}')::timestamptz,coalesce((SELECT signature_type FROM public.case_launches WHERE case_file_id=f.case_file_id),ft.allowed_signature_types[1],'autografa_digital'),false,(ctx#>>'{case,owner_user_id}')::uuid,ctx#>>'{invitation,sender_name}',false) RETURNING * INTO t;
  INSERT INTO public.case_portal_form_tokens(token_id,invitation_id,case_form_id) VALUES(t.id,(ctx#>>'{invitation,id}')::uuid,f.id);
 END IF;
 RETURN jsonb_build_object('token',t.token);
END;$$;
