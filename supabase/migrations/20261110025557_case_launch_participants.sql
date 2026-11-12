-- Atomic launch: retains the canonical subject and review/closure controls.
-- Additional people are agenda references, never automatic members or signers.
-- Narrow service-only canonical email lookup, without granting access to auth.users.
CREATE OR REPLACE FUNCTION public.case_launch_member_email(p_workspace uuid,p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT lower(coalesce(u.email,'')) FROM auth.users u WHERE u.id=p_user AND EXISTS(
  SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace AND m.user_id=u.id
   AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())
 );
$$;
REVOKE ALL ON FUNCTION public.case_launch_member_email(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_launch_member_email(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.case_control_launch(
 p_template uuid,p_actor uuid,p_title text,p_subject_name text,p_subject_user uuid,
 p_assignments jsonb,p_operation uuid,p_subject_email text DEFAULT '',p_participants jsonb DEFAULT '[]'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 t public.case_file_templates; c public.case_files; snapshot jsonb; person jsonb;
 selected_user uuid; selected_name text; selected_email text; selected_role text;
 subject_email text:=lower(btrim(coalesce(p_subject_email,'')));
 normalized jsonb:='[]'; emails text[]:='{}'; users uuid[]:='{}';
 fingerprint text; receipt jsonb; previous_hash text; result jsonb; separate boolean;
BEGIN
 IF p_operation IS NULL OR p_actor IS NULL OR p_template IS NULL OR
  nullif(btrim(p_title),'') IS NULL OR length(btrim(p_title))>240 OR
  nullif(btrim(p_subject_name),'') IS NULL OR length(btrim(p_subject_name))>240 OR
  jsonb_typeof(p_assignments) IS DISTINCT FROM 'object' OR
  jsonb_typeof(p_participants) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID';
 END IF;
 IF jsonb_array_length(p_participants)>20 THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END IF;
 SELECT * INTO t FROM public.case_file_templates WHERE id=p_template FOR SHARE;
 IF t.id IS NULL OR NOT public.case_actor_eligible(t.workspace_id,p_actor,p_actor,'member') THEN
  RAISE EXCEPTION 'CASE_TEMPLATE_DENIED' USING ERRCODE='42501';
 END IF;
 IF p_subject_user IS NOT NULL THEN
  IF NOT public.case_actor_eligible(t.workspace_id,p_actor,p_subject_user,'member') THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END IF;
  subject_email:=public.case_launch_member_email(t.workspace_id,p_subject_user);
  users:=array_append(users,p_subject_user);
 END IF;
 IF length(subject_email)>254 OR (p_subject_user IS NULL AND subject_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') OR
  (subject_email<>'' AND subject_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END IF;
 IF subject_email<>'' THEN emails:=array_append(emails,subject_email); END IF;
 FOR person IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
  IF jsonb_typeof(person) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END IF;
  selected_name:=btrim(coalesce(person->>'name',''));
  selected_email:=lower(btrim(coalesce(person->>'email','')));
  selected_role:=person->>'role'; selected_user:=null;
  IF nullif(person->>'userId','') IS NOT NULL THEN
   BEGIN selected_user:=(person->>'userId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END;
   IF NOT public.case_actor_eligible(t.workspace_id,p_actor,selected_user,'member') THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END IF;
   selected_email:=public.case_launch_member_email(t.workspace_id,selected_user);
  END IF;
  IF selected_name='' OR length(selected_name)>240 OR length(selected_email)>254 OR
   selected_role IS NULL OR selected_role NOT IN ('representative','contact') OR
   (selected_user IS NULL AND selected_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') OR
   (selected_email<>'' AND selected_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'CASE_PARTICIPANT_INVALID'; END IF;
  IF (selected_email<>'' AND selected_email=ANY(emails)) OR selected_user=ANY(users) THEN RAISE EXCEPTION 'CASE_PARTICIPANT_DUPLICATE'; END IF;
  IF selected_email<>'' THEN emails:=array_append(emails,selected_email); END IF;
  IF selected_user IS NOT NULL THEN users:=array_append(users,selected_user); END IF;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('name',selected_name,'email',selected_email,'userId',selected_user,'role',selected_role));
 END LOOP;
 fingerprint:=encode(extensions.digest(jsonb_build_object('template',p_template,'actor',p_actor,'title',btrim(p_title),'subject',btrim(p_subject_name),'user',p_subject_user,'email',subject_email,'assignments',p_assignments,'participants',normalized)::text,'sha256'),'hex');
 -- Serialize retries before case_control_start so concurrent requests cannot duplicate people.
 PERFORM pg_advisory_xact_lock(hashtextextended('case-launch:'||p_operation::text,0));
 SELECT * INTO c FROM public.case_files WHERE id=p_operation FOR UPDATE;
 IF c.id IS NOT NULL THEN
  SELECT metadata INTO receipt FROM public.case_file_audit_events WHERE case_file_id=c.id AND action='case_runtime:launch' AND metadata->>'launch_operation'=p_operation::text;
  IF c.workspace_id<>t.workspace_id OR c.created_by<>p_actor OR receipt->>'launch_hash' IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('id',c.id);
 END IF;
 IF t.status<>'active' THEN RAISE EXCEPTION 'CASE_TEMPLATE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT v.snapshot INTO snapshot FROM public.case_file_template_versions v WHERE v.template_id=t.id AND v.version=t.publication_version;
 SELECT coalesce((organization_settings#>>'{case_review,separationOfDuties}')::boolean,false) INTO separate FROM public.workspaces WHERE id=t.workspace_id;
 IF separate AND (snapshot#>>'{requirements_schema,reviewPolicy,approval,enabled}')::boolean AND (
  p_assignments->>'approver'=p_actor::text OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(snapshot#>'{requirements_schema,sections}') s
   CROSS JOIN LATERAL jsonb_array_elements(s->'items') item
   WHERE (item->>'requiresReview')::boolean AND p_assignments#>>ARRAY['reviewers',item->>'id']=p_assignments->>'approver'
  )) THEN RAISE EXCEPTION 'CASE_SEPARATION_OF_DUTIES' USING ERRCODE='42501'; END IF;
 result:=public.case_control_start(p_template,p_actor,btrim(p_title),btrim(p_subject_name),p_subject_user,p_assignments,p_operation,subject_email);
 FOR person IN SELECT * FROM jsonb_array_elements(normalized) LOOP
  INSERT INTO public.case_file_participants(workspace_id,case_file_id,user_id,name,email,participant_type,role,status,metadata)
  VALUES(t.workspace_id,p_operation,(person->>'userId')::uuid,person->>'name',nullif(person->>'email',''),person->>'role',person->>'role',
   CASE WHEN person->>'userId' IS NULL THEN 'pending' ELSE 'active' END,jsonb_build_object('source','launch','workspace_access_granted',false));
 END LOOP;
 SELECT event_hash INTO previous_hash FROM public.case_file_audit_events WHERE case_file_id=p_operation ORDER BY occurred_at DESC,id DESC LIMIT 1;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,previous_hash,event_hash,metadata)
 VALUES(t.workspace_id,p_operation,p_actor,'Usuario autorizado','case_runtime:launch','case_file',p_operation::text,previous_hash,
  encode(extensions.digest(coalesce(previous_hash,'')||p_operation::text||fingerprint,'sha256'),'hex'),
  jsonb_build_object('launch_operation',p_operation,'launch_hash',fingerprint,'additional_participant_count',jsonb_array_length(normalized)));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_launch(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_launch(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb) TO service_role;
