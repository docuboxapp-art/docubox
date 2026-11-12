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
  'responses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'template_id',template_id,'document_id',document_id,'respondent_user_id',respondent_user_id,'pdf_output_hash',pdf_output_hash,'submitted_at',submitted_at,'status',status,'form_schema_hash',form_schema_hash) ORDER BY id) FROM public.form_responses WHERE id=ANY(coalesce(response_ids,'{}'::uuid[])) AND workspace_id=c.workspace_id),'[]'),
  'completions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'document_version_id',document_version_id,'participant_reference_id',participant_reference_id,'actor_user_id',actor_user_id,'effective_actor_user_id',effective_actor_user_id,'action_type',action_type,'status',status,'signature_evidence_id',signature_evidence_id,'committed_at',committed_at) ORDER BY id) FROM public.participant_completion_attempts WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signature_evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'document_version_id',document_version_id,'participant_record_id',participant_record_id,'captured_by',captured_by,'is_voided',is_voided,'document_sha256',document_sha256,'combined_sha256',combined_sha256,'signature_hash',signature_hash,'signed_payload_sha256',signed_payload_sha256,'signature_id',signature_id) ORDER BY id) FROM public.signature_evidence WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signing_groups',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.document_signing_groups g WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'signing_members',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.document_signing_group_members g WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'),
  'references',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'document_id',document_id,'participant_json_id',participant_json_id,'participant_user_id',participant_user_id,'snapshot',snapshot,'active',active) ORDER BY id) FROM public.document_participant_references WHERE document_id=ANY(document_ids) AND workspace_id=c.workspace_id),'[]'));
 RETURN state_data || jsonb_build_object('revision',encode(extensions.digest(state_data::text,'sha256'),'hex'));
END;
$$;
