-- Supports the default workspace list: owner-scoped, active documents ordered by recency.
-- This does not change RLS or visibility semantics.
CREATE INDEX IF NOT EXISTS idx_documentos_owner_active_updated_at
  ON public.documentos (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;
