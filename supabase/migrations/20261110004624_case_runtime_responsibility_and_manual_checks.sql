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
 IF p_action IN ('assign','applicability','metadata') AND p_actor<>c.owner_user_id AND NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'admin') THEN RAISE EXCEPTION 'CASE_ASSIGNMENT_DENIED' USING ERRCODE='42501'; END IF;
 IF p_action='metadata' THEN
  IF length(btrim(coalesce(p_input->>'title','')))=0 THEN RAISE EXCEPTION 'CASE_TITLE_REQUIRED'; END IF;
  UPDATE public.case_files SET title=left(btrim(p_input->>'title'),240),description=left(coalesce(p_input->>'description',''),5000),target_close_at=nullif(p_input->>'targetCloseAt','')::timestamptz WHERE id=c.id;
 ELSIF p_action='assign' THEN
  kind:=p_input->>'kind'; target:=(p_input->>'userId')::uuid;
  IF kind='owner' THEN selected_role:='member'; UPDATE public.case_files SET owner_user_id=target WHERE id=c.id;
  ELSIF kind='reviewer' THEN
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
  ELSIF check_row.method IN ('representative','tax','custom') THEN
   SELECT * INTO doc FROM public.case_file_documents WHERE id=(p_input->>'sourceId')::uuid AND case_file_id=c.id;
   SELECT reviewer_user_id INTO reviewer FROM public.case_file_requirements WHERE id=doc.requirement_id;
   SELECT * INTO accepted FROM public.case_file_reviews WHERE case_file_id=c.id AND document_id=doc.id AND decision='accepted' AND reviewer_user_id=reviewer ORDER BY created_at DESC LIMIT 1;
   IF doc.id IS NULL OR accepted.id IS NULL OR reviewer IS DISTINCT FROM p_actor OR accepted.comparison_result->>'version' IS DISTINCT FROM doc.validation_result->>'sourceVersionId' OR accepted.comparison_result->>'evidenceHash' IS DISTINCT FROM doc.sha256_hash OR length(coalesce(doc.sha256_hash,''))<>64 THEN RAISE EXCEPTION 'CASE_VERIFICATION_REVIEW_REQUIRED'; END IF;
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
