-- Sensitive security and certificate mutations are backend-only.

DROP POLICY IF EXISTS "org_security_manage_networks" ON public.organization_trusted_networks;
DROP POLICY IF EXISTS "org_security_manage_alerts" ON public.organization_security_alert_rules;
DROP POLICY IF EXISTS "org_admin_manage_certificates" ON public.organization_certificates;
DROP POLICY IF EXISTS "org_certificates_manage_permissions" ON public.organization_certificate_permissions;

REVOKE INSERT, UPDATE, DELETE ON public.organization_trusted_networks FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_security_alert_rules FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_certificates FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_certificate_permissions FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_organization_session(UUID, UUID, TEXT) FROM authenticated;

COMMENT ON TABLE public.organization_trusted_networks IS
  'Trusted network rules. Mutations are validated by the organization security backend and require recent reauthentication.';
COMMENT ON TABLE public.organization_certificates IS
  'Public certificate metadata and opaque custody references only. Private keys and passphrases are prohibited.';
