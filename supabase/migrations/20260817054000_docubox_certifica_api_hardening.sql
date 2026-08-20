-- All mutations flow through authenticated backend routes using service_role.
-- Authenticated clients retain tenant-scoped read access only.
REVOKE INSERT, UPDATE ON public.certification_cases FROM authenticated;
DROP POLICY IF EXISTS certification_cases_insert ON public.certification_cases;
DROP POLICY IF EXISTS certification_cases_update ON public.certification_cases;

COMMENT ON TABLE public.certification_cases IS
  'Workflow container for Docubox Certifica. Authenticated clients have tenant-scoped read access; mutations are backend-only.';
