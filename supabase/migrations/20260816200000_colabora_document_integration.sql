-- Colabora: preserve the canonical private storage reference used by document versions.
-- Additive and backwards compatible with the legacy signed URL column.

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_documentos_workspace_updated
  ON public.documentos(workspace_id, updated_at DESC);

COMMENT ON COLUMN public.documentos.storage_path IS
  'Private object path in the documents bucket. Access must use short-lived signed URLs.';
