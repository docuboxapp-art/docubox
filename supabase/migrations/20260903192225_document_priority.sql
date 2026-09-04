-- Priority is operational metadata. Expiration remains exclusively in
-- fecha_vencimiento and is never derived from this field.
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

UPDATE public.documentos
SET priority = 'urgent'
WHERE es_urgente = true
  AND priority <> 'urgent';

ALTER TABLE public.documentos
  DROP CONSTRAINT IF EXISTS documentos_priority_check;

ALTER TABLE public.documentos
  ADD CONSTRAINT documentos_priority_check
  CHECK (priority IN ('normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS documentos_workspace_priority_expiration_idx
  ON public.documentos (workspace_id, priority, fecha_vencimiento)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_document_priority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.es_urgente = true THEN
    NEW.priority := 'urgent';
  ELSIF TG_OP = 'UPDATE' AND NEW.priority IS DISTINCT FROM OLD.priority THEN
    NEW.priority := COALESCE(NEW.priority, 'normal');
  ELSIF TG_OP = 'UPDATE' AND NEW.es_urgente IS DISTINCT FROM OLD.es_urgente THEN
    NEW.priority := CASE WHEN NEW.es_urgente THEN 'urgent' ELSE 'normal' END;
  END IF;

  NEW.es_urgente := NEW.priority = 'urgent';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documentos_sync_priority ON public.documentos;
CREATE TRIGGER documentos_sync_priority
  BEFORE INSERT OR UPDATE OF priority, es_urgente ON public.documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_document_priority();
