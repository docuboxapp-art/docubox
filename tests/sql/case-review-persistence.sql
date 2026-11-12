-- Synthetic SQL integration tests. Run as project database owner; JWT identity
-- is switched to authenticated for the actual RLS checks. No rows survive.
BEGIN;
SET LOCAL statement_timeout = '8s';
CREATE TEMP TABLE case_review_qa_context AS
SELECT member.workspace_id, member.user_id, gen_random_uuid() AS template_id,
  gen_random_uuid() AS case_id
FROM public.workspace_members member WHERE member.status='active'
  AND (member.access_expires_at IS NULL OR member.access_expires_at > now())
ORDER BY (member.role='owner') DESC LIMIT 1;
GRANT SELECT ON case_review_qa_context TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',user_id::text,true) FROM case_review_qa_context;
DO $$
DECLARE fixture record; saved jsonb; affected integer; blocked boolean := false;
BEGIN
  SELECT * INTO fixture FROM case_review_qa_context;
  IF fixture IS NULL THEN RAISE EXCEPTION 'QA_NO_MEMBER'; END IF;
  INSERT INTO public.case_file_templates(id,workspace_id,created_by,name,case_type,status,requirements_schema)
  VALUES (fixture.template_id,fixture.workspace_id,fixture.user_id,'QA REVIEW CLOSE ROLLBACK','QA','draft',
    jsonb_build_object('version',6,'sections','[]'::jsonb,'reviewPolicy',
      jsonb_build_object('version',1,'reviewTiming','progressive',
        'approval',jsonb_build_object('enabled',false,'role',null),
        'completion',jsonb_build_object('mode','automatic','role','owner'))));
  SELECT requirements_schema INTO saved FROM public.case_file_templates WHERE id=fixture.template_id;
  IF saved #>> '{reviewPolicy,completion,mode}' IS DISTINCT FROM 'automatic' THEN RAISE EXCEPTION 'QA_PERSISTENCE'; END IF;
  UPDATE public.case_file_templates SET requirements_schema=jsonb_set(requirements_schema,
    '{reviewPolicy,completion,mode}','"manual"'::jsonb), editor_draft=jsonb_build_object('name','QA draft')
    WHERE id=fixture.template_id;
  SELECT requirements_schema INTO saved FROM public.case_file_templates WHERE id=fixture.template_id;
  IF saved #>> '{reviewPolicy,completion,mode}' IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'QA_UPDATE'; END IF;
  UPDATE public.case_file_templates SET name='stale writer' WHERE id=fixture.template_id
    AND updated_at='2000-01-01T00:00:00Z'::timestamptz;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'QA_CONCURRENCY'; END IF;
  BEGIN
    UPDATE public.case_file_templates SET status='active' WHERE id=fixture.template_id;
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM='CASE_PUBLICATION_REQUIRES_SERVER' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'QA_UNSAFE_PUBLICATION'; END IF;
  IF (SELECT count(*) FROM public.case_file_template_versions WHERE template_id=fixture.template_id)<>0 THEN RAISE EXCEPTION 'QA_FALSE_VERSION'; END IF;
  IF NOT (public.case_review_runtime_capabilities()->>'transitions')::boolean THEN RAISE EXCEPTION 'QA_MISSING_RUNTIME_CAPABILITIES'; END IF;
  INSERT INTO public.case_files(id,workspace_id,folio,title,case_type,created_by,status)
    VALUES(fixture.case_id,fixture.workspace_id,'QA-REVIEW-'||fixture.case_id,'QA REVIEW CLOSE ROLLBACK','QA',fixture.user_id,'draft');
  blocked:=false;
  BEGIN
    UPDATE public.case_files SET status='open' WHERE id=fixture.case_id;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='CASE_SERVER_OPERATION_REQUIRED' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'QA_EXECUTION_WITHOUT_POLICY'; END IF;
  blocked:=false;
  BEGIN
    UPDATE public.case_files SET status='sealed',closed_at=now() WHERE id=fixture.case_id;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='CASE_SERVER_OPERATION_REQUIRED' THEN blocked:=true; ELSE RAISE; END IF;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'QA_CLOSURE_WITHOUT_POLICY'; END IF;
END;
$$;
SELECT set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
DO $$
DECLARE fixture record; blocked boolean := false;
BEGIN
  SELECT * INTO fixture FROM case_review_qa_context;
  IF EXISTS(SELECT 1 FROM public.case_file_templates WHERE id=fixture.template_id) THEN RAISE EXCEPTION 'QA_CROSS_TENANT_READ'; END IF;
  BEGIN
    INSERT INTO public.case_file_templates(workspace_id,created_by,name,case_type,status)
      VALUES(fixture.workspace_id,fixture.user_id,'QA forbidden','QA','draft');
  EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'QA_CROSS_TENANT_WRITE'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
SELECT jsonb_build_object('rollback',true,'assertions_passed',10,
  'remaining_qa_templates',(SELECT count(*) FROM public.case_file_templates WHERE name LIKE 'QA%'),
  'remaining_instances',(SELECT count(*) FROM public.case_files),
  'remaining_versions',(SELECT count(*) FROM public.case_file_template_versions)) AS qa_result;
