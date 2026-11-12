-- Invitation outbox is separate from identity-verification challenges.
CREATE TABLE public.case_participant_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
 participant_id uuid NOT NULL REFERENCES public.case_file_participants(id) ON DELETE CASCADE,
 generation integer NOT NULL DEFAULT 1, operation_key uuid UNIQUE,
 recipient text NOT NULL, recipient_name text NOT NULL, participant_role text NOT NULL,
 case_title text NOT NULL, folio text NOT NULL, sender_name text NOT NULL, app_origin text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'), token_ciphertext text NOT NULL,
 payload_ciphertext text, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 delivery_status text NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sending','retrying','failed','sent','attention')),
 attempt_count integer NOT NULL DEFAULT 0, first_attempt_at timestamptz, claim_id uuid, claim_expires_at timestamptz,
 provider_message_id text, last_code text, sent_at timestamptz, revoked_at timestamptz,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_file_id,participant_id,generation)
);
CREATE INDEX case_participant_invites_workspace ON public.case_participant_invitations(workspace_id);
CREATE INDEX case_participant_invites_participant ON public.case_participant_invitations(participant_id);
CREATE INDEX case_participant_invites_creator ON public.case_participant_invitations(created_by);
CREATE INDEX case_participant_invites_pending ON public.case_participant_invitations(case_file_id,delivery_status) WHERE revoked_at IS NULL;
ALTER TABLE public.case_participant_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_participant_invitations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.case_participant_invitations TO service_role;
CREATE TRIGGER case_runtime_authorized_write BEFORE INSERT OR UPDATE OR DELETE ON public.case_participant_invitations
 FOR EACH ROW EXECUTE FUNCTION public.case_runtime_write_guard();

CREATE FUNCTION public.case_invitation_authorize(p_case uuid,p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.case_files c WHERE c.id=p_case AND
  public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'member') AND
  (c.owner_user_id=p_actor OR public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'admin')));
$$;

CREATE FUNCTION public.case_launch_invited(p_template uuid,p_actor uuid,p_title text,p_subject_name text,p_subject_user uuid,
 p_assignments jsonb,p_operation uuid,p_subject_email text,p_participants jsonb,p_deliveries jsonb,p_origin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; c public.case_files; person public.case_file_participants; credential jsonb; ordinal integer:=0; sender text;
BEGIN
 IF jsonb_typeof(p_deliveries) IS DISTINCT FROM 'array' OR p_origin !~ '^https?://[^/[:space:]]+$' OR length(p_origin)>250 THEN RAISE EXCEPTION 'CASE_INVITATION_INVALID'; END IF;
 result:=public.case_control_launch(p_template,p_actor,p_title,p_subject_name,p_subject_user,p_assignments,p_operation,p_subject_email,p_participants);
 SELECT * INTO c FROM public.case_files WHERE id=p_operation FOR UPDATE;
 IF NOT public.case_invitation_authorize(c.id,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(nullif(full_name,''),'Responsable del expediente') INTO sender FROM public.user_profiles WHERE id=p_actor;
 FOR person IN SELECT * FROM public.case_file_participants WHERE case_file_id=c.id AND workspace_id=c.workspace_id ORDER BY id LOOP
  IF EXISTS(SELECT 1 FROM public.case_participant_invitations WHERE case_file_id=c.id AND participant_id=person.id AND generation=1) THEN CONTINUE; END IF;
  IF c.status IN ('sealed','cancelled') THEN RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
  IF coalesce(person.email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN RAISE EXCEPTION 'CASE_EMAIL_REQUIRED'; END IF;
  credential:=p_deliveries->ordinal; ordinal:=ordinal+1;
  IF coalesce(credential->>'hash','') !~ '^[a-f0-9]{64}$' OR length(coalesce(credential->>'ciphertext',''))<80 THEN RAISE EXCEPTION 'CASE_INVITATION_INVALID'; END IF;
  INSERT INTO public.case_participant_invitations(workspace_id,case_file_id,participant_id,recipient,recipient_name,participant_role,case_title,folio,sender_name,app_origin,token_hash,token_ciphertext,created_by)
  VALUES(c.workspace_id,c.id,person.id,person.email,person.name,person.role,c.title,c.folio,coalesce(sender,'Responsable del expediente'),p_origin,credential->>'hash',credential->>'ciphertext',p_actor);
 END LOOP;
 RETURN result;
END;
$$;

CREATE FUNCTION public.case_invitation_claim(p_case uuid,p_actor uuid)
RETURNS SETOF public.case_participant_invitations LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 IF c.status IN ('sealed','cancelled') THEN RETURN; END IF;
 -- Provider deduplication lasts 24h. Stop ambiguous retries before that protection expires.
 UPDATE public.case_participant_invitations SET delivery_status='attention',last_code='RETRY_WINDOW_EXPIRED',claim_id=null,claim_expires_at=null
 WHERE case_file_id=p_case AND revoked_at IS NULL AND delivery_status<>'sent' AND first_attempt_at<now()-interval '23 hours';
 RETURN QUERY UPDATE public.case_participant_invitations i SET delivery_status='sending',claim_id=gen_random_uuid(),claim_expires_at=now()+interval '110 seconds',attempt_count=attempt_count+1,first_attempt_at=coalesce(first_attempt_at,now())
 WHERE i.id IN (SELECT id FROM public.case_participant_invitations WHERE case_file_id=p_case AND revoked_at IS NULL AND expires_at>now() AND attempt_count<8
  AND (delivery_status IN ('pending','retrying','failed') OR (delivery_status='sending' AND claim_expires_at<now()))
  ORDER BY created_at,id LIMIT 21 FOR UPDATE SKIP LOCKED) RETURNING i.*;
END;
$$;

CREATE FUNCTION public.case_invitation_payload(p_id uuid,p_claim uuid,p_ciphertext text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE saved text; target uuid;
BEGIN
 SELECT case_file_id INTO target FROM public.case_participant_invitations WHERE id=p_id;
 PERFORM 1 FROM public.case_files WHERE id=target FOR UPDATE;
 UPDATE public.case_participant_invitations SET payload_ciphertext=coalesce(payload_ciphertext,p_ciphertext)
 WHERE id=p_id AND claim_id=p_claim AND claim_expires_at>now() AND delivery_status='sending' AND revoked_at IS NULL RETURNING payload_ciphertext INTO saved;
 IF saved IS NULL THEN RAISE EXCEPTION 'CASE_INVITATION_CLAIM_EXPIRED'; END IF;
 RETURN saved;
END;
$$;

CREATE FUNCTION public.case_invitation_finish(p_id uuid,p_claim uuid,p_status text,p_provider text DEFAULT NULL,p_code text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.case_participant_invitations; n integer; previous text;
BEGIN
 IF p_status NOT IN ('sent','failed','retrying','pending') OR (p_status='sent' AND coalesce(p_provider,'')='') THEN RAISE EXCEPTION 'CASE_INVITATION_INVALID'; END IF;
 SELECT * INTO i FROM public.case_participant_invitations WHERE id=p_id;
 PERFORM 1 FROM public.case_files WHERE id=i.case_file_id FOR UPDATE;
 UPDATE public.case_participant_invitations SET delivery_status=p_status,provider_message_id=CASE WHEN p_status='sent' THEN left(p_provider,128) ELSE provider_message_id END,
  sent_at=CASE WHEN p_status='sent' THEN now() ELSE sent_at END,last_code=left(regexp_replace(coalesce(p_code,''),'[^A-Z0-9_]','','g'),64),claim_id=null,claim_expires_at=null
 WHERE id=p_id AND claim_id=p_claim AND delivery_status='sending';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n>0 THEN
  SELECT event_hash INTO previous FROM public.case_file_audit_events WHERE case_file_id=i.case_file_id ORDER BY occurred_at DESC,id DESC LIMIT 1;
  INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,previous_hash,event_hash,metadata)
  VALUES(i.workspace_id,i.case_file_id,i.created_by,'Docubox','case_invitation:'||p_status,'case_invitation',p_id::text,previous,encode(extensions.digest(coalesce(previous,'')||p_id::text||p_claim::text||p_status,'sha256'),'hex'),jsonb_build_object('code',left(regexp_replace(coalesce(p_code,''),'[^A-Z0-9_]','','g'),64)));
 END IF;
 RETURN n>0;
END;
$$;

CREATE FUNCTION public.case_invitation_summary(p_case uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',recipient_name,'email',recipient,'role',participant_role,'status',CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at<=now() THEN 'expired' WHEN attempt_count>=8 AND delivery_status<>'sent' THEN 'attention' ELSE delivery_status END,'sentAt',sent_at,'expiresAt',expires_at) ORDER BY recipient_name),'[]') INTO result
 FROM (SELECT DISTINCT ON(participant_id) * FROM public.case_participant_invitations WHERE case_file_id=p_case ORDER BY participant_id,generation DESC) latest;
 RETURN result;
END;
$$;

CREATE FUNCTION public.case_invitation_manage(p_case uuid,p_actor uuid,p_id uuid,p_action text,p_operation uuid,p_credential jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.case_participant_invitations; found_id uuid; next_generation integer;
BEGIN
 PERFORM 1 FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF NOT public.case_invitation_authorize(p_case,p_actor) THEN RAISE EXCEPTION 'CASE_INVITATION_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO i FROM public.case_participant_invitations WHERE id=p_id AND case_file_id=p_case;
 IF i.id IS NULL OR p_operation IS NULL THEN RAISE EXCEPTION 'CASE_INVITATION_INVALID'; END IF;
 IF p_action='revoke' THEN UPDATE public.case_participant_invitations SET revoked_at=coalesce(revoked_at,now()) WHERE case_file_id=p_case AND participant_id=i.participant_id; RETURN i.id; END IF;
 IF p_action<>'renew' OR coalesce(p_credential->>'hash','')!~'^[a-f0-9]{64}$' OR length(coalesce(p_credential->>'ciphertext',''))<80 THEN RAISE EXCEPTION 'CASE_INVITATION_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM public.case_files WHERE id=p_case AND status IN ('sealed','cancelled')) THEN RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
 SELECT id INTO found_id FROM public.case_participant_invitations WHERE operation_key=p_operation AND case_file_id=p_case AND participant_id=i.participant_id;
 IF found_id IS NOT NULL THEN RETURN found_id; END IF;
 SELECT max(generation)+1 INTO next_generation FROM public.case_participant_invitations WHERE case_file_id=p_case AND participant_id=i.participant_id;
 UPDATE public.case_participant_invitations SET revoked_at=coalesce(revoked_at,now()) WHERE case_file_id=p_case AND participant_id=i.participant_id;
 INSERT INTO public.case_participant_invitations(workspace_id,case_file_id,participant_id,generation,operation_key,recipient,recipient_name,participant_role,case_title,folio,sender_name,app_origin,token_hash,token_ciphertext,created_by)
 VALUES(i.workspace_id,p_case,i.participant_id,next_generation,p_operation,i.recipient,i.recipient_name,i.participant_role,i.case_title,i.folio,i.sender_name,i.app_origin,p_credential->>'hash',p_credential->>'ciphertext',p_actor) RETURNING id INTO found_id;
 RETURN found_id;
END;
$$;

CREATE FUNCTION public.case_invitation_portal(p_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE i public.case_participant_invitations; c public.case_files; person public.case_file_participants;
BEGIN
 IF p_hash !~ '^[a-f0-9]{64}$' THEN RETURN null; END IF;
 SELECT * INTO i FROM public.case_participant_invitations WHERE token_hash=p_hash AND revoked_at IS NULL AND expires_at>now();
 IF i.id IS NULL THEN RETURN null; END IF;
 SELECT * INTO c FROM public.case_files WHERE id=i.case_file_id AND workspace_id=i.workspace_id AND status<>'cancelled';
 SELECT * INTO person FROM public.case_file_participants WHERE id=i.participant_id AND case_file_id=c.id AND workspace_id=c.workspace_id AND status NOT IN ('revoked','cancelled');
 IF c.id IS NULL OR person.id IS NULL THEN RETURN null; END IF;
 RETURN jsonb_build_object('title',c.title,'folio',c.folio,'status',c.status,'progress',c.progress,'sender',i.sender_name,'participantName',person.name,'role',person.role,'expiresAt',i.expires_at,
 'requirements',CASE WHEN person.id=c.runtime_subject_id THEN coalesce((SELECT jsonb_agg(jsonb_build_object('title',title,'description',description,'required',is_required,'status',status) ORDER BY sort_order,id) FROM public.case_file_requirements WHERE case_file_id=c.id),'[]') ELSE '[]' END,
 'forms',coalesce((SELECT jsonb_agg(jsonb_build_object('title',title,'required',is_required,'status',status) ORDER BY id) FROM public.case_file_forms WHERE case_file_id=c.id AND participant_id=person.id),'[]'));
END;
$$;

REVOKE ALL ON FUNCTION public.case_invitation_authorize(uuid,uuid),public.case_launch_invited(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb,jsonb,text),public.case_invitation_claim(uuid,uuid),public.case_invitation_payload(uuid,uuid,text),public.case_invitation_finish(uuid,uuid,text,text,text),public.case_invitation_summary(uuid,uuid),public.case_invitation_manage(uuid,uuid,uuid,text,uuid,jsonb),public.case_invitation_portal(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_invitation_authorize(uuid,uuid),public.case_launch_invited(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb,jsonb,text),public.case_invitation_claim(uuid,uuid),public.case_invitation_payload(uuid,uuid,text),public.case_invitation_finish(uuid,uuid,text,text,text),public.case_invitation_summary(uuid,uuid),public.case_invitation_manage(uuid,uuid,uuid,text,uuid,jsonb),public.case_invitation_portal(text) TO service_role;
