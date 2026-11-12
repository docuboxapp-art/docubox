-- A new untemplated draft must not be usable as a path around policy validation.
-- This gate does not execute approvals, signatures or paid services.
CREATE OR REPLACE FUNCTION public.case_review_instance_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE snapshot jsonb; needs_execution boolean;
BEGIN
  needs_execution := NEW.status NOT IN ('draft','cancelled')
    OR NEW.closed_at IS NOT NULL OR NEW.sealed_snapshot IS NOT NULL
    OR NEW.closure_status NOT IN ('pending','failed');
  IF TG_OP = 'UPDATE' THEN
    needs_execution := needs_execution AND
      (NEW.status IS DISTINCT FROM OLD.status OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
        OR NEW.closure_status IS DISTINCT FROM OLD.closure_status
        OR NEW.root_hash IS DISTINCT FROM OLD.root_hash
        OR NEW.sealed_snapshot IS DISTINCT FROM OLD.sealed_snapshot);
  END IF;
  IF NOT needs_execution THEN RETURN NEW; END IF;
  IF NEW.template_version_id IS NULL THEN
    RAISE EXCEPTION 'CASE_REVIEW_POLICY_REQUIRED';
  END IF;
  SELECT version.snapshot INTO snapshot FROM public.case_file_template_versions version
    WHERE version.id = NEW.template_version_id AND version.workspace_id = NEW.workspace_id;
  IF snapshot #>> '{requirements_schema,reviewPolicy,version}' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'CASE_REVIEW_POLICY_REQUIRED';
  END IF;
  -- The next migration must install and verify the transition adapters before
  -- this boundary can be opened. Client-controlled flags cannot open it.
  IF NOT (public.case_review_runtime_capabilities()->>'transitions')::boolean THEN
    RAISE EXCEPTION 'CASE_RUNTIME_UNAVAILABLE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.case_review_instance_guard() FROM PUBLIC, anon, authenticated;
