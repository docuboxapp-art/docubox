-- Run after 20260905200000_fix_secure_vector_operator_resolution.sql.

BEGIN;

DO $$
DECLARE
  v_function REGPROCEDURE :=
    'public.match_document_chunks(public.vector,uuid,uuid,uuid[],double precision,integer)'::REGPROCEDURE;
  v_config TEXT[];
  v_definition TEXT;
BEGIN
  SELECT proconfig, pg_catalog.pg_get_functiondef(oid)
  INTO v_config, v_definition
  FROM pg_catalog.pg_proc
  WHERE oid = v_function;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(pg_catalog.coalesce(v_config, ARRAY[]::TEXT[])) setting
    WHERE setting IN ('search_path=', 'search_path=""')
  ) THEN
    RAISE EXCEPTION 'match_document_chunks must have an empty search_path';
  END IF;

  IF v_definition NOT LIKE '%OPERATOR(public.<=>)%'
    OR v_definition NOT LIKE '%public.can_access_documento%'
    OR v_definition NOT LIKE '%p_allowed_document_ids%' THEN
    RAISE EXCEPTION 'match_document_chunks is missing vector resolution or ACL guards';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc function_record,
        pg_catalog.aclexplode(
          pg_catalog.coalesce(function_record.proacl, pg_catalog.acldefault('f', function_record.proowner))
        ) privilege
      WHERE function_record.oid = v_function
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'match_document_chunks has an unsafe execute grant';
  END IF;

  IF NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute match_document_chunks';
  END IF;
END;
$$;

ROLLBACK;
