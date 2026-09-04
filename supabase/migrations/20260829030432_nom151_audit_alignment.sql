-- WP-NOM151-AUDIT-ALIGNMENT
-- Extends the existing NOM-151 table. Historical records are preserved and
-- remain unlinked when they certified an artifact predating PAdES-B-T.

ALTER TABLE public.nom151_constancias_doc
  ADD COLUMN IF NOT EXISTS document_version_id uuid REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS document_certification_id uuid REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS psc_name text,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS operation_id text,
  ADD COLUMN IF NOT EXISTS folio text,
  ADD COLUMN IF NOT EXISTS digest_algorithm text,
  ADD COLUMN IF NOT EXISTS document_digest text,
  ADD COLUMN IF NOT EXISTS pades_profile text,
  ADD COLUMN IF NOT EXISTS pades_revision text,
  ADD COLUMN IF NOT EXISTS source_storage_bucket text,
  ADD COLUMN IF NOT EXISTS source_storage_path text,
  ADD COLUMN IF NOT EXISTS source_artifact_kind text,
  ADD COLUMN IF NOT EXISTS artifact_format text,
  ADD COLUMN IF NOT EXISTS constancia_storage_path text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_subject text,
  ADD COLUMN IF NOT EXISTS certificate_issuer text,
  ADD COLUMN IF NOT EXISTS certificate_serial text,
  ADD COLUMN IF NOT EXISTS certificate_fingerprint text,
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.nom151_constancias_doc
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_environment_check,
  ADD CONSTRAINT nom151_constancias_doc_environment_check
    CHECK (environment IS NULL OR environment IN ('production','sandbox','unknown')),
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_verification_status_check,
  ADD CONSTRAINT nom151_constancias_doc_verification_status_check
    CHECK (verification_status IN ('not_requested','pending','verifying','verified','failed')),
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_digest_algorithm_check,
  ADD CONSTRAINT nom151_constancias_doc_digest_algorithm_check
    CHECK (digest_algorithm IS NULL OR digest_algorithm = 'SHA-256'),
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_document_digest_check,
  ADD CONSTRAINT nom151_constancias_doc_document_digest_check
    CHECK (document_digest IS NULL OR document_digest ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_constancia_fingerprint_check,
  ADD CONSTRAINT nom151_constancias_doc_constancia_fingerprint_check
    CHECK (certificate_fingerprint IS NULL OR certificate_fingerprint ~ '^[a-f0-9]{64}$');

UPDATE public.nom151_constancias_doc
SET
  provider = COALESCE(provider, 'nubarium-nom151'),
  psc_name = COALESCE(psc_name, CASE WHEN status = 'issued' THEN 'PSC World S.A. de C.V.' END),
  environment = COALESCE(environment, 'unknown'),
  operation_id = COALESCE(operation_id, NULLIF(nubarium_codigo_validacion, '')),
  folio = COALESCE(folio, NULLIF(nubarium_codigo_validacion, '')),
  digest_algorithm = COALESCE(digest_algorithm, 'SHA-256'),
  document_digest = COALESCE(
    document_digest,
    CASE
      WHEN lower(pdf_sha256_local) ~ '^[a-f0-9]{64}$' THEN lower(pdf_sha256_local)
      ELSE NULL
    END
  ),
  source_storage_bucket = COALESCE(source_storage_bucket, 'documents'),
  source_storage_path = COALESCE(source_storage_path, nubarium_request_payload->>'source_reference'),
  source_artifact_kind = COALESCE(source_artifact_kind, upper(nubarium_request_payload->>'source_kind')),
  artifact_format = COALESCE(artifact_format, 'RFC3161_TIME_STAMP_RESP_DER'),
  constancia_storage_path = COALESCE(constancia_storage_path, NULLIF(constancia_path, '')),
  issued_at = COALESCE(issued_at, CASE WHEN status = 'issued' THEN created_at END),
  provider_metadata = COALESCE(provider_metadata, '{}'::jsonb) || jsonb_build_object(
    'historical_record', true,
    'requires_revalidation', status = 'issued'
  )
WHERE provider IS NULL
   OR document_digest IS NULL
   OR source_storage_path IS NULL
   OR constancia_storage_path IS NULL;

CREATE INDEX IF NOT EXISTS idx_nom151_doc_version_digest
  ON public.nom151_constancias_doc(document_version_id, document_digest, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nom151_doc_certification
  ON public.nom151_constancias_doc(document_certification_id, created_at DESC)
  WHERE document_certification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nom151_doc_verification
  ON public.nom151_constancias_doc(verification_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nom151_verified_artifact_request
  ON public.nom151_constancias_doc(documento_id, document_version_id, document_digest, provider)
  WHERE document_version_id IS NOT NULL
    AND document_digest IS NOT NULL
    AND provider IS NOT NULL
    AND status IN ('processing','issued');

DROP POLICY IF EXISTS "nom151_doc_service_write" ON public.nom151_constancias_doc;
CREATE POLICY "nom151_doc_service_write"
  ON public.nom151_constancias_doc
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "nom151_doc_owner_read" ON public.nom151_constancias_doc;
DROP POLICY IF EXISTS "nom151_doc_member_read" ON public.nom151_constancias_doc;
CREATE POLICY "nom151_doc_member_read"
  ON public.nom151_constancias_doc
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.documentos d
      WHERE d.id = nom151_constancias_doc.documento_id
        AND (
          d.owner_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = d.workspace_id
              AND wm.user_id = (SELECT auth.uid())
              AND wm.status = 'active'
          )
        )
    )
  );

COMMENT ON COLUMN public.nom151_constancias_doc.status IS
  'Provider issuance lifecycle: pending, processing, issued or failed.';
COMMENT ON COLUMN public.nom151_constancias_doc.verification_status IS
  'Independent verification lifecycle. issued never implies verified.';
COMMENT ON COLUMN public.nom151_constancias_doc.constancia_path IS
  'Immutable original PSC artifact path. A Docubox PDF is only a representation.';
COMMENT ON COLUMN public.nom151_constancias_doc.environment IS
  'Explicit provider environment. unknown must never be presented as production.';

;
