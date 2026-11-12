BEGIN;

ALTER TABLE public.case_file_templates
  ADD COLUMN archived_from_status text
    CHECK (archived_from_status IN ('draft', 'active', 'paused')),
  ADD COLUMN archived_at timestamptz;

ALTER TABLE public.case_file_templates
  DROP CONSTRAINT IF EXISTS case_file_templates_status_check;
ALTER TABLE public.case_file_templates
  ADD CONSTRAINT case_file_templates_status_check
  CHECK (status IN ('draft', 'active', 'paused', 'archived'));

-- Older archived rows did not retain their previous status.
UPDATE public.case_file_templates
SET archived_from_status = 'active', archived_at = COALESCE(archived_at, updated_at)
WHERE status = 'archived' AND archived_from_status IS NULL;

CREATE OR REPLACE FUNCTION public.track_case_file_template_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'archived' AND NEW.status <> 'archived'
    AND NEW.status IS DISTINCT FROM COALESCE(OLD.archived_from_status, 'active') THEN
    RAISE EXCEPTION 'Restore the previous case file type status first' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'archived' AND OLD.status <> 'archived' THEN
    NEW.archived_from_status := OLD.status;
    NEW.archived_at := now();
  ELSIF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    NEW.archived_from_status := NULL;
    NEW.archived_at := NULL;
  ELSE
    NEW.archived_from_status := OLD.archived_from_status;
    NEW.archived_at := OLD.archived_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER track_case_file_template_archive
BEFORE UPDATE ON public.case_file_templates
FOR EACH ROW EXECUTE FUNCTION public.track_case_file_template_archive();

-- Pausing or archiving a type stops new cases; existing cases keep their status.
CREATE OR REPLACE FUNCTION public.require_active_case_file_template()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE template_status text;
BEGIN
  IF NEW.template_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.template_id IS NOT DISTINCT FROM OLD.template_id
      AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT status INTO template_status
  FROM public.case_file_templates
  WHERE id = NEW.template_id AND workspace_id = NEW.workspace_id;
  IF template_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Case file type is not active' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER require_active_case_file_template
BEFORE INSERT OR UPDATE OF template_id, workspace_id ON public.case_files
FOR EACH ROW EXECUTE FUNCTION public.require_active_case_file_template();

COMMIT;
