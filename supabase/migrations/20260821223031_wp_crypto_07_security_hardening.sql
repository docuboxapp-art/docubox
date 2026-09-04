-- WP-CRYPTO-07: hardening of privileged database and certification access.
-- This migration is additive: it preserves historic documents and only narrows
-- access to certification records and the helpers used by their RLS policies.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- The repository has historic SECURITY DEFINER functions that use unqualified
-- references. Keep their current behavior while preventing a caller-controlled
-- search_path from taking precedence over PostgreSQL built-ins.
DO $$
DECLARE
  function_identity text;
BEGIN
  FOR function_identity IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public', function_identity);
  END LOOP;
END;
$$;

-- These are called by RLS policies. Restrict their invocation to the roles that
-- require them rather than leaving the default PUBLIC EXECUTE grant in place.
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF to_regprocedure('public.current_user_email()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.current_user_email() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated, service_role';
  END IF;
END;
$$;

-- Certification records are tenant data. Document ownership alone is not a
-- tenant boundary, so use the document workspace and active workspace
-- membership for all authenticated reads.
DROP POLICY IF EXISTS certification_owner_read ON public.document_certifications;
DROP POLICY IF EXISTS certification_authorized_read ON public.document_certifications;
DROP POLICY IF EXISTS certification_workspace_member_read ON public.document_certifications;
CREATE POLICY certification_workspace_member_read
  ON public.document_certifications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.documentos d
      WHERE d.id = document_certifications.document_id
        AND (
          (
            d.workspace_id IS NOT NULL
            AND d.workspace_id = document_certifications.workspace_id
            AND document_certifications.tenant_id = d.workspace_id
            AND public.is_workspace_member(d.workspace_id)
          )
          OR (
            d.workspace_id IS NULL
            AND d.owner_id = auth.uid()
            AND document_certifications.tenant_id = d.owner_id
          )
        )
    )
  );

CREATE INDEX IF NOT EXISTS idx_document_certifications_workspace_document
  ON public.document_certifications(workspace_id, document_id, created_at DESC);

-- Related evidence is readable only through a certification already authorized
-- by the policy above. There are intentionally no client write policies: the
-- backend orchestrator runs with service_role and records an audit event.
DROP POLICY IF EXISTS evidence_manifests_workspace_member_read ON public.evidence_manifests;
DROP POLICY IF EXISTS evidence_manifests_authorized_read ON public.evidence_manifests;
CREATE POLICY evidence_manifests_workspace_member_read
  ON public.evidence_manifests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.document_certifications certification
      WHERE certification.evidence_manifest_id = evidence_manifests.id
    )
  );

DROP POLICY IF EXISTS evidence_manifest_items_workspace_member_read ON public.evidence_manifest_items;
DROP POLICY IF EXISTS evidence_manifest_items_authorized_read ON public.evidence_manifest_items;
CREATE POLICY evidence_manifest_items_workspace_member_read
  ON public.evidence_manifest_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.evidence_manifests manifest
      WHERE manifest.id = evidence_manifest_items.evidence_manifest_id
    )
  );

DROP POLICY IF EXISTS timestamp_records_workspace_member_read ON public.timestamp_records;
DROP POLICY IF EXISTS timestamp_records_authorized_read ON public.timestamp_records;
CREATE POLICY timestamp_records_workspace_member_read
  ON public.timestamp_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.document_certifications certification
      WHERE certification.id = timestamp_records.document_certification_id
    )
  );

-- Storage artifacts must not be replaced after creation. Existing artifacts are
-- intentionally retained; a new version needs a new path and audit event.
DROP POLICY IF EXISTS certification_artifacts_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS certification_artifacts_authenticated_delete ON storage.objects;
CREATE POLICY certification_artifacts_authenticated_update
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'certification-artifacts')
  WITH CHECK (bucket_id <> 'certification-artifacts');
CREATE POLICY certification_artifacts_authenticated_delete
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'certification-artifacts');

;
