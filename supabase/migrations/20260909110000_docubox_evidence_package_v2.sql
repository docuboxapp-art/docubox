-- Docubox Evidence Package v2. Additive only: XML v1 and historical artifacts remain untouched.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('evidence-v2-artifacts', 'evidence-v2-artifacts', false, 10485760, ARRAY['application/xml'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS evidence_v2_artifacts_service_only ON storage.objects;
CREATE POLICY evidence_v2_artifacts_service_only
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'evidence-v2-artifacts')
  WITH CHECK (bucket_id = 'evidence-v2-artifacts');

CREATE TABLE IF NOT EXISTS public.evidence_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID,
  organization_id UUID,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  evidence_version TEXT NOT NULL DEFAULT '2.0' CHECK (evidence_version = '2.0'),
  schema_version TEXT NOT NULL DEFAULT '2.0' CHECK (schema_version = '2.0'),
  canonicalization_version TEXT NOT NULL DEFAULT 'docubox-evidence-root-v1',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','closing','closed','partially_certified','certified','verification_failed'
  )),
  document_final_sha256 CHAR(64),
  evidence_root_sha256 CHAR(64),
  package_digest_sha256 CHAR(64),
  xml_sha256 CHAR(64),
  xml_storage_bucket TEXT NOT NULL DEFAULT 'evidence-v2-artifacts' CHECK (xml_storage_bucket = 'evidence-v2-artifacts'),
  xml_storage_path TEXT NOT NULL UNIQUE,
  docubox_signature JSONB,
  verification_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (document_final_sha256 IS NULL OR document_final_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (evidence_root_sha256 IS NULL OR evidence_root_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (package_digest_sha256 IS NULL OR package_digest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (xml_sha256 IS NULL OR xml_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (
    closed_at IS NULL OR (
      document_final_sha256 IS NOT NULL
      AND evidence_root_sha256 IS NOT NULL
      AND package_digest_sha256 IS NOT NULL
      AND xml_sha256 IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_packages_closed_document_version_v2_key
  ON public.evidence_packages(document_id, document_version_id, evidence_version)
  WHERE closed_at IS NOT NULL AND document_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS evidence_packages_document_created_idx
  ON public.evidence_packages(document_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS evidence_packages_tenant_status_idx
  ON public.evidence_packages(tenant_id, status, generated_at DESC);

CREATE TABLE IF NOT EXISTS public.evidence_package_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.evidence_packages(id) ON DELETE RESTRICT,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN (
    'rfc3161_token','opentimestamps_proof','nom151_constancia','pades_pdf','certificate','verification_report'
  )),
  artifact_status TEXT NOT NULL CHECK (artifact_status IN ('requested','pending','issued','verified','failed','revoked')),
  object_sha256 CHAR(64) NOT NULL CHECK (object_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  provider TEXT,
  issued_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(package_id, artifact_type, object_sha256, storage_path)
);
CREATE INDEX IF NOT EXISTS evidence_package_artifacts_package_idx
  ON public.evidence_package_artifacts(package_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.reject_closed_evidence_package_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'EVIDENCE_PACKAGE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_packages_immutable_after_close ON public.evidence_packages;
CREATE TRIGGER evidence_packages_immutable_after_close
  BEFORE UPDATE OR DELETE ON public.evidence_packages
  FOR EACH ROW EXECUTE FUNCTION public.reject_closed_evidence_package_mutation();

CREATE OR REPLACE FUNCTION public.reject_evidence_package_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'EVIDENCE_PACKAGE_ARTIFACT_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS evidence_package_artifacts_immutable ON public.evidence_package_artifacts;
CREATE TRIGGER evidence_package_artifacts_immutable
  BEFORE UPDATE OR DELETE ON public.evidence_package_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.reject_evidence_package_artifact_mutation();

ALTER TABLE public.evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_package_artifacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.evidence_packages FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evidence_package_artifacts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.evidence_packages TO authenticated;
GRANT SELECT ON TABLE public.evidence_package_artifacts TO authenticated;

DROP POLICY IF EXISTS evidence_packages_authorized_select ON public.evidence_packages;
CREATE POLICY evidence_packages_authorized_select
  ON public.evidence_packages FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

DROP POLICY IF EXISTS evidence_package_artifacts_authorized_select ON public.evidence_package_artifacts;
CREATE POLICY evidence_package_artifacts_authorized_select
  ON public.evidence_package_artifacts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.evidence_packages package
      WHERE package.id = evidence_package_artifacts.package_id
        AND public.can_access_documento(package.document_id)
    )
  );

COMMENT ON TABLE public.evidence_packages IS
  'Immutable Docubox Evidence Package v2 records. Historical XML v1 remains in documentos.';
COMMENT ON COLUMN public.evidence_packages.xml_storage_path IS
  'Versioned immutable object key in the private evidence-v2-artifacts bucket. Package generation must never use Storage upsert.';
