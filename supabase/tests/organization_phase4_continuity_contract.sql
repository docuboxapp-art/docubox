-- Organization phase 4 continuity contract.
-- This script is read-only and can be executed after the migration in any
-- environment. It raises an exception when a security invariant is missing.

BEGIN;

DO $$
DECLARE
  relation_name TEXT;
  function_name TEXT;
  is_rls_enabled BOOLEAN;
  is_security_definer BOOLEAN;
  configured_search_path TEXT[];
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'organization_member_offboarding_jobs',
    'organization_ownership_transfers'
  ] LOOP
    SELECT c.relrowsecurity
      INTO is_rls_enabled
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = relation_name;

    IF is_rls_enabled IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', relation_name;
    END IF;

    IF has_table_privilege('anon', format('public.%I', relation_name), 'SELECT')
       OR has_table_privilege('authenticated', format('public.%I', relation_name), 'SELECT') THEN
      RAISE EXCEPTION 'Direct client reads must stay revoked on public.%', relation_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_member_offboarding_jobs'
      AND policyname = 'service_manage_org_offboarding'
      AND 'service_role' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Service-role offboarding policy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_ownership_transfers'
      AND policyname = 'service_manage_org_ownership_transfers'
      AND 'service_role' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Service-role ownership-transfer policy is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_ownership_transfers'
      AND column_name IN ('raw_token', 'confirmation_token', 'token')
  ) THEN
    RAISE EXCEPTION 'A raw ownership-transfer token column is present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_ownership_transfers'
      AND column_name = 'token_hash'
  ) THEN
    RAISE EXCEPTION 'The ownership-transfer token hash column is missing';
  END IF;

  FOREACH function_name IN ARRAY ARRAY[
    'get_organization_member_offboarding_preview',
    'create_organization_member_offboarding_job',
    'execute_organization_member_offboarding_job',
    'cancel_organization_member_offboarding_job',
    'create_organization_ownership_transfer',
    'confirm_organization_ownership_transfer',
    'cancel_organization_ownership_transfer'
  ] LOOP
    SELECT p.prosecdef, p.proconfig
      INTO is_security_definer, configured_search_path
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = function_name
    LIMIT 1;

    IF is_security_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Function public.% must be SECURITY DEFINER', function_name;
    END IF;

    IF configured_search_path IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM unnest(configured_search_path) setting
         WHERE setting = 'search_path=public'
       ) THEN
      RAISE EXCEPTION 'Function public.% must pin search_path to public', function_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.organization_member_offboarding_jobs
    WHERE member_id = successor_member_id
  ) THEN
    RAISE EXCEPTION 'An offboarding job assigns the target as its own successor';
  END IF;

  IF EXISTS (
    SELECT workspace_id
    FROM public.organization_ownership_transfers
    WHERE status = 'pending'
    GROUP BY workspace_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A workspace has more than one pending ownership transfer';
  END IF;
END;
$$;

ROLLBACK;
