-- Temporary fixtures and administrative changes are rolled back together.
-- No invitations, messages, session revocation, signatures or provider calls.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';
DO $qa$
DECLARE ws uuid; actor uuid; owner_member uuid; person_id uuid; center_id uuid; policy_id uuid; certificate_id uuid; result jsonb; record_id uuid; original_name text;
BEGIN
  SELECT w.id,w.owner_id,m.id INTO ws,actor,owner_member FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner' AND m.status='active' WHERE w.workspace_type='business' LIMIT 1;
  IF ws IS NULL THEN RAISE EXCEPTION 'Organization fixture missing'; END IF;
  result:=public.mutate_organization_catalog(ws,actor,'directory',null,jsonb_build_object('full_name','QA rollback person','person_type','individual','relationship_type','collaborator'),null);
  person_id:=(result->>'id')::uuid;
  PERFORM public.mutate_organization_catalog(ws,actor,'directory',person_id,'{"full_name":"QA rollback edited person"}',null);
  IF (SELECT full_name FROM public.organization_directory_people WHERE id=person_id)<>'QA rollback edited person' THEN RAISE EXCEPTION 'Directory update not persisted'; END IF;
  result:=public.mutate_organization_catalog(ws,actor,'authorities',null,jsonb_build_object('person_id',person_id,'authority_type','QA rollback authority','modality','individual','currency','MXN','required_representatives',1,'identity_required',true,'status','pending_validation'),null);
  record_id:=(result->>'id')::uuid;
  PERFORM public.mutate_organization_catalog(ws,actor,'authorities',record_id,'{"legal_basis":"QA rollback basis"}',null);
  result:=public.mutate_organization_catalog(ws,actor,'policies',null,'{"name":"QA rollback policy","security_level":"basic","allowed_signature_types":["autografa"],"requirements":{},"status":"draft"}',null);
  policy_id:=(result->>'id')::uuid;
  PERFORM public.mutate_organization_catalog(ws,actor,'policies',policy_id,'{"description":"QA rollback updated policy"}',null);
  result:=public.mutate_organization_catalog(ws,actor,'centers',null,jsonb_build_object('code','QA-'||substr(gen_random_uuid()::text,1,8),'name','QA rollback center','budget',0,'currency','MXN','alert_threshold_percent',80,'owner_member_id',owner_member),null);
  center_id:=(result->>'id')::uuid;
  BEGIN
    PERFORM public.mutate_organization_catalog(ws,actor,'centers',center_id,'{"name":"Must roll back","alert_threshold_percent":0}',null);
    RAISE EXCEPTION 'Invalid threshold accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT name FROM public.organization_cost_centers WHERE id=center_id)<>'QA rollback center' THEN RAISE EXCEPTION 'Partial failed update survived'; END IF;
  BEGIN
    PERFORM public.mutate_organization_catalog(ws,actor,'centers',center_id,jsonb_build_object('owner_member_id',gen_random_uuid()),null);
    RAISE EXCEPTION 'Foreign member accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  result:=public.mutate_organization_catalog(ws,actor,'templates',null,jsonb_build_object('template_key','qa.'||gen_random_uuid(),'name','QA rollback communication','subject','QA rollback subject','body_text','QA {{organization_name}}','status','draft'),null);
  record_id:=(result->>'id')::uuid;
  PERFORM public.mutate_organization_catalog(ws,actor,'templates',record_id,'{"subject":"QA rollback edited subject","legal_version":2}',null);
  result:=public.mutate_organization_catalog(ws,actor,'networks',null,'{"name":"QA rollback network","network_cidr":"192.0.2.0/24","mode":"allow"}',null);
  PERFORM public.mutate_organization_catalog(ws,actor,'networks',(result->>'id')::uuid,'{"status":"inactive"}',null);
  result:=public.mutate_organization_catalog(ws,actor,'alerts',null,jsonb_build_object('event_key','qa.'||gen_random_uuid(),'display_name','QA rollback alert','severity','warning','channels',jsonb_build_array('in_app'),'recipients','[]'::jsonb,'enabled',true),null);
  PERFORM public.mutate_organization_catalog(ws,actor,'alerts',(result->>'id')::uuid,'{"enabled":false}',null);
  INSERT INTO public.organization_certificates(workspace_id,certificate_type,subject_name,alias,environment,custody_type,status,created_by) VALUES(ws,'institutional','QA rollback certificate','QA rollback certificate','sandbox','metadata_only','pending',actor) RETURNING id INTO certificate_id;
  PERFORM public.mutate_organization_catalog(ws,actor,'certificates',certificate_id,'{"alias":"QA rollback edited certificate"}',null);
  result:=public.mutate_organization_catalog(ws,actor,'certificate_access',null,jsonb_build_object('certificate_id',certificate_id,'member_id',owner_member,'document_types',jsonb_build_array('contract')),null);
  PERFORM public.mutate_organization_catalog(ws,actor,'certificate_access',(result->>'id')::uuid,'{"amount_limit":1000}',null);
  PERFORM public.remove_organization_certificate_access(ws,actor,(result->>'id')::uuid);
  IF EXISTS(SELECT 1 FROM public.organization_certificate_permissions WHERE id=(result->>'id')::uuid) THEN RAISE EXCEPTION 'Certificate grant not revoked'; END IF;
  BEGIN
    PERFORM public.mutate_organization_catalog(ws,gen_random_uuid(),'centers',center_id,'{"name":"Forbidden update"}',null);
    RAISE EXCEPTION 'Unauthorized actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.mutate_organization_catalog(ws,actor,'centers',center_id,jsonb_build_object('workspace_id',gen_random_uuid()),null);
    RAISE EXCEPTION 'Workspace reassignment accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT EXISTS(SELECT 1 FROM public.organization_audit_events WHERE workspace_id=ws AND resource_id=center_id::text AND event_type='organization.catalog.created') THEN RAISE EXCEPTION 'Audit missing'; END IF;
  IF has_function_privilege('anon','public.mutate_organization_catalog(uuid,uuid,text,uuid,jsonb,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','public.mutate_organization_catalog(uuid,uuid,text,uuid,jsonb,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Server mutator exposed to browser'; END IF;
END $qa$;
ROLLBACK;
