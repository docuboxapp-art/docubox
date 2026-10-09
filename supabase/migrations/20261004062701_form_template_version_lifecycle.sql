-- Published rows remain the target of their existing tokens and responses.
-- New revisions are independent drafts. Existing workspace RLS is unchanged.
BEGIN;

ALTER TABLE public.form_templates
  ADD COLUMN root_template_id uuid REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  ADD COLUMN version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  ADD COLUMN published_at timestamptz;

UPDATE public.form_templates
SET published_at = COALESCE(updated_at, created_at, now())
WHERE status <> 'draft';

CREATE UNIQUE INDEX form_templates_family_version_key
  ON public.form_templates (workspace_id, (COALESCE(root_template_id, id)), version_number);

CREATE FUNCTION public.guard_form_template_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  root public.form_templates;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR OLD.published_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.form_tokens WHERE template_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.form_responses WHERE template_id = OLD.id)
    THEN
      RAISE EXCEPTION 'Only unused drafts can be deleted; archive published forms' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Create a draft before publishing' USING ERRCODE = '23514';
    END IF;
    IF NEW.root_template_id IS NULL THEN
      NEW.version_number := 1;
    ELSE
      -- Serializes version allocation within the family without bypassing RLS.
      SELECT * INTO root FROM public.form_templates
      WHERE id = NEW.root_template_id AND workspace_id = NEW.workspace_id
        AND root_template_id IS NULL FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Form family not accessible' USING ERRCODE = '42501';
      END IF;
      SELECT COALESCE(MAX(version_number), 1) + 1 INTO NEW.version_number
      FROM public.form_templates
      WHERE workspace_id = NEW.workspace_id
        AND (id = root.id OR root_template_id = root.id);
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.root_template_id, NEW.version_number, NEW.workspace_id, NEW.created_by)
    IS DISTINCT FROM ROW(OLD.root_template_id, OLD.version_number, OLD.workspace_id, OLD.created_by) THEN
    RAISE EXCEPTION 'Form identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' OR OLD.published_at IS NOT NULL THEN
    IF ROW(NEW.name, NEW.description, NEW.schema, NEW.settings, NEW.pdf_base_path,
           NEW.form_schema, NEW.pdf_schema, NEW.requires_signature, NEW.allowed_signature_types, NEW.document_id)
      IS DISTINCT FROM
       ROW(OLD.name, OLD.description, OLD.schema, OLD.settings, OLD.pdf_base_path,
           OLD.form_schema, OLD.pdf_schema, OLD.requires_signature, OLD.allowed_signature_types, OLD.document_id) THEN
      RAISE EXCEPTION 'Create a new draft version to edit a published form' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'draft' OR (OLD.status IN ('closed', 'archived') AND NEW.status NOT IN ('closed', 'archived'))
      OR (OLD.status = 'archived' AND NEW.status <> 'archived') THEN
      RAISE EXCEPTION 'Invalid form lifecycle transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.published_at := OLD.published_at;
  IF NEW.status = 'published' AND OLD.status = 'draft' THEN
    IF length(btrim(NEW.name)) = 0 OR jsonb_typeof(NEW.schema) <> 'array' OR jsonb_array_length(NEW.schema) = 0 THEN
      RAISE EXCEPTION 'A name and at least one field are required' USING ERRCODE = '23514';
    END IF;
    IF COALESCE((NEW.settings->>'requiresSignature')::boolean, false)
      AND COALESCE(jsonb_array_length(NEW.settings->'allowedSignatureTypes'), 0) = 0 THEN
      RAISE EXCEPTION 'Select at least one signature method' USING ERRCODE = '23514';
    END IF;
    NEW.published_at := now();
  END IF;
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN NEW.closed_at := now(); END IF;
  IF NEW.status = 'archived' AND OLD.status <> 'archived' THEN NEW.archived_at := now(); END IF;
  RETURN NEW;
END;
$$;

-- Runs after canonical-schema synchronization, so both representations are guarded.
CREATE TRIGGER zz_guard_form_template_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_form_template_lifecycle();

CREATE FUNCTION public.create_form_template_version(source_id uuid)
RETURNS public.form_templates LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  source public.form_templates;
  result public.form_templates;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO source FROM public.form_templates WHERE id = source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Form not accessible' USING ERRCODE = '42501';
  END IF;
  IF source.status = 'draft' THEN
    RAISE EXCEPTION 'Edit the existing draft' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.form_templates
    (workspace_id, created_by, name, description, status, schema, settings, pdf_base_path, document_id, root_template_id)
  VALUES
    (source.workspace_id, auth.uid(), source.name, source.description, 'draft', source.schema,
     source.settings, source.pdf_base_path, source.document_id, COALESCE(source.root_template_id, source.id))
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_form_template_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_form_template_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_form_template_version(uuid) TO authenticated;

COMMIT;

-- Logical rollback: revert the application first, then remove the trigger/function
-- create_form_template_version and the lifecycle guard. Keep the additive columns,
-- unique index and version rows so tokens, answers and family history remain intact.
