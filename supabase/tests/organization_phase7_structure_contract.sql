-- Organization phase 7 structure and role-governance contract.
-- Read-only assertions run inside a transaction and are rolled back.

BEGIN;

DO $$
DECLARE
  unit_members_oid OID;
  is_security_definer BOOLEAN;
  configured_search_path TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_units'
      AND column_name IN ('internal_key', 'unit_type', 'deputy_member_id', 'cost_center_id', 'policy_overrides', 'archived_at')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 6
  ) THEN
    RAISE EXCEPTION 'Organization units are missing governance columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_roles'
      AND column_name IN ('status', 'scope_type', 'scope_config', 'archived_at')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 4
  ) THEN
    RAISE EXCEPTION 'Organization roles are missing lifecycle or scope columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'validate_organization_unit_hierarchy'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Organization unit hierarchy validation trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'protect_organization_system_roles'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'System role protection trigger is missing';
  END IF;

  SELECT p.oid, p.prosecdef, p.proconfig
    INTO unit_members_oid, is_security_definer, configured_search_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'set_organization_unit_members'
  LIMIT 1;

  IF unit_members_oid IS NULL OR is_security_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'set_organization_unit_members must be SECURITY DEFINER';
  END IF;

  IF configured_search_path IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM unnest(configured_search_path) setting
       WHERE setting = 'search_path=public, extensions'
     ) THEN
    RAISE EXCEPTION 'set_organization_unit_members must pin its search_path';
  END IF;

  IF has_function_privilege('anon', unit_members_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users can replace organization unit memberships';
  END IF;

  IF NOT has_function_privilege('authenticated', unit_members_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated organization administrators cannot replace unit memberships';
  END IF;
END;
$$;

ROLLBACK;
