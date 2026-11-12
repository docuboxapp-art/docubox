ALTER TABLE public.case_launches ADD COLUMN subject_prefill jsonb NOT NULL DEFAULT '{}'::jsonb;
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
 INSERT INTO public.case_launches(case_file_id,workspace_id,created_by,access_mode,signature_type,require_liveness,expiration_hours,scheduled_at,timezone,request_hash,subject_prefill)
 SELECT c.id,c.workspace_id,p_actor,mode,method,mode='public' OR (p_settings->>'requireLiveness')::boolean,hours,scheduled,p_settings->>'timezone',fingerprint,coalesce(p_settings->'subjectPrefill','{}'::jsonb) FROM public.case_files c WHERE c.id=p_operation;
 IF EXISTS(SELECT 1 FROM public.case_file_forms f LEFT JOIN public.form_templates t ON t.id=f.form_template_id WHERE f.case_file_id=p_operation AND (t.id IS NULL OR t.status<>'published' OR t.version_number::text IS DISTINCT FROM f.settings->>'sourceVersion' OR t.revision_number::text IS DISTINCT FROM f.settings->>'sourceRevision')) THEN RAISE EXCEPTION 'CASE_FORM_REVISION_CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM public.case_file_requirements r LEFT JOIN public.plantillas t ON t.id=(r.settings->>'sourceId')::uuid WHERE r.case_file_id=p_operation AND r.settings->>'kind'='document_template' AND (t.id IS NULL OR t.estado<>'published' OR t.version_publicada::text IS DISTINCT FROM r.settings->>'sourceVersion' OR (t.requires_efirma AND method<>'efirma_sat'))) THEN RAISE EXCEPTION 'CASE_SIGNATURE_METHOD_UNAVAILABLE';END IF;
 -- A linked form must support the method selected for this launch.
 IF EXISTS(SELECT 1 FROM public.case_file_forms f JOIN public.form_templates t ON t.id=f.form_template_id WHERE f.case_file_id=p_operation AND (f.requires_signature OR t.requires_signature) AND NOT method=ANY(t.allowed_signature_types)) THEN RAISE EXCEPTION 'CASE_SIGNATURE_METHOD_UNAVAILABLE';END IF;
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
  INSERT INTO public.form_tokens(template_id,recipient_email,recipient_name,recipient_user_id,access_mode,expires_at,signature_type,require_liveness,launched_by_user_id,launcher_name,launch_prefill,sent_to_self)
  VALUES(ft.id,ctx#>>'{invitation,recipient}',ctx#>>'{participant,name}',(ctx#>>'{participant,user_id}')::uuid,'private',(ctx#>>'{invitation,expires_at}')::timestamptz,coalesce((SELECT signature_type FROM public.case_launches WHERE case_file_id=f.case_file_id),ft.allowed_signature_types[1],'autografa_digital'),false,(ctx#>>'{case,owner_user_id}')::uuid,ctx#>>'{invitation,sender_name}',coalesce((SELECT subject_prefill FROM public.case_launches WHERE case_file_id=f.case_file_id),'{}'::jsonb),false) RETURNING * INTO t;
  INSERT INTO public.case_portal_form_tokens(token_id,invitation_id,case_form_id) VALUES(t.id,(ctx#>>'{invitation,id}')::uuid,f.id);
 END IF;
 RETURN jsonb_build_object('token',t.token);
END;$$;

CREATE FUNCTION case_runtime_private.case_launch_document_signing_default() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person public.case_file_participants;cfg public.case_launches;needed boolean;
BEGIN
 SELECT p.* INTO person FROM public.case_file_participants p JOIN public.case_participant_invitations i ON i.participant_id=p.id JOIN public.case_portal_uploads u ON u.invitation_id=i.id WHERE u.document_id=NEW.id LIMIT 1;
 IF person.id IS NULL THEN RETURN NEW;END IF;
 SELECT l.* INTO cfg FROM public.case_launches l JOIN public.case_participant_invitations i ON i.case_file_id=l.case_file_id JOIN public.case_portal_uploads u ON u.invitation_id=i.id WHERE u.document_id=NEW.id;
 SELECT r.requires_signature INTO needed FROM public.case_file_requirements r JOIN public.case_portal_uploads u ON u.requirement_id=r.id WHERE u.document_id=NEW.id;
 IF cfg.case_file_id IS NULL OR NOT coalesce(needed,false) OR NEW.workspace_id<>cfg.workspace_id THEN RETURN NEW;END IF;
 NEW.participantes:=jsonb_build_array(jsonb_build_object('id',person.id,'user_id',person.user_id,'name',person.name,'email',person.email,'role','firmante','acto','Firmante','rolDocumento','Firmante','tipoFirma',jsonb_build_array(CASE cfg.signature_type WHEN 'click_sign' THEN 'click_sign' WHEN 'efirma_sat' THEN 'efirma' ELSE 'autografa' END),'tipoNotificacion',jsonb_build_array('correo'),'configured',true,'visible',true,'delivery_mode','remote','routing_mode','immediate'));
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION case_runtime_private.case_launch_document_signing_default() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER case_launch_document_defaults BEFORE INSERT ON public.documentos FOR EACH ROW EXECUTE FUNCTION case_runtime_private.case_launch_document_signing_default();

CREATE FUNCTION case_runtime_private.case_launch_signature_method_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cfg record;person jsonb;types jsonb;expected text;
BEGIN
 IF NEW.action_type<>'signature' OR NEW.status NOT IN ('claimed','committed') OR (TG_OP='UPDATE' AND OLD.status='committed') THEN RETURN NEW;END IF;
 FOR cfg IN SELECT l.signature_type,p.user_id,p.email,d.participantes FROM public.case_file_documents b JOIN public.case_file_requirements r ON r.id=b.requirement_id JOIN public.case_files c ON c.id=b.case_file_id JOIN public.case_launches l ON l.case_file_id=c.id JOIN public.case_file_participants p ON p.id=c.runtime_subject_id JOIN public.documentos d ON d.id=b.source_document_id WHERE b.source_document_id=NEW.document_id AND r.requires_signature LOOP
  expected:=CASE cfg.signature_type WHEN 'click_sign' THEN 'click_sign' WHEN 'efirma_sat' THEN 'efirma' ELSE 'autografa' END;
  SELECT value INTO person FROM jsonb_array_elements(coalesce(cfg.participantes,'[]')) WHERE (cfg.user_id IS NOT NULL AND value->>'user_id'=cfg.user_id::text) OR lower(value->>'email')=lower(cfg.email) LIMIT 1;
  types:=coalesce(person->'signature_types',person->'signatureTypes',person->'tipoFirma');
  IF jsonb_typeof(types) IS DISTINCT FROM 'array' OR jsonb_array_length(types)<>1 OR types->>0 NOT IN (expected,cfg.signature_type) THEN RAISE EXCEPTION 'CASE_SIGNATURE_METHOD_UNAVAILABLE';END IF;
 END LOOP;RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION case_runtime_private.case_launch_signature_method_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER case_launch_signature_policy BEFORE INSERT OR UPDATE ON public.participant_completion_attempts FOR EACH ROW EXECUTE FUNCTION case_runtime_private.case_launch_signature_method_guard();

CREATE UNIQUE INDEX case_portal_upload_document ON public.case_portal_uploads(document_id);
CREATE UNIQUE INDEX case_portal_upload_version ON public.case_portal_uploads(version_id);
