-- Brand and sender configuration is validated by the organization backend.

DROP POLICY IF EXISTS "org_branding_manage_templates" ON public.organization_communication_templates;
DROP POLICY IF EXISTS "org_branding_manage_domains" ON public.organization_sender_domains;
REVOKE INSERT, UPDATE, DELETE ON public.organization_communication_templates FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_sender_domains FROM authenticated;

COMMENT ON TABLE public.organization_sender_domains IS
  'Organization sender domains. A pending row is not considered verified until a backend DNS check succeeds.';
