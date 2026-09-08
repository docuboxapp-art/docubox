-- LucIA Phase 3 RPC privilege and authentication contract.

BEGIN;
DO $$
DECLARE
  v_function regprocedure;
  v_functions regprocedure[] := ARRAY[
    'public.get_lucia_organization_context(uuid,text,uuid)'::regprocedure,
    'public.get_lucia_collaboration_context(uuid,text,uuid)'::regprocedure,
    'public.get_lucia_case_file_context(uuid,uuid)'::regprocedure,
    'public.get_lucia_certification_context(uuid,uuid)'::regprocedure,
    'public.get_lucia_certified_notification_context(uuid,uuid)'::regprocedure,
    'public.get_lucia_batch_signature_context(uuid,uuid)'::regprocedure,
    'public.get_lucia_credit_title_context(uuid,uuid)'::regprocedure,
    'public.get_lucia_form_context(uuid,uuid)'::regprocedure,
    'public.get_lucia_report_context(uuid,text,jsonb)'::regprocedure,
    'public.get_lucia_billing_context(uuid)'::regprocedure
  ];
  v_config TEXT[];
BEGIN
  FOREACH v_function IN ARRAY v_functions LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
      OR has_function_privilege('service_role', v_function, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc function_record,
          aclexplode(COALESCE(
            function_record.proacl,
            acldefault('f', function_record.proowner)
          )) privilege
        WHERE function_record.oid = v_function
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ) THEN
      RAISE EXCEPTION '% has an unsafe execute grant', v_function;
    END IF;
    IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION '% is unavailable to authenticated sessions', v_function;
    END IF;
    SELECT p.proconfig INTO v_config FROM pg_catalog.pg_proc p WHERE p.oid = v_function;
    IF NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) setting
      WHERE setting IN ('search_path=', 'search_path=""')
    ) THEN
      RAISE EXCEPTION '% does not have an empty search_path', v_function;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_workspace_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}'::jsonb::text, true);
  v_result := public.get_lucia_organization_context(v_workspace_id, NULL, NULL);
  IF v_result->>'error_code' <> 'AUTHENTICATION_REQUIRED' THEN
    RAISE EXCEPTION 'Anonymous organization context was not rejected';
  END IF;

  v_result := public.get_lucia_billing_context(v_workspace_id);
  IF v_result->>'error_code' <> 'AUTHENTICATION_REQUIRED' THEN
    RAISE EXCEPTION 'Anonymous billing context was not rejected';
  END IF;
END;
$$;
ROLLBACK;
