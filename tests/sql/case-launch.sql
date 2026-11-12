-- Synthetic launch data is rolled back; no invitations, signatures or permanent test cases.
BEGIN;
SET LOCAL statement_timeout='35s';
CREATE TEMP TABLE launch_qa(label text,passed boolean);
GRANT ALL ON launch_qa TO service_role;
SET LOCAL ROLE service_role;
DO $$
DECLARE w uuid; actor uuid; t uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); op uuid;
 payload jsonb; assignments jsonb; people jsonb; result jsonb; primary_id uuid; blocked boolean;
BEGIN
 SELECT m.workspace_id,m.user_id INTO w,actor FROM public.workspace_members m JOIN public.workspaces ws ON ws.id=m.workspace_id
 WHERE m.status='active' AND m.role='owner' AND (m.access_expires_at IS NULL OR m.access_expires_at>now())
 AND coalesce((ws.organization_settings#>>'{case_review,separationOfDuties}')::boolean,false)=false LIMIT 1;
 IF w IS NULL THEN RAISE EXCEPTION 'QA_NO_WORKSPACE'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 payload:=jsonb_build_object('name','QA LAUNCH ROLLBACK','description','','case_type','QA','requirements_schema',jsonb_build_object('version',6,'workflowMode','simple','sections',jsonb_build_array(jsonb_build_object('id','section','title','QA','items',jsonb_build_array(jsonb_build_object('id','item','kind','requested_document','title','Acta QA','required',true,'requiresReview',true,'reviewerRole','owner','requiresSignature',false)))),'verifications','[]'::jsonb,'stages','[]'::jsonb,'reviewPolicy',jsonb_build_object('version',1,'reviewTiming','progressive','approval',jsonb_build_object('enabled',true,'role','owner'),'completion',jsonb_build_object('mode','manual','role','owner'))),'forms_schema','[]'::jsonb);
 PERFORM public.case_control_publish(t,actor,w,null,payload);
 assignments:=jsonb_build_object('approver',actor,'closer',actor,'reviewers',jsonb_build_object('item',actor));
 people:=jsonb_build_array(jsonb_build_object('name','Representante QA','email','representative@example.invalid','userId',null,'role','representative'),jsonb_build_object('name','Miembro QA','email','untrusted-email@example.invalid','userId',actor,'role','contact'));
 result:=public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,c,'primary@example.invalid',people);
 SELECT runtime_subject_id INTO primary_id FROM public.case_files WHERE id=c;
 IF (SELECT count(*) FROM public.case_file_participants WHERE case_file_id=c)<>3 OR (SELECT role FROM public.case_file_participants WHERE id=primary_id)<>'subject' THEN RAISE EXCEPTION 'QA_PARTICIPANTS_NOT_SAVED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.case_file_requirements WHERE case_file_id=c AND reviewer_user_id=actor) OR (SELECT runtime_assignments FROM public.case_files WHERE id=c)<>assignments THEN RAISE EXCEPTION 'QA_ASSIGNMENTS_NOT_SAVED'; END IF;
 INSERT INTO launch_qa VALUES('atomic launch preserves primary subject and responsible assignments',true);
 IF NOT EXISTS(SELECT 1 FROM public.case_file_participants WHERE case_file_id=c AND user_id=actor AND email=case_launch_member_email(w,actor)) THEN RAISE EXCEPTION 'QA_UNTRUSTED_MEMBER_EMAIL'; END IF;
 INSERT INTO launch_qa VALUES('member identity uses canonical email instead of client input',true);
 IF NOT EXISTS(SELECT 1 FROM public.case_file_participants WHERE case_file_id=c AND role='representative' AND status='pending' AND metadata->>'workspace_access_granted'='false') THEN RAISE EXCEPTION 'QA_UNEXPECTED_ACCESS'; END IF;
 INSERT INTO launch_qa VALUES('external people remain pending and do not receive workspace access',true);
 PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,c,'primary@example.invalid',people);
 IF (SELECT count(*) FROM public.case_file_participants WHERE case_file_id=c)<>3 OR (SELECT count(*) FROM public.case_file_audit_events WHERE case_file_id=c AND action='case_runtime:launch')<>1 THEN RAISE EXCEPTION 'QA_DUPLICATE_RETRY'; END IF;
 INSERT INTO launch_qa VALUES('identical retry creates neither duplicate participants nor duplicate receipt',true);
 blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,c,'changed@example.invalid',people); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_IDEMPOTENCY_CONFLICT' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked THEN RAISE EXCEPTION 'QA_CHANGED_PRIMARY_ACCEPTED'; END IF;
 INSERT INTO launch_qa VALUES('retry with changed primary email is rejected',true);
 blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,c,'primary@example.invalid',jsonb_set(people,'{0,role}','"contact"')); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_IDEMPOTENCY_CONFLICT' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked THEN RAISE EXCEPTION 'QA_CHANGED_PEOPLE_ACCEPTED'; END IF;
 INSERT INTO launch_qa VALUES('retry with changed participant role is rejected',true);
 op:=gen_random_uuid(); blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,op,'primary@example.invalid',jsonb_build_array(jsonb_build_object('name','Duplicado','email','PRIMARY@EXAMPLE.INVALID','role','contact'))); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_PARTICIPANT_DUPLICATE' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked OR EXISTS(SELECT 1 FROM public.case_files WHERE id=op) THEN RAISE EXCEPTION 'QA_DUPLICATE_NOT_ATOMIC'; END IF;
 INSERT INTO launch_qa VALUES('duplicate participant is rejected without partial case creation',true);
 op:=gen_random_uuid(); blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',actor,assignments,op,'forged@example.invalid',jsonb_build_array(jsonb_build_object('name','Duplicado','email','other@example.invalid','userId',actor,'role','contact'))); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_PARTICIPANT_DUPLICATE' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked OR EXISTS(SELECT 1 FROM public.case_files WHERE id=op) THEN RAISE EXCEPTION 'QA_DUPLICATE_MEMBER'; END IF;
 INSERT INTO launch_qa VALUES('same member cannot be reused as primary and additional contact',true);
 op:=gen_random_uuid(); blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,op,'primary@example.invalid',jsonb_build_array(jsonb_build_object('name','Fuera del espacio','email','outside@example.invalid','userId',gen_random_uuid(),'role','contact'))); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_PARTICIPANT_INVALID' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked OR EXISTS(SELECT 1 FROM public.case_files WHERE id=op) THEN RAISE EXCEPTION 'QA_FOREIGN_USER'; END IF;
 INSERT INTO launch_qa VALUES('foreign workspace account cannot be bound as member',true);
 op:=gen_random_uuid(); blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,assignments,op,'invalid',people); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_PARTICIPANT_INVALID' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked OR EXISTS(SELECT 1 FROM public.case_files WHERE id=op) THEN RAISE EXCEPTION 'QA_INVALID_EMAIL'; END IF;
 INSERT INTO launch_qa VALUES('invalid primary email is rejected atomically',true);
 op:=gen_random_uuid(); blocked:=false; BEGIN PERFORM public.case_control_launch(t,actor,'QA CASE','Titular QA',null,jsonb_set(assignments,'{reviewers}','{}'),op,'primary@example.invalid',people); EXCEPTION WHEN raise_exception THEN IF SQLERRM='CASE_REVIEWER_REQUIRED' THEN blocked:=true; ELSE RAISE; END IF; END;
 IF NOT blocked OR EXISTS(SELECT 1 FROM public.case_files WHERE id=op) OR EXISTS(SELECT 1 FROM public.case_file_participants WHERE case_file_id=op) THEN RAISE EXCEPTION 'QA_REVIEWER_NOT_ATOMIC'; END IF;
 INSERT INTO launch_qa VALUES('missing reviewer rolls back case, primary and additional participants',true);
 IF has_function_privilege('authenticated','public.case_control_launch(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb)','execute') OR has_function_privilege('anon','public.case_control_launch(uuid,uuid,text,text,uuid,jsonb,uuid,text,jsonb)','execute') OR has_function_privilege('authenticated','public.case_launch_member_email(uuid,uuid)','execute') THEN RAISE EXCEPTION 'QA_CLIENT_RPC_ACCESS'; END IF;
 INSERT INTO launch_qa VALUES('launch and canonical email helper are restricted to trusted service',true);
END;
$$;
RESET ROLE;
SELECT * FROM launch_qa;
ROLLBACK;
