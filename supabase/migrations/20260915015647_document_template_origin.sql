-- Preserve the exact template provenance of documents created from published templates.

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS source_template_id UUID
  REFERENCES public.plantillas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_workspace_source_template
  ON public.documentos(workspace_id, source_template_id)
  WHERE source_template_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_document_template_origin_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  template_workspace_id UUID;
BEGIN
  IF NEW.source_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT template.workspace_id
  INTO template_workspace_id
  FROM public.plantillas AS template
  WHERE template.id = NEW.source_template_id;

  IF template_workspace_id IS NULL OR NEW.workspace_id IS DISTINCT FROM template_workspace_id THEN
    RAISE EXCEPTION 'Document template origin must belong to the document workspace';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_document_template_origin_scope
  ON public.documentos;
CREATE TRIGGER enforce_document_template_origin_scope
  BEFORE INSERT OR UPDATE OF workspace_id, source_template_id
  ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_template_origin_scope();

COMMENT ON COLUMN public.documentos.source_template_id IS
  'Exact Docubox template version used to create this document. Null for non-template sources.';
