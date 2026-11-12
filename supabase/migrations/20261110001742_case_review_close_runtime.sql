-- Runtime writes are server operations, not arbitrary authenticated Data API writes.
-- The server validates the user's session; every RPC repeats workspace/actor checks.
ALTER TABLE public.case_files ADD COLUMN runtime_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.case_files ADD COLUMN runtime_subject_id uuid REFERENCES public.case_file_participants(id);
ALTER TABLE public.case_files ADD COLUMN runtime_assignments jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.case_files ADD COLUMN review_approval jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.case_file_forms ADD COLUMN template_item_id text;
ALTER TABLE public.case_file_forms ADD COLUMN reviewer_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.case_file_forms ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.case_file_identity_checks ADD COLUMN template_verification_id text;
ALTER TABLE public.case_file_observations ADD COLUMN template_item_id text;
CREATE UNIQUE INDEX case_runtime_operation_once ON public.case_file_audit_events
  (case_file_id,(metadata->>'operation_key')) WHERE metadata ? 'operation_key';
CREATE INDEX case_runtime_source_document ON public.case_file_documents(source_document_id,case_file_id);
CREATE UNIQUE INDEX case_runtime_requirement_ref ON public.case_file_requirements(case_file_id,(settings->>'id')) WHERE settings ? 'id';
CREATE UNIQUE INDEX case_runtime_form_ref ON public.case_file_forms(case_file_id,template_item_id) WHERE template_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.case_actor_eligible(p_workspace uuid,p_owner uuid,p_actor uuid,p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=p_workspace
   AND m.user_id=p_actor AND m.status='active' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())
   AND CASE p_role WHEN 'owner' THEN p_actor=p_owner WHEN 'admin' THEN m.role IN ('owner','admin') WHEN 'member' THEN true ELSE false END);
$$;
REVOKE ALL ON FUNCTION public.case_actor_eligible(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_actor_eligible(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.case_control_snapshot(p_case_id uuid,p_actor_id uuid,p_lock boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE c public.case_files; result jsonb; document_ids uuid[]; response_ids uuid[];
BEGIN
 IF p_lock THEN SELECT * INTO c FROM public.case_files WHERE id=p_case_id FOR UPDATE;
 ELSE SELECT * INTO c FROM public.case_files WHERE id=p_case_id; END IF;
 IF c.id IS NULL OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,'member') THEN
  RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF c.runtime_version<>1 THEN RAISE EXCEPTION 'CASE_RUNTIME_VERSION_UNSUPPORTED'; END IF;
 SELECT array_agg(DISTINCT source_document_id) INTO document_ids FROM public.case_file_documents WHERE case_file_id=c.id AND workspace_id=c.workspace_id;
 SELECT array_agg(DISTINCT form_response_id) INTO response_ids FROM public.case_file_form_submissions WHERE case_file_id=c.id AND workspace_id=c.workspace_id;
 SELECT coalesce(document_ids,'{}'::uuid[])||coalesce(array_agg(document_id),'{}'::uuid[]) INTO document_ids
   FROM public.form_responses WHERE id=ANY(coalesce(response_ids,'{}'::uuid[])) AND workspace_id=c.workspace_id;
 IF p_lock THEN
  PERFORM 1 FROM public.workspace_members WHERE workspace_id=c.workspace_id FOR SHARE;
  PERFORM 1 FROM public.workspaces WHERE id=c.workspace_id FOR SHARE;
  PERFORM 1 FROM public.documentos WHERE id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.document_versions WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.form_responses WHERE id=ANY(coalesce(response_ids,'{}'::uuid[])) FOR SHARE;
  PERFORM 1 FROM public.participant_completion_attempts WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.signature_evidence WHERE document_id=ANY(document_ids) FOR SHARE;
 END IF;
 result:=jsonb_build_object(
  'case',to_jsonb(c),
  'template',(SELECT snapshot FROM public.case_file_template_versions WHERE id=c.template_version_id AND workspace_id=c.workspace_id),
  'members',coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',user_id,'role',role,'status',status,'access_expires_at',access_expires_at) ORDER BY user_id) FROM public.workspace_members WHERE workspace_id=c.workspace_id),'[]'),
  'organization',coalesce((SELECT jsonb_build_object('type',workspace_type,'security',security_settings,'review',organization_settings->'case_review') FROM public.workspaces WHERE id=c.workspace_id),'{}'),
  'participants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'name',name,'role',role) ORDER BY id) FROM public.case_file_participants WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'requirements',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_requirements x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'documents',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_documents x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'document_versions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_document_versions x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'reviews',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY created_at,id) FROM public.case_file_reviews x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'forms',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_forms x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'submissions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_form_submissions x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'checks',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_identity_checks x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'verification_sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'status',status,'face_match_passed',face_match_passed,'created_at',created_at,'updated_at',updated_at) ORDER BY id) FROM public.enrollment_results WHERE id::text IN (SELECT result#>>'{proof,sourceId}' FROM public.case_file_identity_checks WHERE case_file_id=c.id AND workspace_id=c.workspace_id)),'[]'),
  'observations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_observations x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'milestones',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY sort_order,id) FROM public.case_file_milestones x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'workspace_id',workspace_id,'owner_id',owner_id,'nombre',nombre,'estado',estado,'file_hash_sha256',file_hash_sha256,'storage_path',storage_path,'file_url',file_url,'file_name',file_name,'file_size',file_size,'file_type',file_type,'source_template_id',source_template_id,'participantes',participantes,'deleted_at',deleted_at,'fecha_vencimiento',fecha_vencimiento) ORDER BY id) FROM public.documentos WHERE id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'source_versions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.document_versions x WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'responses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'template_id',template_id,'document_id',document_id,'respondent_user_id',respondent_user_id,'pdf_output_hash',pdf_output_hash,'submitted_at',submitted_at,'status',status,'form_schema_hash',form_schema_hash) ORDER BY id) FROM public.form_responses WHERE id=ANY(coalesce(response_ids,'{}'::uuid[])) AND workspace_id=c.workspace_id),'[]'),
  'completions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'document_version_id',document_version_id,'participant_reference_id',participant_reference_id,'actor_user_id',actor_user_id,'action_type',action_type,'status',status,'signature_evidence_id',signature_evidence_id,'committed_at',committed_at) ORDER BY id) FROM public.participant_completion_attempts WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signature_evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'document_version_id',document_version_id,'participant_record_id',participant_record_id,'captured_by',captured_by,'is_voided',is_voided,'document_sha256',document_sha256,'combined_sha256',combined_sha256,'signature_hash',signature_hash,'signed_payload_sha256',signed_payload_sha256,'signature_id',signature_id) ORDER BY id) FROM public.signature_evidence WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'references',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'participant_json_id',participant_json_id,'participant_user_id',participant_user_id,'snapshot',snapshot,'active',active) ORDER BY id) FROM public.document_participant_references WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'));
 RETURN result || jsonb_build_object('revision',encode(extensions.digest(result::text,'sha256'),'hex'));
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_snapshot(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_snapshot(uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.case_runtime_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target uuid; c public.case_files;
BEGIN
 IF TG_TABLE_NAME='case_files' THEN
  IF TG_OP='DELETE' THEN c:=OLD; ELSE c:=NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.runtime_version=1 AND NEW.runtime_version<>1 THEN RAISE EXCEPTION 'CASE_RUNTIME_IMMUTABLE'; END IF;
 ELSE
  IF TG_OP='DELETE' THEN target:=OLD.case_file_id; ELSE target:=NEW.case_file_id; END IF;
  SELECT * INTO c FROM public.case_files WHERE id=target FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.case_file_id<>OLD.case_file_id OR NEW.workspace_id<>OLD.workspace_id) THEN RAISE EXCEPTION 'CASE_SCOPE_IMMUTABLE'; END IF;
  IF TG_OP<>'DELETE' AND NEW.workspace_id<>c.workspace_id THEN RAISE EXCEPTION 'CASE_SCOPE_MISMATCH'; END IF;
 END IF;
 IF c.runtime_version=1 AND current_user NOT IN ('service_role','postgres','supabase_admin') THEN
   RAISE EXCEPTION 'CASE_SERVER_OPERATION_REQUIRED' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.case_runtime_write_guard() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE relation_name text; BEGIN
 FOREACH relation_name IN ARRAY ARRAY['case_files','case_file_participants','case_file_requirements','case_file_documents','case_file_document_versions','case_file_forms','case_file_form_submissions','case_file_identity_checks','case_file_milestones','case_file_reviews','case_file_observations','case_file_signatures','case_file_closure_manifests','case_file_audit_events','case_file_tasks','case_file_invitations','case_file_closure_certificates','case_file_shares'] LOOP
  EXECUTE format('CREATE TRIGGER case_runtime_authorized_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.case_runtime_write_guard()',relation_name);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.case_control_apply(p_case_id uuid,p_actor_id uuid,p_revision text,p_command text,p_operation_key uuid,p_evaluation jsonb,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files; snap jsonb; previous jsonb; result jsonb; decision text; requirement public.case_file_requirements;
 form_row public.case_file_forms; subject uuid; selected_role text; actor uuid; item_id text; target_status text;
 op_hash text; previous_hash text; root text; manifest uuid;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case_id FOR UPDATE;
 IF c.id IS NULL OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,'member') THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 op_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor_id,'command',p_command,'payload',p_payload)::text,'sha256'),'hex');
 SELECT metadata INTO previous FROM public.case_file_audit_events WHERE case_file_id=c.id AND metadata->>'operation_key'=p_operation_key::text;
 IF previous IS NOT NULL THEN
  IF previous->>'operation_hash'<>op_hash THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN previous->'result';
 END IF;
 IF c.status IN ('sealed','cancelled') THEN
  IF p_command='refresh' THEN RETURN jsonb_build_object('id',c.id,'status',c.status,'version',c.version); END IF;
  RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
 snap:=public.case_control_snapshot(c.id,p_actor_id,true);
 IF snap->>'revision'<>p_revision THEN RAISE EXCEPTION 'CASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_evaluation->'conditions')<>'array' OR jsonb_array_length(p_evaluation->'conditions')=0 THEN RAISE EXCEPTION 'CASE_EVALUATION_REQUIRED'; END IF;
 item_id:=p_payload->>'itemId'; decision:=p_payload->>'decision';
 IF p_command='review' THEN
  SELECT * INTO requirement FROM public.case_file_requirements WHERE case_file_id=c.id AND settings->>'id'=item_id;
  SELECT * INTO form_row FROM public.case_file_forms WHERE case_file_id=c.id AND template_item_id=item_id;
  actor:=coalesce(requirement.reviewer_user_id,form_row.reviewer_user_id);
  selected_role:=coalesce(requirement.settings->>'reviewerRole',form_row.settings->>'reviewerRole');
  IF actor IS DISTINCT FROM p_actor_id OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,selected_role) THEN RAISE EXCEPTION 'CASE_REVIEW_DENIED' USING ERRCODE='42501'; END IF;
  IF decision NOT IN ('accepted','observed','rejected') OR NOT (p_evaluation->'reviewableIds' ? item_id) THEN RAISE EXCEPTION 'CASE_REVIEW_NOT_READY'; END IF;
  IF decision<>'accepted' AND length(btrim(coalesce(p_payload->>'reason','')))=0 THEN RAISE EXCEPTION 'CASE_REASON_REQUIRED'; END IF;
  INSERT INTO public.case_file_reviews(workspace_id,case_file_id,document_id,form_submission_id,reviewer_user_id,decision,internal_comment,comparison_result)
   VALUES(c.workspace_id,c.id,(p_payload->>'documentId')::uuid,(p_payload->>'submissionId')::uuid,p_actor_id,decision,p_payload->>'reason',
    jsonb_build_object('itemId',item_id,'subjectId',c.runtime_subject_id,'version',p_payload->>'evidenceVersion','evidenceHash',p_payload->>'evidenceHash'));
  IF requirement.id IS NOT NULL THEN UPDATE public.case_file_requirements SET status=CASE decision WHEN 'accepted' THEN 'approved' ELSE 'observed' END WHERE id=requirement.id; END IF;
  UPDATE public.case_file_observations SET status='resolved',resolved_at=now() WHERE case_file_id=c.id AND template_item_id=item_id AND status IN ('open','corrected');
  IF decision<>'accepted' THEN INSERT INTO public.case_file_observations(workspace_id,case_file_id,document_id,form_submission_id,reason_code,message,correction_action,created_by,template_item_id)
    VALUES(c.workspace_id,c.id,(p_payload->>'documentId')::uuid,(p_payload->>'submissionId')::uuid,'review',p_payload->>'reason','Presentar una nueva versión para revisión.',p_actor_id,item_id); END IF;
  UPDATE public.case_files SET review_approval='{}',status=CASE decision WHEN 'accepted' THEN 'in_review' ELSE 'observed' END,version=version+1,updated_at=now() WHERE id=c.id;
 ELSIF p_command='approval' THEN
  selected_role:=snap#>>'{template,requirements_schema,reviewPolicy,approval,role}';
  IF c.runtime_assignments->>'approver' IS DISTINCT FROM p_actor_id::text OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,selected_role) THEN RAISE EXCEPTION 'CASE_APPROVAL_DENIED' USING ERRCODE='42501'; END IF;
  IF (snap#>>'{organization,review,separationOfDuties}')::boolean IS TRUE AND (p_actor_id=c.owner_user_id OR EXISTS(SELECT 1 FROM public.case_file_reviews WHERE case_file_id=c.id AND reviewer_user_id=p_actor_id)) THEN RAISE EXCEPTION 'CASE_SEPARATION_OF_DUTIES' USING ERRCODE='42501'; END IF;
  IF decision NOT IN ('approved','corrections','rejected') THEN RAISE EXCEPTION 'CASE_DECISION_INVALID'; END IF;
  IF decision='approved' AND NOT coalesce((p_evaluation->>'canApprove')::boolean,false) THEN RAISE EXCEPTION 'CASE_APPROVAL_NOT_READY'; END IF;
  IF decision<>'approved' AND length(btrim(coalesce(p_payload->>'reason','')))=0 THEN RAISE EXCEPTION 'CASE_REASON_REQUIRED'; END IF;
  IF decision='corrections' AND jsonb_array_length(coalesce(p_payload->'itemIds','[]'))=0 THEN RAISE EXCEPTION 'CASE_CORRECTION_ITEMS_REQUIRED'; END IF;
  UPDATE public.case_files SET review_approval=jsonb_build_object('decision',decision,'actorId',p_actor_id,'snapshotId',p_payload->>'snapshotId','reason',p_payload->>'reason','itemIds',p_payload->'itemIds','at',now()),
    status=CASE decision WHEN 'approved' THEN 'in_review' ELSE 'observed' END,version=version+1,updated_at=now() WHERE id=c.id;
 ELSIF p_command IN ('close','refresh','signatures') THEN
  IF p_command='signatures' AND NOT coalesce((p_evaluation->>'canSign')::boolean,false) THEN RAISE EXCEPTION 'CASE_SIGNATURE_NOT_READY'; END IF;
  IF p_command='close' AND (NOT coalesce((p_evaluation->>'eligible')::boolean,false) OR c.runtime_assignments->>'closer' IS DISTINCT FROM p_actor_id::text OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,snap#>>'{template,requirements_schema,reviewPolicy,completion,role}')) THEN RAISE EXCEPTION 'CASE_CLOSURE_NOT_ALLOWED'; END IF;
  IF p_command='close' OR (p_command='refresh' AND coalesce((p_evaluation->>'eligible')::boolean,false) AND snap#>>'{template,requirements_schema,reviewPolicy,completion,mode}'='automatic') THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_evaluation->'conditions') condition WHERE condition->>'status' NOT IN ('satisfied','not_applicable')) THEN RAISE EXCEPTION 'CASE_CLOSURE_PENDING'; END IF;
   root:=encode(extensions.digest(jsonb_build_object('sources',snap,'evaluation',p_evaluation,'closedBy',p_actor_id)::text,'sha256'),'hex');
   INSERT INTO public.case_file_closure_manifests(workspace_id,case_file_id,manifest_json,root_hash,system_version,created_by)
    VALUES(c.workspace_id,c.id,jsonb_build_object('snapshot',snap,'conditions',p_evaluation->'conditions'),root,'case-review-v1',p_actor_id) RETURNING id INTO manifest;
   UPDATE public.case_files SET status='sealed',closure_status='sealed',closed_at=now(),closed_by=p_actor_id,root_hash=root,manifest_id=manifest,
    sealed_snapshot=jsonb_build_object('snapshot',snap,'evaluation',p_evaluation),version=version+1,updated_at=now(),progress=100 WHERE id=c.id;
  ELSE
   target_status:=CASE WHEN (p_evaluation->>'eligible')::boolean THEN 'ready_to_close' WHEN (p_evaluation->>'canSign')::boolean THEN 'ready_to_sign' ELSE coalesce(p_evaluation->>'operationalStatus','integrating') END;
   IF target_status NOT IN ('ready_to_close','ready_to_sign','in_review','observed','integrating','signing') THEN RAISE EXCEPTION 'CASE_STATUS_INVALID'; END IF;
   UPDATE public.case_files SET status=target_status,closure_status=CASE WHEN (p_evaluation->>'eligible')::boolean THEN 'eligible' ELSE 'pending' END,version=version+1,updated_at=now() WHERE id=c.id;
  END IF;
 ELSE RAISE EXCEPTION 'CASE_COMMAND_INVALID'; END IF;
 SELECT jsonb_build_object('id',id,'status',status,'version',version,'manifestId',manifest_id) INTO result FROM public.case_files WHERE id=c.id;
 SELECT event_hash INTO previous_hash FROM public.case_file_audit_events WHERE case_file_id=c.id ORDER BY occurred_at DESC,id DESC LIMIT 1;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,previous_hash,event_hash,metadata)
 VALUES(c.workspace_id,c.id,p_actor_id,'Usuario autorizado','case_runtime:'||p_command,'case_file',c.id::text,previous_hash,
 encode(extensions.digest(coalesce(previous_hash,'')||p_operation_key::text||op_hash||result::text,'sha256'),'hex'),
 jsonb_build_object('operation_key',p_operation_key,'operation_hash',op_hash,'result',result,'revision',p_revision,'conditions',p_evaluation->'conditions'));
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_apply(uuid,uuid,text,text,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_apply(uuid,uuid,text,text,uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.case_control_start(p_template uuid,p_actor uuid,p_title text,p_subject_name text,p_subject_user uuid,p_assignments jsonb,p_operation uuid,p_subject_email text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t public.case_file_templates; snapshot jsonb; c uuid; subject uuid; section jsonb; item jsonb; check_item jsonb; stage jsonb; reviewer uuid; role_key text; chosen uuid; ordinal integer:=0;
BEGIN
 SELECT * INTO t FROM public.case_file_templates WHERE id=p_template FOR SHARE;
 IF t.id IS NULL OR t.status<>'active' OR NOT public.case_actor_eligible(t.workspace_id,p_actor,p_actor,'member') THEN RAISE EXCEPTION 'CASE_TEMPLATE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_subject_user IS NOT NULL AND NOT public.case_actor_eligible(t.workspace_id,p_actor,p_subject_user,'member') THEN RAISE EXCEPTION 'CASE_EXTERNAL_SUBJECT_REQUIRES_INVITATION'; END IF;
 SELECT v.snapshot INTO snapshot FROM public.case_file_template_versions v WHERE v.template_id=t.id AND v.version=t.publication_version;
 IF snapshot#>>'{requirements_schema,reviewPolicy,version}' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'CASE_POLICY_REQUIRED'; END IF;
 -- Retry-safe creation; the instance UUID is a server-generated operation UUID.
 SELECT id INTO c FROM public.case_files WHERE id=p_operation AND workspace_id=t.workspace_id AND created_by=p_actor;
 IF c IS NOT NULL THEN RETURN jsonb_build_object('id',c); END IF;
 FOR role_key IN SELECT unnest(ARRAY['approver','closer']) LOOP
  chosen:=nullif(p_assignments->>role_key,'')::uuid;
  IF role_key='approver' AND NOT (snapshot#>>'{requirements_schema,reviewPolicy,approval,enabled}')::boolean THEN CONTINUE; END IF;
  IF role_key='closer' AND snapshot#>>'{requirements_schema,reviewPolicy,completion,mode}'='automatic' THEN CONTINUE; END IF;
  IF NOT public.case_actor_eligible(t.workspace_id,p_actor,chosen,CASE role_key WHEN 'approver' THEN snapshot#>>'{requirements_schema,reviewPolicy,approval,role}' ELSE snapshot#>>'{requirements_schema,reviewPolicy,completion,role}' END) THEN RAISE EXCEPTION 'CASE_ASSIGNEE_INVALID'; END IF;
 END LOOP;
 c:=p_operation;
 INSERT INTO public.case_files(id,workspace_id,template_id,owner_user_id,created_by,folio,title,case_type,case_subtype,description,subject_name,status,runtime_version,template_version_id,runtime_assignments)
 SELECT c,t.workspace_id,t.id,p_actor,p_actor,'EXP-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(c::text,'-',''),1,12)),coalesce(nullif(btrim(p_title),''),t.name),t.case_type,t.case_subtype,t.description,p_subject_name,'draft',1,v.id,p_assignments
 FROM public.case_file_template_versions v WHERE v.template_id=t.id AND v.version=t.publication_version;
 INSERT INTO public.case_file_participants(workspace_id,case_file_id,user_id,name,email,participant_type,role,status)
 VALUES(t.workspace_id,c,p_subject_user,p_subject_name,nullif(lower(btrim(p_subject_email)),''),'subject','subject','active') RETURNING id INTO subject;
 UPDATE public.case_files SET runtime_subject_id=subject WHERE id=c;
 FOR section IN SELECT * FROM jsonb_array_elements(snapshot#>'{requirements_schema,sections}') LOOP
  FOR item IN SELECT * FROM jsonb_array_elements(section->'items') LOOP
   reviewer:=nullif(p_assignments#>>ARRAY['reviewers',item->>'id'],'')::uuid;
   IF (item->>'requiresReview')::boolean AND NOT public.case_actor_eligible(t.workspace_id,p_actor,reviewer,item->>'reviewerRole') THEN RAISE EXCEPTION 'CASE_REVIEWER_REQUIRED'; END IF;
   ordinal:=ordinal+1;
   IF item->>'kind'='form' THEN
    INSERT INTO public.case_file_forms(workspace_id,case_file_id,form_template_id,participant_id,title,is_required,requires_signature,template_item_id,reviewer_user_id,settings)
      VALUES(t.workspace_id,c,(item->>'sourceId')::uuid,subject,item->>'title',(item->>'required')::boolean,coalesce((item->>'requiresSignature')::boolean,false),item->>'id',reviewer,item);
   ELSE
    INSERT INTO public.case_file_requirements(workspace_id,case_file_id,title,description,category,sort_order,is_required,requires_manual_review,requires_signature,reviewer_user_id,settings)
     VALUES(t.workspace_id,c,item->>'title',coalesce(item->>'description',''),CASE WHEN item->>'kind' IN ('document_template','new_document') THEN 'generated' ELSE 'attachment' END,ordinal,(item->>'required')::boolean,(item->>'requiresReview')::boolean,
       coalesce((item->>'requiresSignature')::boolean,false) OR EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot#>'{requirements_schema,stages}') st CROSS JOIN LATERAL jsonb_array_elements(st->'activities') work WHERE work->>'kind'='sign' AND work->>'refId'=item->>'id'),reviewer,item);
   END IF;
  END LOOP;
 END LOOP;
 FOR check_item IN SELECT * FROM jsonb_array_elements(snapshot#>'{requirements_schema,verifications}') LOOP
  INSERT INTO public.case_file_identity_checks(workspace_id,case_file_id,participant_id,method,template_verification_id,result)
   VALUES(t.workspace_id,c,subject,check_item->>'catalogKey',check_item->>'id',jsonb_build_object('definition',check_item));
 END LOOP;
 ordinal:=0;
 FOR stage IN SELECT * FROM jsonb_array_elements(snapshot#>'{requirements_schema,stages}') LOOP
  INSERT INTO public.case_file_milestones(workspace_id,case_file_id,title,description,sort_order,completion_condition_json,related_objects)
   VALUES(t.workspace_id,c,stage->>'title',coalesce(stage->>'description',''),ordinal,jsonb_build_object('id',stage->>'id','completionMode',stage->>'completionMode','dependsOn',stage->'dependsOn'),jsonb_build_object('activities',stage->'activities'));
  ordinal:=ordinal+1;
 END LOOP;
 UPDATE public.case_files SET status='integrating',opened_at=now() WHERE id=c;
 RETURN jsonb_build_object('id',c);
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_start(uuid,uuid,text,text,uuid,jsonb,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_start(uuid,uuid,text,text,uuid,jsonb,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.case_control_attach(p_case uuid,p_actor uuid,p_revision text,p_item text,p_source uuid,p_kind text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files; snap jsonb; requirement public.case_file_requirements; form_row public.case_file_forms; doc public.documentos; version public.document_versions; response public.form_responses; subject public.case_file_participants; binding uuid; n integer;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF c.id IS NULL OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'member') THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF c.status IN ('sealed','cancelled') THEN RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
 IF EXISTS(SELECT 1 FROM public.case_file_audit_events WHERE case_file_id=c.id AND metadata->>'operation_key'=p_operation::text) THEN RETURN jsonb_build_object('id',c.id); END IF;
 snap:=public.case_control_snapshot(c.id,p_actor,true);
 IF snap->>'revision'<>p_revision THEN RAISE EXCEPTION 'CASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO subject FROM public.case_file_participants WHERE id=c.runtime_subject_id;
 IF p_kind='document' THEN
  SELECT * INTO requirement FROM public.case_file_requirements WHERE case_file_id=c.id AND settings->>'id'=p_item FOR UPDATE;
  IF requirement.id IS NULL THEN RAISE EXCEPTION 'CASE_ITEM_INVALID'; END IF;
  SELECT * INTO doc FROM public.documentos WHERE id=p_source AND workspace_id=c.workspace_id AND deleted_at IS NULL FOR SHARE;
  IF doc.id IS NULL OR doc.estado IN ('cancelado','rechazado','vencido') OR (doc.owner_id<>p_actor AND NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'admin')) THEN RAISE EXCEPTION 'CASE_SOURCE_INVALID'; END IF;
  IF requirement.settings->>'kind'='document_template' AND doc.source_template_id::text IS DISTINCT FROM requirement.settings->>'sourceId' THEN RAISE EXCEPTION 'CASE_TEMPLATE_SOURCE_MISMATCH'; END IF;
  SELECT * INTO version FROM public.document_versions WHERE document_id=doc.id AND workspace_id=c.workspace_id ORDER BY version_number DESC LIMIT 1 FOR SHARE;
  IF version.id IS NULL OR length(coalesce(version.sha256,''))<>64 THEN RAISE EXCEPTION 'CASE_SOURCE_VERSION_REQUIRED'; END IF;
  SELECT id,current_version+1 INTO binding,n FROM public.case_file_documents WHERE requirement_id=requirement.id LIMIT 1 FOR UPDATE;
  IF binding IS NOT NULL AND EXISTS(SELECT 1 FROM public.participant_completion_attempts WHERE document_id IN (SELECT source_document_id FROM public.case_file_documents WHERE id=binding) AND status IN ('claimed','committed')) THEN RAISE EXCEPTION 'CASE_SIGNED_SOURCE_REPLACEMENT_REQUIRED'; END IF;
  IF binding IS NULL THEN
   INSERT INTO public.case_file_documents(workspace_id,case_file_id,requirement_id,source_document_id,document_name,storage_path,file_name,mime_type,file_size,sha256_hash,validation_result)
    VALUES(c.workspace_id,c.id,requirement.id,doc.id,doc.nombre,version.storage_path,doc.file_name,version.mime_type,version.byte_size,version.sha256,jsonb_build_object('sourceVersionId',version.id)) RETURNING id,current_version INTO binding,n;
  ELSE
   UPDATE public.case_file_documents SET source_document_id=doc.id,document_name=doc.nombre,storage_path=version.storage_path,file_name=doc.file_name,mime_type=version.mime_type,file_size=version.byte_size,sha256_hash=version.sha256,current_version=n,
    validation_result=jsonb_build_object('sourceVersionId',version.id),updated_at=now(),status='uploaded' WHERE id=binding;
  END IF;
  INSERT INTO public.case_file_document_versions(workspace_id,case_file_id,document_id,version,storage_path,file_name,mime_type,file_size,sha256_hash,uploaded_by)
   VALUES(c.workspace_id,c.id,binding,n,version.storage_path,doc.file_name,version.mime_type,version.byte_size,version.sha256,p_actor);
  UPDATE public.case_file_requirements SET status='uploaded' WHERE id=requirement.id;
 ELSIF p_kind='form' THEN
  SELECT * INTO form_row FROM public.case_file_forms WHERE case_file_id=c.id AND template_item_id=p_item FOR UPDATE;
  SELECT * INTO response FROM public.form_responses WHERE id=p_source AND workspace_id=c.workspace_id AND template_id=form_row.form_template_id FOR SHARE;
  IF subject.user_id IS NULL AND subject.email IS NOT NULL AND lower(response.respondent_email)=lower(subject.email) AND response.respondent_user_id IS NOT NULL THEN
   UPDATE public.case_file_participants SET user_id=response.respondent_user_id WHERE id=subject.id;
   subject.user_id:=response.respondent_user_id;
  END IF;
  IF form_row.id IS NULL OR response.id IS NULL OR response.submitted_at IS NULL OR response.respondent_user_id IS DISTINCT FROM subject.user_id OR subject.user_id IS NULL OR length(coalesce(response.pdf_output_hash,''))<>64 OR response.status NOT IN ('submitted','completed','signed','approved') THEN RAISE EXCEPTION 'CASE_FORM_RESPONSE_INVALID'; END IF;
  INSERT INTO public.case_file_form_submissions(workspace_id,case_file_id,case_form_id,form_response_id,generated_pdf_id,sha256_hash,status,submitted_at,snapshot)
   VALUES(c.workspace_id,c.id,form_row.id,response.id,response.generated_pdf_id,response.pdf_output_hash,'submitted',response.submitted_at,jsonb_build_object('sourceSchemaHash',response.form_schema_hash));
  UPDATE public.case_file_forms SET status='submitted' WHERE id=form_row.id;
 ELSE RAISE EXCEPTION 'CASE_SOURCE_KIND_INVALID'; END IF;
 UPDATE public.case_file_observations SET status='corrected' WHERE case_file_id=c.id AND template_item_id=p_item AND status='open';
 UPDATE public.case_files SET review_approval='{}',version=version+1,updated_at=now(),status='integrating' WHERE id=c.id;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata)
  VALUES(c.workspace_id,c.id,p_actor,'Usuario autorizado','case_runtime:attach',p_kind,p_item,encode(extensions.digest(p_operation::text||p_source::text,'sha256'),'hex'),jsonb_build_object('operation_key',p_operation,'sourceId',p_source,'itemId',p_item));
 RETURN jsonb_build_object('id',c.id);
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_attach(uuid,uuid,text,text,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_attach(uuid,uuid,text,text,uuid,text,uuid) TO service_role;

-- Only the session-validated backend may publish an executable version.
CREATE OR REPLACE FUNCTION public.case_review_publication_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'CASE_SCOPE_IMMUTABLE'; END IF;
  IF NEW.status=OLD.status AND ROW(NEW.name,NEW.description,NEW.requirements_schema,NEW.forms_schema,NEW.identity_schema,NEW.milestones_schema,NEW.closure_rules_schema,NEW.case_type,NEW.case_subtype)
   IS NOT DISTINCT FROM ROW(OLD.name,OLD.description,OLD.requirements_schema,OLD.forms_schema,OLD.identity_schema,OLD.milestones_schema,OLD.closure_rules_schema,OLD.case_type,OLD.case_subtype) THEN RETURN NEW; END IF;
 END IF;
 IF NEW.status<>'active' THEN RETURN NEW; END IF;
 IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN RAISE EXCEPTION 'CASE_PUBLICATION_REQUIRES_SERVER' USING ERRCODE='42501'; END IF;
 IF NEW.requirements_schema#>>'{reviewPolicy,version}' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'CASE_REVIEW_POLICY_INVALID'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_review_instance_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.runtime_version=1 AND current_user IN ('service_role','postgres','supabase_admin') THEN
  IF NEW.template_version_id IS NULL THEN RAISE EXCEPTION 'CASE_REVIEW_POLICY_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status NOT IN ('draft','cancelled') OR NEW.closed_at IS NOT NULL OR NEW.sealed_snapshot IS NOT NULL THEN RAISE EXCEPTION 'CASE_SERVER_OPERATION_REQUIRED'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_control_publish(p_id uuid,p_actor uuid,p_workspace uuid,p_expected timestamptz,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE existing public.case_file_templates; result jsonb;
BEGIN
 IF NOT public.case_actor_eligible(p_workspace,p_actor,p_actor,'member') THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.case_file_templates WHERE id=p_id FOR UPDATE;
 IF existing.id IS NOT NULL THEN
  IF existing.workspace_id<>p_workspace OR (existing.created_by<>p_actor AND NOT public.case_actor_eligible(p_workspace,existing.created_by,p_actor,'admin')) THEN RAISE EXCEPTION 'CASE_PUBLICATION_DENIED' USING ERRCODE='42501'; END IF;
  IF existing.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'CASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF existing.status='archived' THEN RAISE EXCEPTION 'CASE_ARCHIVED'; END IF;
  UPDATE public.case_file_templates SET name=p_payload->>'name',description=p_payload->>'description',case_type=p_payload->>'case_type',case_subtype=p_payload->>'case_subtype',requirements_schema=p_payload->'requirements_schema',forms_schema=p_payload->'forms_schema',status='active',editor_draft=NULL,updated_at=now() WHERE id=p_id;
 ELSE
  INSERT INTO public.case_file_templates(id,workspace_id,created_by,name,description,case_type,case_subtype,requirements_schema,forms_schema,status)
   VALUES(p_id,p_workspace,p_actor,p_payload->>'name',coalesce(p_payload->>'description',''),coalesce(p_payload->>'case_type','Sin especificar'),p_payload->>'case_subtype',p_payload->'requirements_schema',coalesce(p_payload->'forms_schema','[]'),'active');
 END IF;
 SELECT jsonb_build_object('id',id,'updated_at',updated_at,'publication_version',publication_version) INTO result FROM public.case_file_templates WHERE id=p_id;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_publish(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_publish(uuid,uuid,uuid,timestamptz,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.case_control_configure(p_case uuid,p_actor uuid,p_revision text,p_action text,p_input jsonb,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files; snap jsonb; subject public.case_file_participants; check_row public.case_file_identity_checks; proof public.enrollment_results;
 item jsonb; target uuid; reviewer uuid; selected_role text; kind text; doc public.case_file_documents; accepted public.case_file_reviews; proof_json jsonb; operation_hash text; previous jsonb;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF c.id IS NULL OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'member') THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 operation_hash:=encode(extensions.digest(jsonb_build_object('action',p_action,'input',p_input-'revision'-'operationKey','actor',p_actor)::text,'sha256'),'hex');
 SELECT metadata INTO previous FROM public.case_file_audit_events WHERE case_file_id=c.id AND metadata->>'operation_key'=p_operation::text;
 IF previous IS NOT NULL THEN IF previous->>'operation_hash' IS DISTINCT FROM operation_hash THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT'; END IF; RETURN jsonb_build_object('id',c.id); END IF;
 IF c.status IN ('sealed','cancelled') THEN RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
 snap:=public.case_control_snapshot(c.id,p_actor,true);
 IF snap->>'revision'<>p_revision THEN RAISE EXCEPTION 'CASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF p_action IN ('assign','applicability') AND p_actor<>c.owner_user_id AND NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'admin') THEN RAISE EXCEPTION 'CASE_ASSIGNMENT_DENIED' USING ERRCODE='42501'; END IF;
 IF p_action='assign' THEN
  kind:=p_input->>'kind'; target:=(p_input->>'userId')::uuid;
  IF kind='reviewer' THEN
   SELECT settings INTO item FROM public.case_file_requirements WHERE case_file_id=c.id AND settings->>'id'=p_input->>'itemId';
   IF item IS NULL THEN SELECT settings INTO item FROM public.case_file_forms WHERE case_file_id=c.id AND template_item_id=p_input->>'itemId'; END IF;
   selected_role:=item->>'reviewerRole';
  ELSIF kind='approver' THEN selected_role:=snap#>>'{template,requirements_schema,reviewPolicy,approval,role}';
  ELSIF kind='closer' THEN selected_role:=snap#>>'{template,requirements_schema,reviewPolicy,completion,role}';
  ELSE RAISE EXCEPTION 'CASE_ASSIGNMENT_INVALID'; END IF;
  IF NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,target,selected_role) THEN RAISE EXCEPTION 'CASE_ASSIGNEE_INVALID'; END IF;
  IF kind='reviewer' THEN
   UPDATE public.case_file_requirements SET reviewer_user_id=target WHERE case_file_id=c.id AND settings->>'id'=p_input->>'itemId';
   UPDATE public.case_file_forms SET reviewer_user_id=target WHERE case_file_id=c.id AND template_item_id=p_input->>'itemId';
  ELSE UPDATE public.case_files SET runtime_assignments=jsonb_set(runtime_assignments,ARRAY[kind],to_jsonb(target::text)) WHERE id=c.id; END IF;
 ELSIF p_action='applicability' THEN
  IF length(btrim(coalesce(p_input->>'reason','')))=0 OR jsonb_typeof(p_input->'applies')<>'boolean' THEN RAISE EXCEPTION 'CASE_REASON_REQUIRED'; END IF;
  SELECT settings INTO item FROM public.case_file_requirements WHERE case_file_id=c.id AND settings->>'id'=p_input->>'itemId';
  IF item IS NULL THEN SELECT settings INTO item FROM public.case_file_forms WHERE case_file_id=c.id AND template_item_id=p_input->>'itemId'; END IF;
  IF NOT coalesce((item->>'conditional')::boolean,false) THEN RAISE EXCEPTION 'CASE_APPLICABILITY_NOT_ALLOWED'; END IF;
  proof_json:=jsonb_build_object('resolved',true,'applies',(p_input->>'applies')::boolean,'ruleId',item->>'id','subjectId',c.runtime_subject_id,'actorId',p_actor,'reason',left(p_input->>'reason',2000));
  UPDATE public.case_file_requirements SET settings=jsonb_set(settings,'{applicability}',proof_json) WHERE case_file_id=c.id AND settings->>'id'=p_input->>'itemId';
  UPDATE public.case_file_forms SET settings=jsonb_set(settings,'{applicability}',proof_json) WHERE case_file_id=c.id AND template_item_id=p_input->>'itemId';
 ELSIF p_action='verify' THEN
  SELECT * INTO check_row FROM public.case_file_identity_checks WHERE case_file_id=c.id AND template_verification_id=p_input->>'itemId' FOR UPDATE;
  SELECT * INTO subject FROM public.case_file_participants WHERE id=c.runtime_subject_id;
  IF check_row.id IS NULL THEN RAISE EXCEPTION 'CASE_VERIFICATION_INVALID'; END IF;
  IF check_row.method IN ('official_id','selfie') THEN
   SELECT * INTO proof FROM public.enrollment_results WHERE id=(p_input->>'sourceId')::uuid AND user_id=subject.user_id AND status='completed' FOR SHARE;
   IF proof.id IS NULL OR (check_row.method='selfie' AND proof.face_match_passed IS DISTINCT FROM true) THEN RAISE EXCEPTION 'CASE_VERIFICATION_SOURCE_INVALID'; END IF;
   proof_json:=jsonb_build_object('type','enrollment','subjectUserId',subject.user_id,'sourceId',proof.id,'sourceUpdatedAt',proof.updated_at);
  ELSIF check_row.method IN ('representative','tax') THEN
   SELECT * INTO doc FROM public.case_file_documents WHERE id=(p_input->>'sourceId')::uuid AND case_file_id=c.id;
   SELECT reviewer_user_id INTO reviewer FROM public.case_file_requirements WHERE id=doc.requirement_id;
   SELECT * INTO accepted FROM public.case_file_reviews WHERE case_file_id=c.id AND document_id=doc.id AND decision='accepted' AND reviewer_user_id=reviewer ORDER BY created_at DESC LIMIT 1;
   IF doc.id IS NULL OR accepted.id IS NULL OR reviewer<>p_actor OR length(coalesce(doc.sha256_hash,''))<>64 THEN RAISE EXCEPTION 'CASE_VERIFICATION_REVIEW_REQUIRED'; END IF;
   proof_json:=jsonb_build_object('type','document_review','subjectId',c.runtime_subject_id,'sourceId',doc.id,'reviewId',accepted.id,'sourceHash',doc.sha256_hash);
  ELSE RAISE EXCEPTION 'CASE_VERIFICATION_SOURCE_UNAVAILABLE'; END IF;
  UPDATE public.case_file_identity_checks SET status='approved',verified_at=now(),reviewed_by=p_actor,result=result||jsonb_build_object('proof',proof_json),evidence_hash=encode(extensions.digest(proof_json::text,'sha256'),'hex') WHERE id=check_row.id;
 ELSE RAISE EXCEPTION 'CASE_COMMAND_INVALID'; END IF;
 UPDATE public.case_files SET review_approval='{}',version=version+1,updated_at=now() WHERE id=c.id;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata)
 VALUES(c.workspace_id,c.id,p_actor,'Usuario autorizado','case_runtime:'||p_action,'case_file',c.id::text,operation_hash,
  jsonb_build_object('operation_key',p_operation,'operation_hash',operation_hash,'itemId',p_input->>'itemId'));
 RETURN jsonb_build_object('id',c.id);
END;
$$;
REVOKE ALL ON FUNCTION public.case_control_configure(uuid,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.case_control_configure(uuid,uuid,text,text,jsonb,uuid) TO service_role;
