-- Run after applying 20260905174616_lucia_document_intelligence.sql in staging.

BEGIN;

DO $$
DECLARE
  v_table_name TEXT;
  v_relation REGCLASS;
  v_rls_enabled BOOLEAN;
  v_rls_forced BOOLEAN;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'ai_document_profiles',
    'ai_document_extracted_fields',
    'ai_document_entities',
    'ai_document_obligations',
    'ai_document_classifications',
    'ai_document_completeness_checks',
    'ai_document_processing_jobs'
  ]
  LOOP
    v_relation := to_regclass(format('public.%I', v_table_name));
    IF v_relation IS NULL THEN
      RAISE EXCEPTION 'Missing Phase 4 table: %', v_table_name;
    END IF;

    SELECT relrowsecurity, relforcerowsecurity
    INTO v_rls_enabled, v_rls_forced
    FROM pg_catalog.pg_class
    WHERE oid = v_relation;

    IF NOT v_rls_enabled OR NOT v_rls_forced THEN
      RAISE EXCEPTION 'RLS is not enabled and forced on %', v_table_name;
    END IF;
    IF has_table_privilege('anon', v_relation, 'SELECT') THEN
      RAISE EXCEPTION 'anon can read %', v_table_name;
    END IF;
    IF NOT has_table_privilege('authenticated', v_relation, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated cannot read %', v_table_name;
    END IF;
    IF has_table_privilege('authenticated', v_relation, 'INSERT')
      OR has_table_privilege('authenticated', v_relation, 'UPDATE')
      OR has_table_privilege('authenticated', v_relation, 'DELETE') THEN
      RAISE EXCEPTION 'authenticated has a write grant on %', v_table_name;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_function REGPROCEDURE := 'public.can_read_document_intelligence(uuid,uuid)'::REGPROCEDURE;
  v_config TEXT[];
  v_allowed BOOLEAN;
BEGIN
  IF has_function_privilege('anon', v_function, 'EXECUTE')
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc function_record,
        aclexplode(COALESCE(function_record.proacl, acldefault('f', function_record.proowner))) privilege
      WHERE function_record.oid = v_function
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Document intelligence ACL helper has an unsafe execute grant';
  END IF;
  IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Document intelligence ACL helper is unavailable to authenticated';
  END IF;

  SELECT proconfig INTO v_config FROM pg_catalog.pg_proc WHERE oid = v_function;
  IF NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) setting
    WHERE setting IN ('search_path=', 'search_path=""')
  ) THEN
    RAISE EXCEPTION 'Document intelligence ACL helper does not have an empty search_path';
  END IF;

  PERFORM set_config('request.jwt.claims', '{}'::JSONB::TEXT, true);
  v_allowed := public.can_read_document_intelligence(gen_random_uuid(), gen_random_uuid());
  IF v_allowed THEN
    RAISE EXCEPTION 'Anonymous claims unexpectedly passed document intelligence ACL';
  END IF;
END;
$$;

DO $$
DECLARE
  v_sensitive_column TEXT;
BEGIN
  SELECT pg_catalog.format('%I.%I', columns.table_name, columns.column_name)
  INTO v_sensitive_column
  FROM information_schema.columns
  WHERE columns.table_schema = 'public'
    AND columns.table_name IN (
      'ai_document_profiles',
      'ai_document_extracted_fields',
      'ai_document_entities',
      'ai_document_obligations',
      'ai_document_classifications',
      'ai_document_completeness_checks',
      'ai_document_processing_jobs'
    )
    AND columns.column_name ~* '(token|otp|biometric|private_key|certificate_private|storage_path|password)'
  LIMIT 1;

  IF v_sensitive_column IS NOT NULL THEN
    RAISE EXCEPTION 'Sensitive field exposed by Phase 4 schema: %', v_sensitive_column;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants grants
    WHERE grants.table_schema = 'public'
      AND grants.table_name IN (
        'ai_document_profiles',
        'ai_document_extracted_fields',
        'ai_document_entities',
        'ai_document_obligations',
        'ai_document_classifications',
        'ai_document_completeness_checks',
        'ai_document_processing_jobs'
      )
      AND grants.grantee IN ('anon', 'authenticated')
      AND grants.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'Client role has a write grant on a Phase 4 table';
  END IF;
END;
$$;

ROLLBACK;
