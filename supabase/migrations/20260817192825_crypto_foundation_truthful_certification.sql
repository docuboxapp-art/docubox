-- WP-CRYPTO-01: exact document version, truthful capability state and
-- immutable source bytes. Additive only; existing certification data remains.

ALTER TABLE public.document_certifications
  ADD COLUMN IF NOT EXISTS document_version_id UUID,
  ADD COLUMN IF NOT EXISTS certification_type TEXT NOT NULL DEFAULT 'integrity_evidence',
  ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS source_document_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS source_document_hash_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS source_document_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS source_storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS source_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS integrity_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pdf_signature_status TEXT NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS certificate_status TEXT NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS timestamp_status TEXT NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS evidence_schema_version TEXT NOT NULL DEFAULT 'docubox-evidence-v1',
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_detail TEXT;

-- The preflight audit found no historical rows, but this remains safe if a
-- deployment receives a certification before the migration is applied.
UPDATE public.document_certifications AS certification
SET document_version_id = version.id
FROM public.document_versions AS version
WHERE certification.document_version_id IS NULL
  AND version.document_id = certification.document_id
  AND version.version_number = certification.document_version;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_certifications_document_version_id_fkey'
      AND conrelid = 'public.document_certifications'::regclass
  ) THEN
    ALTER TABLE public.document_certifications
      ADD CONSTRAINT document_certifications_document_version_id_fkey
      FOREIGN KEY (document_version_id)
      REFERENCES public.document_versions(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_document_version_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_certifications_execution_status_check'
      AND conrelid = 'public.document_certifications'::regclass
  ) THEN
    ALTER TABLE public.document_certifications
      ADD CONSTRAINT document_certifications_execution_status_check
      CHECK (execution_status IN ('created','processing','completed','failed')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_certifications_crypto_capabilities_check'
      AND conrelid = 'public.document_certifications'::regclass
  ) THEN
    ALTER TABLE public.document_certifications
      ADD CONSTRAINT document_certifications_crypto_capabilities_check
      CHECK (
        integrity_status IN ('not_configured','pending','development','valid','invalid','unavailable','not_applicable')
        AND pdf_signature_status IN ('not_configured','pending','development','valid','invalid','unavailable','not_applicable')
        AND certificate_status IN ('not_configured','pending','development','valid','invalid','unavailable','not_applicable')
        AND timestamp_status IN ('not_configured','pending','development','valid','invalid','unavailable','not_applicable')
        AND verification_status IN ('not_configured','pending','development','valid','invalid','unavailable','not_applicable')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_certifications_source_hash_check'
      AND conrelid = 'public.document_certifications'::regclass
  ) THEN
    ALTER TABLE public.document_certifications
      ADD CONSTRAINT document_certifications_source_hash_check
      CHECK (
        source_document_hash IS NULL
        OR (
          source_document_hash ~ '^[0-9a-f]{64}$'
          AND source_document_hash_algorithm = 'SHA-256'
          AND source_document_size_bytes >= 0
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_execution_status_check;
ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_crypto_capabilities_check;
ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_source_hash_check;

CREATE INDEX IF NOT EXISTS idx_document_certifications_version
  ON public.document_certifications(document_version_id, created_at DESC)
  WHERE document_version_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_certification_version_idempotency
  ON public.document_certifications(
    tenant_id,
    document_version_id,
    certification_type,
    idempotency_key
  )
  WHERE document_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_certification_source_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.document_version_id IS NOT NULL
    AND OLD.execution_status <> 'created'
    AND (
      NEW.document_id IS DISTINCT FROM OLD.document_id
      OR NEW.document_version_id IS DISTINCT FROM OLD.document_version_id
      OR NEW.source_document_hash IS DISTINCT FROM OLD.source_document_hash
      OR NEW.source_document_hash_algorithm IS DISTINCT FROM OLD.source_document_hash_algorithm
      OR NEW.source_document_size_bytes IS DISTINCT FROM OLD.source_document_size_bytes
      OR NEW.source_storage_bucket IS DISTINCT FROM OLD.source_storage_bucket
      OR NEW.source_storage_path IS DISTINCT FROM OLD.source_storage_path
    )
  THEN
    RAISE EXCEPTION 'certification_source_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_certification_source_mutation
  ON public.document_certifications;
CREATE TRIGGER prevent_certification_source_mutation
  BEFORE UPDATE ON public.document_certifications
  FOR EACH ROW EXECUTE FUNCTION public.prevent_certification_source_mutation();

CREATE OR REPLACE FUNCTION public.prevent_frozen_document_version_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL OR OLD.status IN ('sent','signed') THEN
    RAISE EXCEPTION 'frozen_document_version' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_frozen_document_version_delete
  ON public.document_versions;
CREATE TRIGGER prevent_frozen_document_version_delete
  BEFORE DELETE ON public.document_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_frozen_document_version_delete();

COMMENT ON COLUMN public.document_certifications.document_version_id IS
  'Exact immutable document version used as the certification source.';
COMMENT ON COLUMN public.document_certifications.source_document_hash IS
  'SHA-256 over the exact source bytes downloaded from private Storage.';
COMMENT ON COLUMN public.document_certifications.execution_status IS
  'Workflow execution state; independent from cryptographic validity.';
COMMENT ON COLUMN public.document_certifications.evidence_schema_version IS
  'Canonical evidence representation version. Historical records retain their original version.';
