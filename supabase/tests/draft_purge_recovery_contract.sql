-- Run after 20260905190000_allow_draft_purge_during_recovery_secure.sql.

BEGIN;

DO $$
DECLARE
  v_function REGPROCEDURE := 'public.purge_document_bundle(uuid,uuid)'::REGPROCEDURE;
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
    RAISE EXCEPTION 'purge_document_bundle must have an empty search_path';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
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
    RAISE EXCEPTION 'purge_document_bundle has an unsafe execute grant';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute purge_document_bundle';
  END IF;

  IF v_definition NOT LIKE '%document_purge_backend_only%'
    OR v_definition NOT LIKE '%document_purge_requires_trash%'
    OR v_definition NOT LIKE '%document_purge_legal_hold%'
    OR v_definition NOT LIKE '%document_purge_retention_active%'
    OR v_definition NOT LIKE '%document_purge_recovery_period%'
    OR v_definition NOT LIKE '%borrador%'
    OR v_definition NOT LIKE '%restore_until%' THEN
    RAISE EXCEPTION 'purge_document_bundle is missing required lifecycle guards';
  END IF;
END;
$$;

ROLLBACK;
