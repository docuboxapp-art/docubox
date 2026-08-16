-- This operational diagnostics view exposes encryption metadata and is only
-- intended for trusted backend maintenance. Preserve the view definition and
-- data while enforcing caller permissions and removing Data API access.

ALTER VIEW public.v_documents_missing_participant_deks
  SET (security_invoker = true);

REVOKE ALL ON TABLE public.v_documents_missing_participant_deks FROM PUBLIC;
REVOKE ALL ON TABLE public.v_documents_missing_participant_deks FROM anon;
REVOKE ALL ON TABLE public.v_documents_missing_participant_deks FROM authenticated;

GRANT SELECT ON TABLE public.v_documents_missing_participant_deks TO service_role;

COMMENT ON VIEW public.v_documents_missing_participant_deks IS
  'Backend-only diagnostic view for participant DEK coverage. Never exposed to client roles.';
