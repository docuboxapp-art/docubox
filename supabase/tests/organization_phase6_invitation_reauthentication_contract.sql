-- Organization phase 6 invitation and step-up authentication contract.
-- Read-only assertions run inside a transaction and are rolled back.

BEGIN;

DO $$
DECLARE
  is_rls_enabled BOOLEAN;
  is_security_definer BOOLEAN;
  configured_search_path TEXT[];
  accept_function_oid OID;
BEGIN
  SELECT c.relrowsecurity
    INTO is_rls_enabled
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'organization_reauthentication_sessions';

  IF is_rls_enabled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'RLS is not enabled on organization_reauthentication_sessions';
  END IF;

  IF has_table_privilege('anon', 'public.organization_reauthentication_sessions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.organization_reauthentication_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'Step-up authentication sessions are readable by a browser role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('organization_invitations', 'organization_reauthentication_sessions')
      AND column_name IN ('raw_token', 'token', 'secret', 'password')
  ) THEN
    RAISE EXCEPTION 'A raw secret column exists in an organization security table';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'organization_invitations'
      AND indexname = 'uq_org_invitations_pending_email'
  ) THEN
    RAISE EXCEPTION 'Pending invitation email uniqueness is not enforced';
  END IF;

  SELECT p.oid, p.prosecdef, p.proconfig
    INTO accept_function_oid, is_security_definer, configured_search_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'accept_organization_invitation'
  LIMIT 1;

  IF accept_function_oid IS NULL OR is_security_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'accept_organization_invitation must be SECURITY DEFINER';
  END IF;

  IF configured_search_path IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(configured_search_path) setting
       WHERE setting = 'search_path=public, extensions'
     ) THEN
    RAISE EXCEPTION 'accept_organization_invitation must pin its search_path';
  END IF;

  IF has_function_privilege('anon', accept_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users can execute accept_organization_invitation';
  END IF;

  IF NOT has_function_privilege('authenticated', accept_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users cannot execute accept_organization_invitation';
  END IF;
END;
$$;

ROLLBACK;
