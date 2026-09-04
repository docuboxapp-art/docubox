-- Version-aware NOM-151 issuance supersedes the historical one-active-row per
-- document rule. Existing records remain untouched.
DROP INDEX IF EXISTS public.nom151_one_active_record_per_document_idx;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nom151_verified_artifact_request
  ON public.nom151_constancias_doc(documento_id, document_version_id, document_digest, provider)
  WHERE document_version_id IS NOT NULL
    AND document_digest IS NOT NULL
    AND provider IS NOT NULL
    AND status IN ('processing','issued');

;
