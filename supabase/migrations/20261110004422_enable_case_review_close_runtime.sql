CREATE OR REPLACE FUNCTION public.case_review_runtime_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('transitions',true,'versionedEvidence',true,'approval',true,'signatures',true,'version',1);
$$;
