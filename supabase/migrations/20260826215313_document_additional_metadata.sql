-- Additional business metadata is deliberately separated from PDF/XMP metadata.
-- Document-scoped values are snapshotted and locked when the signing process starts;
-- management-scoped values remain mutable through the authenticated backend route.

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS additional_metadata JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS public.document_additional_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  document_version_number INTEGER NOT NULL DEFAULT 1 CHECK (document_version_number > 0),
  metadata_scope TEXT NOT NULL CHECK (metadata_scope IN ('document', 'management')),
  data_type TEXT NOT NULL CHECK (data_type IN ('text', 'number', 'currency', 'date', 'datetime', 'boolean', 'list', 'rfc', 'curp', 'email', 'identifier', 'reference')),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  value_json JSONB NOT NULL,
  value_display TEXT NOT NULL CHECK (char_length(value_display) <= 2000),
  snapshot_value JSONB,
  snapshot_hash TEXT CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  locked_at TIMESTAMPTZ,
  client_reference TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT document_additional_metadata_client_reference_unique UNIQUE (document_id, client_reference),
  CONSTRAINT document_additional_metadata_scope_lock CHECK (
    (metadata_scope = 'management') OR (snapshot_value IS NOT NULL AND snapshot_hash IS NOT NULL AND locked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_document_additional_metadata_document
  ON public.document_additional_metadata(document_id, metadata_scope, created_at);
CREATE INDEX IF NOT EXISTS idx_document_additional_metadata_workspace
  ON public.document_additional_metadata(workspace_id, metadata_scope, created_at DESC);

ALTER TABLE public.document_additional_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_additional_metadata_select_workspace_member ON public.document_additional_metadata;
CREATE POLICY document_additional_metadata_select_workspace_member
  ON public.document_additional_metadata
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members member
      WHERE member.workspace_id = document_additional_metadata.workspace_id
        AND member.user_id = (SELECT auth.uid())
        AND COALESCE(member.status, 'active') = 'active'
    )
  );

REVOKE ALL ON public.document_additional_metadata FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.document_additional_metadata FROM authenticated;
GRANT SELECT ON public.document_additional_metadata TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_locked_document_metadata_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.metadata_scope = 'document' AND OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'locked_document_metadata' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.document_id := OLD.document_id;
    NEW.workspace_id := OLD.workspace_id;
    NEW.document_version_id := OLD.document_version_id;
    NEW.document_version_number := OLD.document_version_number;
    NEW.metadata_scope := OLD.metadata_scope;
    NEW.data_type := OLD.data_type;
    NEW.name := OLD.name;
    NEW.client_reference := OLD.client_reference;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS prevent_locked_document_metadata_mutation ON public.document_additional_metadata;
CREATE TRIGGER prevent_locked_document_metadata_mutation
  BEFORE UPDATE OR DELETE ON public.document_additional_metadata
  FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_document_metadata_mutation();
