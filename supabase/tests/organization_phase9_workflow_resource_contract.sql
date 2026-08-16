-- Organization phase 9 workflow runtime and shared resource lifecycle contract.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organization_workflow_instances'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organization_workflow_step_instances'
  ) THEN
    RAISE EXCEPTION 'Organization workflow runtime tables are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'start_organization_workflow_instance'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'Workflow start RPC is not hardened as SECURITY DEFINER';
  END IF;

  IF has_function_privilege('anon', 'public.start_organization_workflow_instance(uuid,uuid,text,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role can start organization workflows';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'protect_published_organization_resource' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Published shared resources are not protected by an immutability trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_workflow_instances'
      AND policyname = 'org_members_read_workflow_instances'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_workflow_step_instances'
      AND policyname = 'org_members_read_workflow_steps'
  ) THEN
    RAISE EXCEPTION 'Workflow runtime RLS policies are missing';
  END IF;
END;
$$;

ROLLBACK;
