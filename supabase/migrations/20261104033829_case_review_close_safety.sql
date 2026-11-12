-- Enforce the same unavailable-service boundary as the application. This is a
-- safety gate, not a substitute for the still-unconnected transition adapters.
CREATE OR REPLACE FUNCTION public.case_review_runtime_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('rulesVersion', 1, 'transitions', false,
    'versionedEvidence', false, 'approval', false, 'signatures', false);
$$;
REVOKE ALL ON FUNCTION public.case_review_runtime_capabilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.case_review_runtime_capabilities() TO authenticated;

CREATE OR REPLACE FUNCTION public.case_review_publication_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE policy jsonb; capabilities jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'CASE_TEMPLATE_OWNERSHIP_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    -- Saving editor_draft and pausing/archiving never republishes a version.
    IF NEW.status = OLD.status AND ROW(NEW.name, NEW.description, NEW.case_type,
      NEW.case_subtype, NEW.requirements_schema, NEW.forms_schema,
      NEW.identity_schema, NEW.milestones_schema, NEW.closure_rules_schema)
      IS NOT DISTINCT FROM ROW(OLD.name, OLD.description, OLD.case_type,
      OLD.case_subtype, OLD.requirements_schema, OLD.forms_schema,
      OLD.identity_schema, OLD.milestones_schema, OLD.closure_rules_schema) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  policy := NEW.requirements_schema -> 'reviewPolicy';
  IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR policy ->> 'version' IS DISTINCT FROM '1'
    OR policy ->> 'reviewTiming' NOT IN ('progressive','after_collection')
    OR policy #>> '{completion,mode}' NOT IN ('automatic','manual')
    OR jsonb_typeof(policy #> '{approval,enabled}') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'CASE_REVIEW_POLICY_INVALID';
  END IF;
  IF coalesce(policy ->> 'reviewTiming','') = '' OR coalesce(policy #>> '{completion,mode}','') = '' THEN
    RAISE EXCEPTION 'CASE_REVIEW_POLICY_INVALID';
  END IF;
  IF (policy #>> '{approval,enabled}')::boolean
    AND coalesce(policy #>> '{approval,role}','') NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'CASE_APPROVER_REQUIRED';
  END IF;
  IF policy #>> '{completion,mode}' = 'manual'
    AND coalesce(policy #>> '{completion,role}','') NOT IN ('owner','admin','member') THEN
    RAISE EXCEPTION 'CASE_CLOSER_REQUIRED';
  END IF;
  capabilities := public.case_review_runtime_capabilities();
  IF NOT (capabilities ->> 'transitions')::boolean
    OR NOT (capabilities ->> 'versionedEvidence')::boolean THEN
    RAISE EXCEPTION 'CASE_RUNTIME_UNAVAILABLE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.case_review_publication_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER case_review_publication_guard_before
  BEFORE INSERT OR UPDATE ON public.case_file_templates
  FOR EACH ROW EXECUTE FUNCTION public.case_review_publication_guard();

-- Restrictive policies compose with existing row policies and never add access.
-- Inactive, suspended and expired memberships cannot operate on case data.
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['case_file_templates','case_files',
    'case_file_participants','case_file_invitations','case_file_requirements',
    'case_file_documents','case_file_document_versions','case_file_forms',
    'case_file_form_submissions','case_file_identity_checks','case_file_milestones',
    'case_file_tasks','case_file_reviews','case_file_observations','case_file_signatures',
    'case_file_audit_events','case_file_closure_manifests','case_file_closure_certificates','case_file_shares']
  LOOP
    EXECUTE format('CREATE POLICY case_active_membership ON public.%I AS RESTRICTIVE
      FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.workspace_members member
        WHERE member.workspace_id = %I.workspace_id AND member.user_id = (SELECT auth.uid())
          AND member.status = ''active'' AND (member.access_expires_at IS NULL OR member.access_expires_at > now())))
      WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members member
        WHERE member.workspace_id = %I.workspace_id AND member.user_id = (SELECT auth.uid())
          AND member.status = ''active'' AND (member.access_expires_at IS NULL OR member.access_expires_at > now())))',
      relation_name, relation_name, relation_name);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_review_instance_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.template_version_id IS NOT NULL THEN
    SELECT version.snapshot INTO snapshot FROM public.case_file_template_versions version
      WHERE version.id = NEW.template_version_id AND version.workspace_id = NEW.workspace_id;
    IF snapshot #>> '{requirements_schema,reviewPolicy,version}' = '1' THEN
      RAISE EXCEPTION 'CASE_RUNTIME_UNAVAILABLE';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.template_version_id IS NOT NULL THEN
    SELECT version.snapshot INTO snapshot FROM public.case_file_template_versions version
      WHERE version.id = NEW.template_version_id AND version.workspace_id = NEW.workspace_id;
    IF snapshot #>> '{requirements_schema,reviewPolicy,version}' = '1'
      AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
        OR NEW.sealed_snapshot IS DISTINCT FROM OLD.sealed_snapshot) THEN
      RAISE EXCEPTION 'CASE_RUNTIME_UNAVAILABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.case_review_instance_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER case_review_instance_guard_before BEFORE INSERT OR UPDATE ON public.case_files
  FOR EACH ROW EXECUTE FUNCTION public.case_review_instance_guard();
