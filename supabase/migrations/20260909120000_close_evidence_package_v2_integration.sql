-- Completes the additive Evidence Package v2 integration. Historical v1 XML
-- and already-closed v2 packages remain untouched.

ALTER TABLE public.evidence_packages
  ADD COLUMN IF NOT EXISTS public_verification_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS source_certification_id uuid REFERENCES public.document_certifications(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS evidence_packages_public_verification_token_key
  ON public.evidence_packages(public_verification_token);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_packages_closed_legacy_document_v2_key
  ON public.evidence_packages(document_id, evidence_version)
  WHERE closed_at IS NOT NULL AND document_version_id IS NULL;

ALTER TABLE public.evidence_package_artifacts
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid;

ALTER TABLE public.evidence_package_artifacts
  DROP CONSTRAINT IF EXISTS evidence_package_artifacts_source_check,
  ADD CONSTRAINT evidence_package_artifacts_source_check CHECK (
    (source_table IS NULL AND source_record_id IS NULL)
    OR (source_table IN (
      'document_certifications', 'timestamp_records', 'nom151_constancias_doc',
      'document_blockchain_evidence', 'signature_evidence'
    ) AND source_record_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS evidence_package_artifacts_source_key
  ON public.evidence_package_artifacts(package_id, artifact_type, source_table, source_record_id)
  WHERE source_table IS NOT NULL AND source_record_id IS NOT NULL;

ALTER TABLE public.evidence_package_artifacts
  DROP CONSTRAINT IF EXISTS evidence_package_artifacts_artifact_type_check,
  ADD CONSTRAINT evidence_package_artifacts_artifact_type_check CHECK (artifact_type IN (
    'rfc3161_token', 'opentimestamps_proof', 'nom151_constancia', 'pades_pdf',
    'certificate', 'verification_report', 'efirma_signature_bundle',
    'autograph_signature_image', 'autograph_signature_strokes'
  ));

ALTER TABLE public.signature_evidence
  ADD COLUMN IF NOT EXISTS efirma_bundle_path text,
  ADD COLUMN IF NOT EXISTS efirma_bundle_sha256 text;

ALTER TABLE public.signature_evidence
  DROP CONSTRAINT IF EXISTS signature_evidence_efirma_bundle_sha256_valid,
  ADD CONSTRAINT signature_evidence_efirma_bundle_sha256_valid CHECK (
    efirma_bundle_sha256 IS NULL OR efirma_bundle_sha256 ~ '^[a-f0-9]{64}$'
  );

-- Repair schema drift in environments where the original metadata migration
-- was recorded but the table was not materialized. The DDL matches the
-- original additive model and preserves its immutable document scope.
CREATE TABLE IF NOT EXISTS public.document_additional_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  document_version_number integer NOT NULL CHECK (document_version_number > 0),
  client_reference text NOT NULL,
  metadata_scope text NOT NULL CHECK (metadata_scope IN ('document', 'management')),
  data_type text NOT NULL CHECK (data_type IN (
    'text', 'number', 'date', 'datetime', 'boolean', 'list', 'currency',
    'reference', 'email', 'rfc', 'curp'
  )),
  name text NOT NULL,
  value_json jsonb NOT NULL,
  value_display text NOT NULL,
  snapshot_value jsonb,
  snapshot_hash char(64),
  locked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_additional_metadata_client_reference_unique UNIQUE (document_id, client_reference),
  CONSTRAINT document_additional_metadata_scope_lock CHECK (
    metadata_scope = 'management'
    OR (snapshot_value IS NOT NULL AND snapshot_hash IS NOT NULL AND locked_at IS NOT NULL)
  ),
  CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_document_additional_metadata_document
  ON public.document_additional_metadata(document_id, metadata_scope, created_at);
CREATE INDEX IF NOT EXISTS idx_document_additional_metadata_workspace
  ON public.document_additional_metadata(workspace_id, metadata_scope, created_at DESC);

CREATE OR REPLACE FUNCTION public.protect_document_additional_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.metadata_scope = 'document' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'DOCUMENT_METADATA_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.document_id := OLD.document_id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.document_version_id := OLD.document_version_id;
    NEW.document_version_number := OLD.document_version_number;
    NEW.client_reference := OLD.client_reference;
    NEW.metadata_scope := OLD.metadata_scope;
    NEW.data_type := OLD.data_type;
    NEW.name := OLD.name;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS prevent_locked_document_metadata_mutation
  ON public.document_additional_metadata;
CREATE TRIGGER prevent_locked_document_metadata_mutation
  BEFORE UPDATE OR DELETE ON public.document_additional_metadata
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_additional_metadata();

ALTER TABLE public.document_additional_metadata ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_additional_metadata FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.document_additional_metadata FROM authenticated;
GRANT SELECT ON TABLE public.document_additional_metadata TO authenticated;

DROP POLICY IF EXISTS document_additional_metadata_select_authorized
  ON public.document_additional_metadata;
CREATE POLICY document_additional_metadata_select_authorized
  ON public.document_additional_metadata FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

COMMENT ON COLUMN public.evidence_packages.public_verification_token IS
  'Opaque identifier for a PII-minimized public verification result; it never grants artifact access.';
COMMENT ON COLUMN public.evidence_package_artifacts.source_record_id IS
  'Immutable provenance reference used for append-only, idempotent artifact synchronization.';
