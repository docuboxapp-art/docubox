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
  IF response.respondent_user_id IS NULL AND subject.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=subject.user_id AND lower(u.email)=lower(response.respondent_email)) THEN response.respondent_user_id:=subject.user_id; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.form_templates f WHERE f.id=form_row.form_template_id AND f.workspace_id=c.workspace_id AND f.version_number::text=form_row.settings->>'sourceVersion' AND (form_row.settings->>'sourceRevision' IS NULL OR f.revision_number::text=form_row.settings->>'sourceRevision')) THEN RAISE EXCEPTION 'CASE_FORM_VERSION_CHANGED'; END IF;
  IF form_row.id IS NULL OR response.id IS NULL OR response.submitted_at IS NULL OR response.respondent_user_id IS DISTINCT FROM subject.user_id OR subject.user_id IS NULL OR length(coalesce(response.pdf_output_hash,''))<>64 OR response.status NOT IN ('submitted','pdf_generated','signing','completed','signed','approved') THEN RAISE EXCEPTION 'CASE_FORM_RESPONSE_INVALID'; END IF;
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



-- Final response identity and PDF evidence are server-owned, not workspace
-- member assertions through the public Data API. Draft capture stays permitted.
CREATE OR REPLACE FUNCTION public.case_form_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user NOT IN ('service_role','postgres','supabase_admin') AND (NEW.submitted_at IS NOT NULL OR NEW.pdf_output_hash IS NOT NULL OR NEW.respondent_user_id IS NOT NULL) THEN RAISE EXCEPTION 'FORM_RECEIPT_SERVER_ONLY' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.case_form_receipt_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER case_verified_form_receipt BEFORE INSERT OR UPDATE ON public.form_responses FOR EACH ROW EXECUTE FUNCTION public.case_form_receipt_guard();
