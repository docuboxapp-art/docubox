-- Public form receipts are scoped to the invited contact even without an account.
-- This proves the configured receipt binding; it does not assert verified identity.
CREATE OR REPLACE FUNCTION case_runtime_private.case_form_subject_matches(p_case uuid,p_response uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.case_files c JOIN public.case_file_participants p ON p.id=c.runtime_subject_id AND p.case_file_id=c.id
 JOIN public.form_responses r ON r.id=p_response AND r.workspace_id=c.workspace_id
 JOIN public.form_tokens t ON t.id=r.token_id AND t.template_id=r.template_id
 WHERE c.id=p_case AND c.runtime_version=1 AND (
  (p.user_id IS NOT NULL AND p.user_id=coalesce(r.respondent_user_id,case_runtime_private.resolve_case_subject(c.id,r.id)))
  OR (p.user_id IS NULL AND p.email IS NOT NULL AND lower(p.email)=lower(r.respondent_email) AND lower(t.recipient_email)=lower(p.email) AND t.access_mode='public' AND t.used_at IS NOT NULL)));
$$;
REVOKE ALL ON FUNCTION case_runtime_private.case_form_subject_matches(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION case_runtime_private.case_form_subject_matches(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.case_control_snapshot(p_case_id uuid,p_actor_id uuid,p_lock boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE c public.case_files; state_data jsonb; document_ids uuid[]; response_ids uuid[];
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
  PERFORM 1 FROM public.documentos WHERE id=ANY(document_ids) FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.document_versions WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.form_responses WHERE id=ANY(coalesce(response_ids,'{}'::uuid[])) FOR SHARE;
  PERFORM 1 FROM public.participant_completion_attempts WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.signature_evidence WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.document_participant_references WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.document_signing_groups WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.document_signing_group_members WHERE document_id=ANY(document_ids) FOR SHARE;
  PERFORM 1 FROM public.enrollment_results WHERE id::text IN (SELECT result#>>'{proof,sourceId}' FROM public.case_file_identity_checks WHERE case_file_id=c.id) FOR SHARE;
 END IF;
 state_data:=jsonb_build_object(
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
  'email_proofs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'subjectId',participant_id,'verified_at',otp_verified_at) ORDER BY id) FROM public.case_file_invitations WHERE case_file_id=c.id AND otp_verified_at IS NOT NULL AND revoked_at IS NULL),'[]'),
  'observations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.case_file_observations x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'milestones',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY sort_order,id) FROM public.case_file_milestones x WHERE case_file_id=c.id AND workspace_id=c.workspace_id),'[]'),
  'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'workspace_id',workspace_id,'owner_id',owner_id,'nombre',nombre,'estado',estado,'file_hash_sha256',file_hash_sha256,'storage_path',storage_path,'file_url',file_url,'file_name',file_name,'file_size',file_size,'file_type',file_type,'source_template_id',source_template_id,'participantes',participantes,'deleted_at',deleted_at,'fecha_vencimiento',fecha_vencimiento) ORDER BY id) FROM public.documentos WHERE id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'source_versions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.document_versions x WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'responses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'template_id',template_id,'document_id',document_id,'respondent_user_id',coalesce(respondent_user_id,case_runtime_private.resolve_case_subject(c.id,form_responses.id)),'subject_matched',case_runtime_private.case_form_subject_matches(c.id,form_responses.id),'pdf_output_hash',pdf_output_hash,'submitted_at',submitted_at,'status',status,'form_schema_hash',form_schema_hash) ORDER BY id) FROM public.form_responses WHERE id=ANY(coalesce(response_ids,'{}'::uuid[])) AND workspace_id=c.workspace_id),'[]'),
  'completions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'document_version_id',document_version_id,'participant_reference_id',participant_reference_id,'actor_user_id',actor_user_id,'effective_actor_user_id',effective_actor_user_id,'action_type',action_type,'status',status,'signature_evidence_id',signature_evidence_id,'committed_at',committed_at) ORDER BY id) FROM public.participant_completion_attempts WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signature_evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'document_version_id',document_version_id,'participant_record_id',participant_record_id,'captured_by',captured_by,'is_voided',is_voided,'document_sha256',document_sha256,'combined_sha256',combined_sha256,'signature_hash',signature_hash,'signed_payload_sha256',signed_payload_sha256,'signature_id',signature_id) ORDER BY id) FROM public.signature_evidence WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signing_groups',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.document_signing_groups g WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signing_members',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.document_signing_group_members g WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'references',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'participant_json_id',participant_json_id,'participant_user_id',participant_user_id,'snapshot',snapshot,'active',active) ORDER BY id) FROM public.document_participant_references WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'));
 RETURN state_data || jsonb_build_object('revision',encode(extensions.digest(state_data::text,'sha256'),'hex'));
END;
$$;
CREATE OR REPLACE FUNCTION public.case_control_attach(p_case uuid,p_actor uuid,p_revision text,p_item text,p_source uuid,p_kind text,p_operation uuid,p_issue_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files; snap jsonb; requirement public.case_file_requirements; form_row public.case_file_forms; doc public.documentos; version public.document_versions; response public.form_responses; subject public.case_file_participants; binding uuid; n integer; operation_hash text; previous jsonb;
BEGIN
 SELECT * INTO c FROM public.case_files WHERE id=p_case FOR UPDATE;
 IF c.id IS NULL OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,p_actor,'member') THEN RAISE EXCEPTION 'CASE_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 operation_hash:=encode(extensions.digest(jsonb_build_object('actor',p_actor,'item',p_item,'source',p_source,'kind',p_kind,'issueDate',p_issue_date)::text,'sha256'),'hex');
 SELECT metadata INTO previous FROM public.case_file_audit_events WHERE case_file_id=c.id AND metadata->>'operation_key'=p_operation::text;
 IF previous IS NOT NULL THEN IF previous->>'operation_hash' IS DISTINCT FROM operation_hash THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT'; END IF; RETURN jsonb_build_object('id',c.id); END IF;
 IF c.status IN ('sealed','cancelled') THEN RAISE EXCEPTION 'CASE_TERMINAL'; END IF;
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
  IF (requirement.settings->>'askIssueDate')::boolean OR requirement.settings->>'validityDays' IS NOT NULL THEN
   IF p_issue_date IS NULL OR p_issue_date>current_date THEN RAISE EXCEPTION 'CASE_ISSUE_DATE_REQUIRED'; END IF;
  END IF;
  IF binding IS NOT NULL AND coalesce((requirement.settings->>'allowReplacement')::boolean,true)=false THEN RAISE EXCEPTION 'CASE_REPLACEMENT_DISABLED'; END IF;
  IF version.byte_size>coalesce((requirement.settings->>'maxSizeMb')::numeric,50)*1024*1024 THEN RAISE EXCEPTION 'CASE_FILE_TOO_LARGE'; END IF;
  IF jsonb_array_length(coalesce(requirement.settings->'allowedFormats','[]'))>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(requirement.settings->'allowedFormats') f WHERE lower(f)=lower(split_part(doc.file_name,'.',-1)) OR lower(f)=lower(version.mime_type) OR (lower(f)='jpg' AND lower(split_part(doc.file_name,'.',-1))='jpeg')) THEN RAISE EXCEPTION 'CASE_FILE_FORMAT_INVALID'; END IF;
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
  UPDATE public.case_file_documents SET issue_date=p_issue_date,expires_at=CASE WHEN requirement.settings->>'validityDays' IS NOT NULL THEN p_issue_date+((requirement.settings->>'validityDays')::integer*interval '1 day') ELSE NULL END WHERE id=binding;
  UPDATE public.case_file_requirements SET status='uploaded' WHERE id=requirement.id;
 ELSIF p_kind='form' THEN
  SELECT * INTO form_row FROM public.case_file_forms WHERE case_file_id=c.id AND template_item_id=p_item FOR UPDATE;
  SELECT * INTO response FROM public.form_responses WHERE id=p_source AND workspace_id=c.workspace_id AND template_id=form_row.form_template_id FOR SHARE;
  IF subject.user_id IS NULL AND subject.email IS NOT NULL AND lower(response.respondent_email)=lower(subject.email) AND response.respondent_user_id IS NOT NULL THEN
   UPDATE public.case_file_participants SET user_id=response.respondent_user_id WHERE id=subject.id;
   subject.user_id:=response.respondent_user_id;
  END IF;
  IF response.respondent_user_id IS NULL THEN response.respondent_user_id:=case_runtime_private.resolve_case_subject(c.id,response.id); END IF;
  IF subject.user_id IS NULL AND response.respondent_user_id IS NOT NULL AND lower(subject.email)=lower(response.respondent_email) THEN UPDATE public.case_file_participants SET user_id=response.respondent_user_id WHERE id=subject.id;subject.user_id:=response.respondent_user_id;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.form_templates f WHERE f.id=form_row.form_template_id AND f.workspace_id=c.workspace_id AND f.version_number::text=form_row.settings->>'sourceVersion' AND (form_row.settings->>'sourceRevision' IS NULL OR f.revision_number::text=form_row.settings->>'sourceRevision')) THEN RAISE EXCEPTION 'CASE_FORM_VERSION_CHANGED'; END IF;
  IF form_row.id IS NULL OR response.id IS NULL OR response.submitted_at IS NULL OR NOT case_runtime_private.case_form_subject_matches(c.id,response.id) OR length(coalesce(response.pdf_output_hash,''))<>64 OR response.status NOT IN ('submitted','pdf_generated','signing','completed','signed','approved') THEN RAISE EXCEPTION 'CASE_FORM_RESPONSE_INVALID'; END IF;
  INSERT INTO public.case_file_form_submissions(workspace_id,case_file_id,case_form_id,form_response_id,generated_pdf_id,sha256_hash,status,submitted_at,snapshot)
   VALUES(c.workspace_id,c.id,form_row.id,response.id,response.generated_pdf_id,response.pdf_output_hash,'submitted',response.submitted_at,jsonb_build_object('sourceSchemaHash',response.form_schema_hash));
  UPDATE public.case_file_forms SET status='submitted' WHERE id=form_row.id;
 ELSE RAISE EXCEPTION 'CASE_SOURCE_KIND_INVALID'; END IF;
 UPDATE public.case_file_observations SET status='corrected' WHERE case_file_id=c.id AND template_item_id=p_item AND status='open';
 UPDATE public.case_files cf SET review_approval='{}',version=cf.version+1,updated_at=now(),status='integrating' WHERE id=c.id;
 INSERT INTO public.case_file_audit_events(workspace_id,case_file_id,actor_user_id,actor_label,action,affected_object_type,affected_object_id,event_hash,metadata)
  VALUES(c.workspace_id,c.id,p_actor,'Usuario autorizado','case_runtime:attach',p_kind,p_item,encode(extensions.digest(p_operation::text||p_source::text,'sha256'),'hex'),jsonb_build_object('operation_key',p_operation,'operation_hash',operation_hash,'sourceId',p_source,'itemId',p_item));
 RETURN jsonb_build_object('id',c.id);
END;
$$;
