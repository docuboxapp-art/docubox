-- A workspace can customize the participation terms. NULL retains the built-in text.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS participation_terms_text TEXT;

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS participation_terms_text TEXT;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_participation_terms_length
  CHECK (participation_terms_text IS NULL OR
    (length(btrim(participation_terms_text)) BETWEEN 30 AND 12000));

ALTER TABLE public.documentos
  ADD CONSTRAINT documentos_participation_terms_length
  CHECK (participation_terms_text IS NULL OR
    (length(btrim(participation_terms_text)) BETWEEN 30 AND 12000));

-- Keep the terms that applied when a document was created. Existing documents
-- retain NULL and continue using the built-in terms, even after a workspace edit.
CREATE OR REPLACE FUNCTION public.snapshot_document_participation_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN
    SELECT workspace.participation_terms_text
      INTO NEW.participation_terms_text
      FROM public.workspaces AS workspace
     WHERE workspace.id = NEW.workspace_id;
  ELSE
    NEW.participation_terms_text := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_document_participation_terms ON public.documentos;
CREATE TRIGGER trg_snapshot_document_participation_terms
  BEFORE INSERT ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_document_participation_terms();

CREATE OR REPLACE FUNCTION public.preserve_document_participation_terms()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.participation_terms_text := OLD.participation_terms_text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_document_participation_terms ON public.documentos;
CREATE TRIGGER trg_preserve_document_participation_terms
  BEFORE UPDATE OF participation_terms_text ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.preserve_document_participation_terms();
