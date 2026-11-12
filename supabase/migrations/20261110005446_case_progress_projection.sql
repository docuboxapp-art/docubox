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
  IF previous->>'operation_hash' IS DISTINCT FROM op_hash THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN previous->'result';
 END IF;
 IF c.status IN ('sealed','cancelled') THEN
  IF p_command='refresh' THEN RETURN jsonb_build_object('id',c.id,'status',c.status,'version',c.version); END IF;
  RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
 snap:=public.case_control_snapshot(c.id,p_actor_id,true);
 IF snap->>'revision'<>p_revision THEN RAISE EXCEPTION 'CASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_evaluation->'conditions') IS DISTINCT FROM 'array' OR jsonb_array_length(p_evaluation->'conditions')=0 THEN RAISE EXCEPTION 'CASE_EVALUATION_REQUIRED'; END IF;
 IF p_command<>'stage' THEN
  UPDATE public.case_file_milestones m SET status=x->>'status',completed_at=CASE WHEN x->>'status'='completed' THEN coalesce(m.completed_at,now()) ELSE NULL END
   FROM jsonb_array_elements(coalesce(p_evaluation->'stageStatuses','[]')) x WHERE m.case_file_id=c.id AND m.completion_condition_json->>'id'=x->>'id' AND coalesce((x->>'manual')::boolean,false)=false AND m.status IS DISTINCT FROM x->>'status';
 END IF;
 item_id:=p_payload->>'itemId'; decision:=p_payload->>'decision';
 IF p_command='review' THEN
  SELECT * INTO requirement FROM public.case_file_requirements WHERE case_file_id=c.id AND settings->>'id'=item_id;
  SELECT * INTO form_row FROM public.case_file_forms WHERE case_file_id=c.id AND template_item_id=item_id;
  actor:=coalesce(requirement.reviewer_user_id,form_row.reviewer_user_id);
  selected_role:=coalesce(requirement.settings->>'reviewerRole',form_row.settings->>'reviewerRole');
  IF actor IS DISTINCT FROM p_actor_id OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,selected_role) THEN RAISE EXCEPTION 'CASE_REVIEW_DENIED' USING ERRCODE='42501'; END IF;
  IF coalesce(decision,'') NOT IN ('accepted','observed','rejected') OR NOT (p_evaluation->'reviewableIds' ? item_id) THEN RAISE EXCEPTION 'CASE_REVIEW_NOT_READY'; END IF;
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
  IF coalesce(decision,'') NOT IN ('approved','corrections','rejected') THEN RAISE EXCEPTION 'CASE_DECISION_INVALID'; END IF;
  IF decision='approved' AND NOT coalesce((p_evaluation->>'canApprove')::boolean,false) THEN RAISE EXCEPTION 'CASE_APPROVAL_NOT_READY'; END IF;
  IF decision<>'approved' AND length(btrim(coalesce(p_payload->>'reason','')))=0 THEN RAISE EXCEPTION 'CASE_REASON_REQUIRED'; END IF;
  IF decision='corrections' AND jsonb_array_length(coalesce(p_payload->'itemIds','[]'))=0 THEN RAISE EXCEPTION 'CASE_CORRECTION_ITEMS_REQUIRED'; END IF;
  IF decision='corrections' THEN
   INSERT INTO public.case_file_observations(workspace_id,case_file_id,reason_code,message,correction_action,created_by,template_item_id)
    SELECT c.workspace_id,c.id,'approval',left(p_payload->>'reason',2000),'Atender la corrección y volver a revisar la evidencia.',p_actor_id,value FROM jsonb_array_elements_text(p_payload->'itemIds');
  END IF;
  UPDATE public.case_files SET review_approval=jsonb_build_object('decision',decision,'actorId',p_actor_id,'snapshotId',p_payload->>'snapshotId','reason',p_payload->>'reason','itemIds',p_payload->'itemIds','at',now()),
    status=CASE decision WHEN 'approved' THEN 'in_review' ELSE 'observed' END,version=version+1,updated_at=now() WHERE id=c.id;
 ELSIF p_command='stage' THEN
  SELECT completion_condition_json->>'coordinatorRole' INTO selected_role FROM public.case_file_milestones WHERE case_file_id=c.id AND completion_condition_json->>'id'=p_payload->>'stageId';
  IF NOT (p_evaluation->'readyStageIds' ? (p_payload->>'stageId')) OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,selected_role) THEN RAISE EXCEPTION 'CASE_STAGE_NOT_READY' USING ERRCODE='42501'; END IF;
  UPDATE public.case_file_milestones SET status='completed',completed_at=now() WHERE case_file_id=c.id AND completion_condition_json->>'id'=p_payload->>'stageId';
  UPDATE public.case_files SET version=version+1,updated_at=now() WHERE id=c.id;
 ELSIF p_command IN ('close','refresh','signatures') THEN
  IF p_command='signatures' AND NOT coalesce((p_evaluation->>'canSign')::boolean,false) THEN RAISE EXCEPTION 'CASE_SIGNATURE_NOT_READY'; END IF;
  IF p_command='close' AND (NOT coalesce((p_evaluation->>'eligible')::boolean,false) OR c.runtime_assignments->>'closer' IS DISTINCT FROM p_actor_id::text OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor_id,snap#>>'{template,requirements_schema,reviewPolicy,completion,role}')) THEN RAISE EXCEPTION 'CASE_CLOSURE_NOT_ALLOWED'; END IF;
  IF p_command='close' OR (p_command='refresh' AND coalesce((p_evaluation->>'eligible')::boolean,false) AND snap#>>'{template,requirements_schema,reviewPolicy,completion,mode}'='automatic') THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_evaluation->'conditions') condition WHERE coalesce(condition->>'status','') NOT IN ('satisfied','not_applicable')) THEN RAISE EXCEPTION 'CASE_CLOSURE_PENDING'; END IF;
   UPDATE public.case_file_tasks SET status='completed' WHERE case_file_id=c.id AND title='case_runtime:refresh' AND status='pending';
   UPDATE public.case_file_milestones SET status='completed',completed_at=coalesce(completed_at,now()) WHERE case_file_id=c.id AND related_objects->'activities' @> '[{"kind":"close"}]'::jsonb;
   root:=encode(extensions.digest(jsonb_build_object('sources',snap,'evaluation',p_evaluation,'closedBy',p_actor_id)::text,'sha256'),'hex');
   INSERT INTO public.case_file_closure_manifests(workspace_id,case_file_id,manifest_json,root_hash,system_version,created_by)
    VALUES(c.workspace_id,c.id,jsonb_build_object('sources',snap,'evaluation',p_evaluation,'closedBy',p_actor_id),root,'case-review-v1',p_actor_id) RETURNING id INTO manifest;
   UPDATE public.case_files SET status='sealed',closure_status='sealed',closed_at=now(),closed_by=p_actor_id,root_hash=root,manifest_id=manifest,
    sealed_snapshot=jsonb_build_object('snapshot',snap,'evaluation',p_evaluation),version=version+1,updated_at=now(),progress=100 WHERE id=c.id;
  ELSE
   target_status:=CASE WHEN (p_evaluation->>'eligible')::boolean THEN 'ready_to_close' WHEN (p_evaluation->>'canSign')::boolean THEN CASE WHEN coalesce((p_evaluation->>'signingStarted')::boolean,false) THEN 'signing' ELSE 'ready_to_sign' END ELSE coalesce(p_evaluation->>'operationalStatus','integrating') END;
   IF target_status NOT IN ('ready_to_close','ready_to_sign','in_review','observed','integrating','signing') THEN RAISE EXCEPTION 'CASE_STATUS_INVALID'; END IF;
   UPDATE public.case_files SET status=target_status,progress=least(99,greatest(0,coalesce((p_evaluation->>'progress')::integer,0))),closure_status=CASE WHEN (p_evaluation->>'eligible')::boolean THEN 'eligible' ELSE 'pending' END,version=version+1,updated_at=now() WHERE id=c.id;
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
