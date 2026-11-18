-- Regression checks for the mandatory session policy.
-- Uses one synthetic session without issuing credentials. All data and audit
-- writes are rolled back; no existing session or profile is modified.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '25s';

DO $test$
DECLARE v_user uuid; v_session uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); p record;
BEGIN
 SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
 IF v_user IS NULL THEN RAISE EXCEPTION 'Missing fixture owner'; END IF;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(v_session,v_user,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
 INSERT INTO public.docubox_session_activity(session_id,user_id,last_user_activity_at) VALUES(v_session,v_user,CURRENT_TIMESTAMP);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'session_id',v_session,'role','authenticated')::text,true);
 SELECT * INTO p FROM public.enforce_docubox_session_policy(false);
 IF p.active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Active session rejected'; END IF;
 UPDATE public.docubox_session_activity SET last_user_activity_at=CURRENT_TIMESTAMP-INTERVAL '2 days' WHERE session_id=v_session;
 SELECT * INTO p FROM public.enforce_docubox_session_policy(false);
 IF p.active IS DISTINCT FROM false OR p.reason <> 'INACTIVITY_TIMEOUT' THEN RAISE EXCEPTION 'Inactive session was not denied'; END IF;
 SELECT * INTO p FROM public.enforce_docubox_session_policy(true);
 IF p.active IS DISTINCT FROM false OR p.reason <> 'INACTIVITY_TIMEOUT' THEN RAISE EXCEPTION 'Activity revived an expired session'; END IF;
 UPDATE auth.sessions SET created_at=CURRENT_TIMESTAMP-INTERVAL '2 days' WHERE id=v_session;
 SELECT * INTO p FROM public.enforce_docubox_session_policy(false);
 IF p.active IS DISTINCT FROM false OR p.reason <> 'ABSOLUTE_TIMEOUT' THEN RAISE EXCEPTION 'Absolute expiry was not denied'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'session_id',v_other,'role','authenticated')::text,true);
 SELECT * INTO p FROM public.enforce_docubox_session_policy(false);
 IF p.active IS DISTINCT FROM false OR p.reason <> 'SESSION_NOT_FOUND' THEN RAISE EXCEPTION 'Missing session was accepted'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 SELECT * INTO p FROM public.enforce_docubox_session_policy(false);
 IF p.active IS DISTINCT FROM false OR p.reason <> 'UNAUTHENTICATED' THEN RAISE EXCEPTION 'Anonymous session was accepted'; END IF;
 IF has_function_privilege('anon','public.enforce_docubox_session_policy(boolean)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute grant'; END IF;
END $test$;
ROLLBACK;
