-- Server-only, invoker-rights transaction; no new browser table grants.
CREATE OR REPLACE FUNCTION public.mutate_organization_catalog(
 ws_id uuid, actor_user_id uuid, catalog_key text, record_id uuid, patch jsonb, expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $catalog$
DECLARE table_name text; v_permission text; allowed_keys text[]; column_names text; assignments text;
 data jsonb:=patch; previous jsonb; result_id uuid; field_key text; related_table text; found_id uuid;
BEGIN
 IF current_user NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501'; END IF;
 CASE catalog_key
 WHEN 'directory' THEN table_name:='organization_directory_people'; v_permission:='directory.manage'; allowed_keys:=ARRAY['full_name','email','phone','person_type','relationship_type','job_title','area_name','member_id','valid_from','valid_until','status','identity_status'];
WHEN 'authorities' THEN table_name:='organization_authorities'; v_permission:='authorities.manage'; allowed_keys:=ARRAY['person_id','authority_type','modality','legal_basis','monetary_limit','currency','document_types','areas','required_representatives','identity_required','valid_from','valid_until','status','approved_by','approved_at','revoked_by','revoked_at'];
WHEN 'policies' THEN table_name:='organization_signature_policies'; v_permission:='signature_policies.manage'; allowed_keys:=ARRAY['name','description','security_level','allowed_signature_types','resource_scope','status','requirements'];
WHEN 'resources' THEN table_name:='organization_shared_resources'; v_permission:='resources.manage'; allowed_keys:=ARRAY['name','description','visibility','workflow_id','signature_policy_id','status'];
WHEN 'centers' THEN table_name:='organization_cost_centers'; v_permission:='billing.manage'; allowed_keys:=ARRAY['code','name','description','budget','currency','alert_threshold_percent','owner_member_id','status'];
WHEN 'templates' THEN table_name:='organization_communication_templates'; v_permission:='branding.manage'; allowed_keys:=ARRAY['template_key','name','subject','body_text','status','legal_version'];
WHEN 'domains' THEN table_name:='organization_sender_domains'; v_permission:='branding.manage'; allowed_keys:=ARRAY['sender_name','sender_email','reply_to','dns_status','verification_reference','last_checked_at'];
WHEN 'networks' THEN table_name:='organization_trusted_networks'; v_permission:='security.manage'; allowed_keys:=ARRAY['name','network_cidr','mode','status'];
WHEN 'alerts' THEN table_name:='organization_security_alert_rules'; v_permission:='security.manage'; allowed_keys:=ARRAY['event_key','display_name','severity','channels','recipients','enabled'];
WHEN 'certificates' THEN table_name:='organization_certificates'; v_permission:='certificates.manage'; allowed_keys:=ARRAY['alias','provider_name','status'];
WHEN 'certificate_access' THEN table_name:='organization_certificate_permissions'; v_permission:='certificates.manage'; allowed_keys:=ARRAY['certificate_id','member_id','unit_id','document_types','amount_limit'];
WHEN 'integrations' THEN table_name:='organization_integrations'; v_permission:='integrations.manage'; allowed_keys:=ARRAY['display_name','status'];
 ELSE RAISE EXCEPTION 'invalid_catalog' USING ERRCODE='23514'; END CASE;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=ws_id AND m.user_id=actor_user_id AND m.status='active'
   AND (m.access_expires_at IS NULL OR m.access_expires_at>now()) AND (m.role IN('owner','admin') OR EXISTS(
     SELECT 1 FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.role_id AND r.workspace_id=ws_id AND r.status='active'
     JOIN public.organization_role_permissions rp ON rp.role_id=r.id JOIN public.organization_permissions p ON p.id=rp.permission_id
     WHERE mr.member_id=m.id AND mr.workspace_id=ws_id AND p.permission_key=v_permission))) THEN
   RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(data)<>'object' OR data='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(data) k WHERE NOT k=ANY(allowed_keys)) THEN
   RAISE EXCEPTION 'catalog_fields_invalid' USING ERRCODE='23514'; END IF;
 IF record_id IS NOT NULL THEN
   EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE workspace_id=$1 AND id=$2 FOR UPDATE',table_name) INTO previous USING ws_id,record_id;
   IF previous IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002'; END IF;
   IF expected_updated_at IS NOT NULL AND previous ? 'updated_at' AND (previous->>'updated_at')::timestamptz IS DISTINCT FROM expected_updated_at THEN
     RAISE EXCEPTION 'catalog_record_conflict' USING ERRCODE='40001'; END IF;
   IF catalog_key IN('policies','resources') AND previous->>'status'<>'draft' AND data-'status'<>'{}'::jsonb THEN
     RAISE EXCEPTION 'catalog_version_required' USING ERRCODE='23514'; END IF;
 END IF;
 FOR field_key IN SELECT jsonb_object_keys(data) LOOP
   related_table:=CASE field_key WHEN 'member_id' THEN 'workspace_members' WHEN 'leader_member_id' THEN 'workspace_members'
     WHEN 'owner_member_id' THEN 'workspace_members' WHEN 'unit_id' THEN 'organization_units' WHEN 'person_id' THEN 'organization_directory_people'
     WHEN 'certificate_id' THEN 'organization_certificates' WHEN 'workflow_id' THEN 'organization_approval_workflows'
     WHEN 'signature_policy_id' THEN 'organization_signature_policies' ELSE NULL END;
   IF related_table IS NOT NULL AND data->>field_key IS NOT NULL THEN
     EXECUTE format('SELECT id FROM public.%I WHERE workspace_id=$1 AND id=$2',related_table) INTO found_id USING ws_id,(data->>field_key)::uuid;
     IF found_id IS NULL THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='23514'; END IF;
   END IF;
 END LOOP;
 IF record_id IS NULL THEN
   IF catalog_key IN('resources','domains','certificates','integrations') THEN RAISE EXCEPTION 'catalog_creation_unavailable' USING ERRCODE='23514'; END IF;
   data:=data||jsonb_build_object('workspace_id',ws_id);
   IF catalog_key<>'centers' THEN data:=data||jsonb_build_object('created_by',actor_user_id); END IF;
   SELECT string_agg(format('%I',key),','),string_agg(format('input.%I',key),',') INTO column_names,assignments FROM jsonb_object_keys(data) key;
   EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) input RETURNING id',table_name,column_names,assignments,table_name) INTO result_id USING data;
 ELSE
   IF previous ? 'updated_at' THEN data:=data||jsonb_build_object('updated_at',now()); END IF;
   SELECT string_agg(format('%1$I=input.%1$I',key),',') INTO assignments FROM jsonb_object_keys(data) key;
   EXECUTE format('UPDATE public.%I target SET %s FROM jsonb_populate_record(NULL::public.%I,$1) input WHERE target.workspace_id=$2 AND target.id=$3 RETURNING target.id',table_name,assignments,table_name) INTO result_id USING data,ws_id,record_id;
 END IF;
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,payload,module,origin)
 VALUES(ws_id,actor_user_id,CASE WHEN record_id IS NULL THEN 'organization.catalog.created' ELSE 'organization.catalog.updated' END,
 table_name,result_id::text,CASE WHEN record_id IS NULL THEN 'Registro organizacional creado' ELSE 'Registro organizacional actualizado' END,
 jsonb_build_object('catalog',catalog_key,'changed_fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(patch) key)),split_part(v_permission,'.',1),'api');
 RETURN jsonb_build_object('id',result_id);
END; $catalog$;
REVOKE ALL ON FUNCTION public.mutate_organization_catalog(uuid,uuid,text,uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_organization_catalog(uuid,uuid,text,uuid,jsonb,timestamptz) TO service_role;
