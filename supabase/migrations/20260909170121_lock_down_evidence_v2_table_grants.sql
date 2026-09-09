-- Evidence Package v2 is append-only through trusted backend services.
-- RLS protects SELECT; clients must never receive table-level mutation or
-- TRUNCATE privileges because TRUNCATE bypasses row-level policies.
REVOKE ALL PRIVILEGES ON TABLE public.evidence_packages
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.evidence_package_artifacts
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.evidence_packages TO authenticated;
GRANT SELECT ON TABLE public.evidence_package_artifacts TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.evidence_packages TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.evidence_package_artifacts TO service_role;
