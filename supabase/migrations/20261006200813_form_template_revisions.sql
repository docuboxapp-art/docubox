-- A same-number revision gets its own row. Existing tokens and responses keep
-- referencing the published row they were created from.
BEGIN;

ALTER TABLE public.form_templates
  ADD COLUMN revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  ADD COLUMN source_template_id uuid REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  ADD COLUMN publication_comment text CHECK (char_length(publication_comment) <= 500);

DROP INDEX public.form_templates_family_version_key;
CREATE UNIQUE INDEX form_templates_family_version_revision_key
  ON public.form_templates
  (workspace_id, (COALESCE(root_template_id, id)), version_number, revision_number);

-- This trigger runs after zz_guard_form_template_lifecycle. The existing guard
-- still checks workspace access and locks the family root before allocation.
CREATE FUNCTION public.assign_form_template_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  source public.form_templates;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.revision_number, NEW.source_template_id)
      IS DISTINCT FROM ROW(OLD.revision_number, OLD.source_template_id) THEN
      RAISE EXCEPTION 'Form revision identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'draft' AND NEW.publication_comment IS DISTINCT FROM OLD.publication_comment THEN
      RAISE EXCEPTION 'Published revision comment is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_template_id IS NULL THEN
    NEW.revision_number := 1;
    RETURN NEW;
  END IF;

  SELECT * INTO source FROM public.form_templates
  WHERE id = NEW.source_template_id AND workspace_id = NEW.workspace_id;
  IF NOT FOUND OR source.published_at IS NULL OR source.status = 'in_review'
    OR NEW.root_template_id IS DISTINCT FROM COALESCE(source.root_template_id, source.id) THEN
    RAISE EXCEPTION 'Published form revision not accessible' USING ERRCODE = '42501';
  END IF;
  IF source.revision_number IS DISTINCT FROM (
    SELECT MAX(candidate.revision_number) FROM public.form_templates candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND COALESCE(candidate.root_template_id, candidate.id) = NEW.root_template_id
      AND candidate.version_number = source.version_number
  ) THEN
    RAISE EXCEPTION 'Start from the latest revision' USING ERRCODE = '23514';
  END IF;
  NEW.version_number := source.version_number;
  SELECT COALESCE(MAX(candidate.revision_number), 0) + 1 INTO NEW.revision_number
  FROM public.form_templates candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND COALESCE(candidate.root_template_id, candidate.id) = NEW.root_template_id
    AND candidate.version_number = source.version_number;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zzz_assign_form_template_revision
  BEFORE INSERT OR UPDATE ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.assign_form_template_revision();

CREATE FUNCTION public.create_form_template_revision(source_id uuid)
RETURNS public.form_templates LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  source public.form_templates;
  workspace_record public.workspaces;
  result public.form_templates;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO source FROM public.form_templates WHERE id = source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Form not accessible' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO workspace_record FROM public.workspaces WHERE id = source.workspace_id;
  IF source.published_at IS NULL OR source.status = 'in_review' OR NOT (
    workspace_record.owner_id = auth.uid() OR
    (workspace_record.workspace_type = 'business' AND public.has_organization_permission(source.workspace_id, 'resources.manage'))
  ) THEN
    RAISE EXCEPTION 'Form revision permission required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.form_templates
    (workspace_id, created_by, name, description, status, schema, settings,
     pdf_base_path, document_id, root_template_id, source_template_id)
  VALUES
    (source.workspace_id, auth.uid(), source.name, source.description, 'draft', source.schema,
     source.settings, source.pdf_base_path, source.document_id,
     COALESCE(source.root_template_id, source.id), source.id)
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_form_template_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_form_template_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_form_template_revision(uuid) TO authenticated;

COMMIT;
