-- Organization phase 11 branding backend boundary contract.

BEGIN;
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.organization_communication_templates', 'INSERT')
    OR has_table_privilege('authenticated', 'public.organization_sender_domains', 'UPDATE') THEN
    RAISE EXCEPTION 'Organization branding resources remain directly browser-writable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND policyname IN ('org_branding_manage_templates', 'org_branding_manage_domains')
  ) THEN
    RAISE EXCEPTION 'A direct browser branding mutation policy still exists';
  END IF;
END;
$$;
ROLLBACK;
