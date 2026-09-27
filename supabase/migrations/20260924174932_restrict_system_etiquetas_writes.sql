-- etiquetas is the seeded, shared Docubox catalog. Users may select its
-- entries but may not mutate labels visible to every other tenant.
DROP POLICY IF EXISTS "authenticated_manage_etiquetas" ON public.etiquetas;
REVOKE ALL ON TABLE public.etiquetas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.etiquetas TO authenticated;
