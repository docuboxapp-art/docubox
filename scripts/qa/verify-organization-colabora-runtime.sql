-- Hosted regression with the real schema, triggers, privileges and RLS.
-- All new organizations, grants, tasks, receipts and synthetic entitlements
-- exist only inside this transaction. No Auth users, email, files or signatures
-- are created, and no subscription or plan is modified.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';
DO $qa$
<<qa>>
DECLARE
  owner_user uuid; actor uuid; outsider uuid; ws uuid; other_ws uuid;
  member_id uuid; owner_member uuid; role_id uuid; team_id uuid;
  assigned_task uuid; other_task uuid; own_task uuid; checklist_id uuid;
  form_id uuid; invalid_form_id uuid; policy_id uuid; request_id uuid; item_id uuid; challenge uuid; token_id uuid; response_id uuid;
  person_id uuid; evidence_id uuid; evidence_two uuid;
  values_json jsonb; result jsonb; entry jsonb; evidence_values jsonb;
BEGIN
  SELECT owner_id INTO owner_user FROM public.workspaces WHERE workspace_type='business' ORDER BY created_at LIMIT 1;
  SELECT id INTO actor FROM public.user_profiles WHERE id<>owner_user ORDER BY id LIMIT 1;
  SELECT id INTO outsider FROM public.user_profiles WHERE id NOT IN(owner_user,actor) ORDER BY id LIMIT 1;
  IF outsider IS NULL THEN RAISE EXCEPTION 'Three existing profile accounts are required';END IF;
  INSERT INTO public.workspaces(name,workspace_type,owner_id) VALUES('QA rollback Org A','business',owner_user) RETURNING id INTO ws;
  INSERT INTO public.workspaces(name,workspace_type,owner_id) VALUES('QA rollback Org B','business',outsider) RETURNING id INTO other_ws;
  INSERT INTO public.workspace_members(workspace_id,user_id,role,status) VALUES(ws,owner_user,'owner','active') RETURNING id INTO owner_member;
  INSERT INTO public.workspace_members(workspace_id,user_id,role,status) VALUES(ws,actor,'member','active') RETURNING id INTO member_id;
  INSERT INTO public.workspace_members(workspace_id,user_id,role,status) VALUES(other_ws,outsider,'owner','active');
  INSERT INTO public.organization_roles(workspace_id,name,scope_type,created_by) VALUES(ws,'QA scoped operator','assigned',owner_user) RETURNING id INTO role_id;
  INSERT INTO public.organization_role_permissions(role_id,permission_id) SELECT role_id,id FROM public.organization_permissions WHERE permission_key IN('tasks.view','tasks.edit','tasks.complete','tasks.assign');
  INSERT INTO public.organization_member_roles(workspace_id,member_id,role_id,assigned_by) VALUES(ws,member_id,role_id,owner_user);
  INSERT INTO public.organization_units(workspace_id,name,unit_type,created_by) VALUES(ws,'QA team','team',owner_user) RETURNING id INTO team_id;
  INSERT INTO public.organization_unit_members(unit_id,member_id) VALUES(team_id,member_id),(team_id,owner_member);
  INSERT INTO public.organization_entitlements(workspace_id,entitlement_key,status,source,access_level)
    VALUES(ws,'collaboration_core','active','grant','enabled');
  INSERT INTO public.tareas(workspace_id,created_by,assigned_to,title,tipo) VALUES(ws,owner_user,actor,'QA assigned','revisar_documento') RETURNING id INTO assigned_task;
  INSERT INTO public.tareas(workspace_id,created_by,assigned_to,title,tipo) VALUES(ws,owner_user,owner_user,'QA other','revisar_documento') RETURNING id INTO other_task;
  INSERT INTO public.tareas(workspace_id,created_by,assigned_to,title,tipo) VALUES(other_ws,outsider,outsider,'QA foreign','revisar_documento');
  PERFORM set_config('request.jwt.claim.sub',owner_user::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
  INSERT INTO public.form_templates(workspace_id,name,status,schema,settings,created_by)
    VALUES(ws,'QA linked unsigned form','draft','[{"id":"reference","type":"text","label":"Referencia"}]','{"requiresSignature":false}',owner_user) RETURNING id INTO form_id;
  UPDATE public.form_templates SET status='published',published_at=now() WHERE id=form_id;
  IF (SELECT requires_signature FROM public.form_templates WHERE id=form_id) THEN RAISE EXCEPTION 'Optional signature was forced on';END IF;
  BEGIN
    INSERT INTO public.form_templates(workspace_id,name,status,schema,settings,created_by) VALUES(ws,'QA invalid signed form','draft','[]','{}',owner_user) RETURNING id INTO invalid_form_id;
    UPDATE public.form_templates SET status='published',published_at=now() WHERE id=invalid_form_id;
    RAISE EXCEPTION 'Signature requirement was bypassed';
  EXCEPTION WHEN check_violation THEN NULL;END;

  INSERT INTO public.organization_shared_resources(workspace_id,name,resource_type,form_template_id,created_by)
    VALUES(ws,'QA shared form','form',form_id,owner_user);
  BEGIN
    INSERT INTO public.organization_shared_resources(workspace_id,name,resource_type,form_template_id,created_by)
      VALUES(other_ws,'QA invalid shared form','form',form_id,outsider);
    RAISE EXCEPTION 'Shared form crossed organization boundary';
  EXCEPTION WHEN check_violation THEN NULL;END;
  INSERT INTO public.organization_signature_policies(workspace_id,name,created_by,allowed_signature_types)
    VALUES(ws,'QA publication policy',owner_user,ARRAY['click_sign']) RETURNING id INTO policy_id;
  PERFORM public.publish_organization_signature_policy(ws,policy_id);
  BEGIN
    UPDATE public.organization_signature_policies SET requirements='{"changed":true}' WHERE id=policy_id;
    RAISE EXCEPTION 'Published policy content was mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;END;
  UPDATE public.organization_signature_policies SET status='archived' WHERE id=policy_id;
  IF (SELECT status FROM public.organization_signature_policies WHERE id=policy_id)<>'archived' THEN RAISE EXCEPTION 'Published policy could not be archived';END IF;

  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF public.organization_resource_scope_version(ws)<>1 THEN RAISE EXCEPTION 'Scope readiness is unavailable';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_my_organization_permissions(ws) WHERE permission_key='tasks.view') THEN RAISE EXCEPTION 'Role permissions missing';END IF;
  IF (SELECT count(*) FROM public.tareas WHERE workspace_id=ws)<>1 THEN RAISE EXCEPTION 'Assigned task RLS mismatch';END IF;
  IF EXISTS(SELECT 1 FROM public.tareas WHERE workspace_id=other_ws) OR public.organization_can_access_resource(ws,'tasks.view','task',other_task) THEN RAISE EXCEPTION 'Out-of-scope task visible';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.form_templates WHERE id=form_id) THEN RAISE EXCEPTION 'Native workspace RLS denied an active member';END IF;
  BEGIN
    UPDATE public.tareas SET title='Forbidden root edit' WHERE id=assigned_task;
    RAISE EXCEPTION 'Browser root task DML allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN
    PERFORM public.colabora_mutate_task(ws,assigned_task,actor,'start',1,'{}',NULL);
    RAISE EXCEPTION 'Privileged task RPC exposed to browser';
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  EXECUTE 'RESET ROLE';

  result:=public.colabora_mutate_task(ws,assigned_task,actor,'start',1,'{}',NULL);
  IF result->>'estado'<>'en_proceso' THEN RAISE EXCEPTION 'Task start was not persisted';END IF;
  BEGIN
    PERFORM public.colabora_mutate_task(ws,assigned_task,actor,'update',1,'{"prioridad":"alta"}',NULL);
    RAISE EXCEPTION 'Stale task version accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;END;
  INSERT INTO public.task_checklist_items(workspace_id,tarea_id,text,done,created_by) VALUES(ws,assigned_task,'QA requirement',false,actor) RETURNING id INTO checklist_id;
  BEGIN
    PERFORM public.colabora_mutate_task(ws,assigned_task,actor,'complete',(result->>'optimistic_version')::integer,'{}','QA synthetic work completed.');
    RAISE EXCEPTION 'Incomplete checklist accepted';
  EXCEPTION WHEN check_violation THEN NULL;END;
  UPDATE public.task_checklist_items SET done=true WHERE id=checklist_id;
  result:=public.colabora_mutate_task(ws,assigned_task,actor,'complete',(result->>'optimistic_version')::integer,'{}','QA synthetic work completed.');
  IF result->>'estado'<>'completada' OR NOT EXISTS(SELECT 1 FROM public.task_history WHERE tarea_id=assigned_task) THEN RAISE EXCEPTION 'Task completion/history missing';END IF;

  UPDATE public.workspace_members SET access_expires_at=now()-interval '1 second' WHERE id=member_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF ws IN(SELECT public.get_user_workspace_ids()) OR EXISTS(SELECT 1 FROM public.form_templates WHERE id=form_id) THEN RAISE EXCEPTION 'Expired membership retained native access';END IF;
  IF public.has_collaboration_entitlement(ws,'collaboration_core',false) OR public.get_my_collaboration_access(ws)->>'code'<>'MEMBERSHIP_EXPIRED' THEN RAISE EXCEPTION 'Expired member retained commercial access';END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.workspace_members SET access_expires_at=NULL,status='suspended' WHERE id=member_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF EXISTS(SELECT 1 FROM public.tareas WHERE workspace_id=ws) OR ws IN(SELECT public.get_user_workspace_ids()) THEN RAISE EXCEPTION 'Suspended member retained access';END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.workspace_members SET status='active' WHERE id=member_id;
  UPDATE public.organization_roles SET scope_type='team' WHERE id=role_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF (SELECT count(*) FROM public.tareas WHERE workspace_id=ws)<>2 THEN RAISE EXCEPTION 'Team scope did not include both members';END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.organization_roles SET scope_type='own' WHERE id=role_id;
  INSERT INTO public.tareas(workspace_id,created_by,assigned_to,title,tipo) VALUES(ws,actor,owner_user,'QA owned','revisar_documento') RETURNING id INTO own_task;
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF (SELECT count(*) FROM public.tareas WHERE workspace_id=ws)<>1 OR NOT EXISTS(SELECT 1 FROM public.tareas WHERE id=own_task) THEN RAISE EXCEPTION 'Own scope mismatch';END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.organization_roles SET status='archived' WHERE id=role_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF EXISTS(SELECT 1 FROM public.tareas WHERE workspace_id=ws) THEN RAISE EXCEPTION 'Archived role retained scoped access';END IF;
  EXECUTE 'RESET ROLE';

  INSERT INTO public.organization_directory_people(workspace_id,full_name,person_type,relationship_type,created_by) VALUES(ws,'QA rollback evidence','individual','collaborator',owner_user) RETURNING id INTO person_id;
  evidence_id:=gen_random_uuid();evidence_two:=gen_random_uuid();
  evidence_values:=jsonb_build_object('person_id',person_id,'evidence_type','appointment','display_name','QA synthetic evidence','storage_path',ws||'/'||person_id||'/'||evidence_id||'-qa.pdf','mime_type','application/pdf','size_bytes',8,'sha256_hash',repeat('0',64),'file_name','qa.pdf');
  PERFORM public.finalize_organization_directory_evidence(ws,owner_user,evidence_id,evidence_values);
  PERFORM public.finalize_organization_directory_evidence(ws,owner_user,evidence_id,evidence_values);
  evidence_values:=evidence_values||jsonb_build_object('storage_path',ws||'/'||person_id||'/'||evidence_two||'-qa.pdf');
  PERFORM public.finalize_organization_directory_evidence(ws,owner_user,evidence_two,evidence_values);
  IF (SELECT count(*) FROM public.organization_directory_evidence e WHERE e.person_id=qa.person_id AND workspace_id=ws)<>2 THEN RAISE EXCEPTION 'Evidence finalization was not idempotent';END IF;
  IF (SELECT max(version) FROM public.organization_directory_evidence e WHERE e.person_id=qa.person_id)<>2 OR EXISTS(SELECT 1 FROM public.organization_directory_evidence e WHERE e.person_id=qa.person_id AND status<>'pending') THEN RAISE EXCEPTION 'Evidence version/status mismatch';END IF;

  PERFORM set_config('request.jwt.claim.sub',owner_user::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_user,'role','authenticated')::text,true);
  values_json:=jsonb_build_object('title','QA linked form request','recipient_name','QA synthetic recipient','recipient_email','runtime-qa@example.invalid','send_invitation',false);
  result:=public.colabora_create_document_request(ws,owner_user,values_json,jsonb_build_array(jsonb_build_object('item_type','form','title','QA form','required',true,'form_template_id',form_id,'source_snapshot',jsonb_build_object('requiresSignature',false))),repeat('1',64));
  request_id:=(result->>'id')::uuid;
  SELECT i.id INTO item_id FROM public.collaboration_request_items i WHERE i.request_id=qa.request_id;
  challenge:=public.colabora_issue_request_otp(repeat('1',64),repeat('2',64),repeat('3',64));
  result:=public.colabora_verify_request_otp(repeat('1',64),challenge,repeat('4',64),repeat('5',64));
  IF result->>'code'<>'otp_invalid' THEN RAISE EXCEPTION 'Invalid OTP accepted';END IF;
  result:=public.colabora_verify_request_otp(repeat('1',64),challenge,repeat('2',64),repeat('5',64));
  IF (result->>'status')::integer<>200 THEN RAISE EXCEPTION 'Valid synthetic OTP rejected';END IF;
  result:=public.colabora_verify_request_otp(repeat('1',64),challenge,repeat('2',64),repeat('5',64));
  IF result->>'code'<>'otp_expired' THEN RAISE EXCEPTION 'Consumed OTP reused';END IF;
  result:=public.colabora_request_form_token(repeat('1',64),repeat('5',64),item_id);
  SELECT id INTO token_id FROM public.form_tokens WHERE token=result->>'token';
  IF NOT EXISTS(SELECT 1 FROM public.form_tokens t WHERE t.id=token_id AND access_mode='private') THEN RAISE EXCEPTION 'Form token did not retain private access';END IF;
  INSERT INTO public.form_responses(token_id,template_id,workspace_id,response_data,field_hashes,status) VALUES(token_id,form_id,ws,'{}','{}','started') RETURNING id INTO response_id;
  UPDATE public.form_responses SET status='in_progress',response_data='{"reference":"QA saved"}' WHERE id=response_id;
  IF (SELECT i.status FROM public.collaboration_request_items i WHERE i.id=item_id)<>'pending' THEN RAISE EXCEPTION 'Draft counted as delivered';END IF;
  BEGIN
    PERFORM public.colabora_submit_request(repeat('1',64),repeat('5',64));
    RAISE EXCEPTION 'Unsubmitted form bypassed request gate';
  EXCEPTION WHEN check_violation THEN NULL;END;
  UPDATE public.form_responses SET status='submitted',submitted_at=now(),response_data='{"reference":"QA final"}' WHERE id=response_id;
  IF NOT EXISTS(SELECT 1 FROM public.collaboration_request_items i WHERE i.id=item_id AND i.form_response_id=response_id AND i.status='uploaded') THEN RAISE EXCEPTION 'Submitted form receipt not attached';END IF;
  BEGIN
    UPDATE public.form_responses SET response_data='{}' WHERE id=response_id;
    RAISE EXCEPTION 'Submitted form receipt was overwritten';
  EXCEPTION WHEN check_violation THEN NULL;END;
  result:=public.colabora_submit_request(repeat('1',64),repeat('5',64));
  IF result->>'status'<>'in_review' THEN RAISE EXCEPTION 'Request did not reach review';END IF;
  result:=public.colabora_review_request_item(ws,owner_user,request_id,'approve_item',item_id,NULL);
  IF result->>'status'<>'completed' THEN RAISE EXCEPTION 'Approved unsigned form did not complete request';END IF;
  -- A completed portal retains read access to its receipt, but cannot resubmit.
  BEGIN
    PERFORM public.colabora_submit_request(repeat('1',64),repeat('5',64));
    RAISE EXCEPTION 'Completed request accepted another submission';
  EXCEPTION WHEN check_violation THEN NULL;END;
END;
$qa$;
ROLLBACK;
