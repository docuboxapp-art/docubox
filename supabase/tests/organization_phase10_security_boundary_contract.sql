-- Organization phase 10 sensitive security boundary contract.

BEGIN;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.organization_trusted_networks', 'INSERT')
    OR has_table_privilege('authenticated', 'public.organization_security_alert_rules', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.organization_certificates', 'INSERT')
    OR has_table_privilege('authenticated', 'public.organization_certificate_permissions', 'DELETE') THEN
    RAISE EXCEPTION 'Sensitive organization security tables remain browser-writable';
  END IF;

  IF has_function_privilege('authenticated', 'public.revoke_organization_session(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Organization sessions can be revoked without the backend step-up boundary';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND policyname IN ('org_security_manage_networks', 'org_security_manage_alerts', 'org_admin_manage_certificates', 'org_certificates_manage_permissions')
  ) THEN
    RAISE EXCEPTION 'A direct browser mutation policy still exists for sensitive organization resources';
  END IF;
END;
$$;

ROLLBACK;
