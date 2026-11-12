-- Additive foundation for reusable requirements and immutable published case templates.
-- No existing case file or published template is rewritten.

CREATE TABLE IF NOT EXISTS public.case_requirement_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  scope text NOT NULL CHECK (scope IN ('personal', 'workspace')),
  kind text NOT NULL DEFAULT 'document' CHECK (kind IN ('document', 'form', 'verification', 'action', 'acceptance', 'signature', 'generated_document')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 180),
  description text NOT NULL DEFAULT '',
  category_key text NOT NULL DEFAULT 'identity',
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(defaults) = 'object'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS case_requirement_catalog_personal_name
  ON public.case_requirement_catalog (workspace_id, owner_user_id, lower(btrim(name)))
  WHERE scope = 'personal' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS case_requirement_catalog_workspace_name
  ON public.case_requirement_catalog (workspace_id, lower(btrim(name)))
  WHERE scope = 'workspace' AND status = 'active';
CREATE INDEX IF NOT EXISTS case_requirement_catalog_lookup
  ON public.case_requirement_catalog (workspace_id, scope, status, category_key);

ALTER TABLE public.case_requirement_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_requirement_catalog FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.case_requirement_catalog TO authenticated;

CREATE POLICY case_requirement_catalog_select ON public.case_requirement_catalog
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = case_requirement_catalog.workspace_id
        AND member.user_id = (SELECT auth.uid()) AND member.status = 'active')
    AND (scope = 'workspace' OR owner_user_id = (SELECT auth.uid()))
  );
CREATE POLICY case_requirement_catalog_insert ON public.case_requirement_catalog
  FOR INSERT TO authenticated WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.workspace_members member
      JOIN public.workspaces workspace ON workspace.id = member.workspace_id
      WHERE member.workspace_id = case_requirement_catalog.workspace_id
        AND member.user_id = (SELECT auth.uid()) AND member.status = 'active'
        AND (scope = 'personal' OR (scope = 'workspace' AND workspace.workspace_type = 'business' AND member.role IN ('owner', 'admin'))))
  );
CREATE POLICY case_requirement_catalog_update ON public.case_requirement_catalog
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = case_requirement_catalog.workspace_id
      AND member.user_id = (SELECT auth.uid()) AND member.status = 'active'
      AND ((scope = 'personal' AND owner_user_id = (SELECT auth.uid()))
        OR (scope = 'workspace' AND member.role IN ('owner', 'admin')))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members member
    JOIN public.workspaces workspace ON workspace.id = member.workspace_id
    WHERE member.workspace_id = case_requirement_catalog.workspace_id
      AND member.user_id = (SELECT auth.uid()) AND member.status = 'active'
      AND ((scope = 'personal' AND owner_user_id = (SELECT auth.uid()))
        OR (scope = 'workspace' AND workspace.workspace_type = 'business' AND member.role IN ('owner', 'admin')))));

CREATE OR REPLACE FUNCTION public.case_requirement_catalog_protect_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION 'Requirement catalog ownership and scope cannot be changed';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER case_requirement_catalog_protect_scope_before
  BEFORE UPDATE ON public.case_requirement_catalog
  FOR EACH ROW EXECUTE FUNCTION public.case_requirement_catalog_protect_scope();

ALTER TABLE public.case_file_templates
  ADD COLUMN IF NOT EXISTS publication_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.case_file_templates
  ADD COLUMN IF NOT EXISTS editor_draft jsonb CHECK (editor_draft IS NULL OR jsonb_typeof(editor_draft) = 'object');

CREATE TABLE IF NOT EXISTS public.case_file_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.case_file_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

ALTER TABLE public.case_file_template_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_file_template_versions FROM anon, authenticated;
GRANT SELECT ON public.case_file_template_versions TO authenticated;
CREATE POLICY case_file_template_versions_select ON public.case_file_template_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = case_file_template_versions.workspace_id
      AND member.user_id = (SELECT auth.uid()) AND member.status = 'active'));

INSERT INTO public.case_file_template_versions (workspace_id, template_id, version, snapshot, published_by, published_at)
SELECT template.workspace_id, template.id, 1,
  jsonb_build_object('requirements_schema', template.requirements_schema, 'forms_schema', template.forms_schema,
    'identity_schema', template.identity_schema, 'milestones_schema', template.milestones_schema,
    'closure_rules_schema', template.closure_rules_schema, 'name', template.name,
    'description', template.description, 'case_type', template.case_type, 'case_subtype', template.case_subtype),
  template.created_by, coalesce(template.updated_at, now())
FROM public.case_file_templates template
WHERE template.status = 'active'
ON CONFLICT (template_id, version) DO NOTHING;

UPDATE public.case_file_templates SET publication_version = 1
WHERE status = 'active' AND publication_version = 0;

ALTER TABLE public.case_files
  ADD COLUMN IF NOT EXISTS template_version_id uuid REFERENCES public.case_file_template_versions(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.case_template_publication_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.publication_version := CASE WHEN NEW.status = 'active' THEN 1 ELSE 0 END;
  ELSIF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'A case template cannot move between workspaces';
  ELSIF NEW.status = 'active' AND (
    OLD.status IS DISTINCT FROM 'active' OR OLD.name IS DISTINCT FROM NEW.name
    OR OLD.description IS DISTINCT FROM NEW.description OR OLD.case_type IS DISTINCT FROM NEW.case_type
    OR OLD.case_subtype IS DISTINCT FROM NEW.case_subtype
    OR OLD.requirements_schema IS DISTINCT FROM NEW.requirements_schema
    OR OLD.forms_schema IS DISTINCT FROM NEW.forms_schema
    OR OLD.identity_schema IS DISTINCT FROM NEW.identity_schema
    OR OLD.milestones_schema IS DISTINCT FROM NEW.milestones_schema
    OR OLD.closure_rules_schema IS DISTINCT FROM NEW.closure_rules_schema
  ) THEN
    NEW.publication_version := OLD.publication_version + 1;
  ELSE
    NEW.publication_version := OLD.publication_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.case_template_capture_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status <> 'active' OR NEW.publication_version = 0 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.publication_version IS NOT DISTINCT FROM OLD.publication_version THEN
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO public.case_file_template_versions
    (workspace_id, template_id, version, snapshot, published_by)
  VALUES (NEW.workspace_id, NEW.id, NEW.publication_version,
    jsonb_build_object('requirements_schema', NEW.requirements_schema, 'forms_schema', NEW.forms_schema,
      'identity_schema', NEW.identity_schema, 'milestones_schema', NEW.milestones_schema,
      'closure_rules_schema', NEW.closure_rules_schema, 'name', NEW.name,
      'description', NEW.description, 'case_type', NEW.case_type, 'case_subtype', NEW.case_subtype),
    (SELECT auth.uid()));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.case_template_capture_publication() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS case_template_publication_version_before ON public.case_file_templates;
CREATE TRIGGER case_template_publication_version_before
  BEFORE INSERT OR UPDATE ON public.case_file_templates
  FOR EACH ROW EXECUTE FUNCTION public.case_template_publication_version();
DROP TRIGGER IF EXISTS case_template_capture_publication_after ON public.case_file_templates;
CREATE TRIGGER case_template_capture_publication_after
  AFTER INSERT OR UPDATE ON public.case_file_templates
  FOR EACH ROW EXECUTE FUNCTION public.case_template_capture_publication();

CREATE OR REPLACE FUNCTION public.reject_case_template_version_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Published case template versions are immutable'; END;
$$;
DROP TRIGGER IF EXISTS case_template_version_immutable ON public.case_file_template_versions;
CREATE TRIGGER case_template_version_immutable BEFORE UPDATE OR DELETE ON public.case_file_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_case_template_version_mutation();

CREATE OR REPLACE FUNCTION public.case_file_assign_template_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE selected_version uuid;
BEGIN
  IF NEW.template_id IS NULL THEN
    IF NEW.template_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'A template version requires a template';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.template_version_id IS NULL THEN
    SELECT version.id INTO selected_version
    FROM public.case_file_templates template
    JOIN public.case_file_template_versions version
      ON version.template_id = template.id AND version.version = template.publication_version
    WHERE template.id = NEW.template_id AND template.workspace_id = NEW.workspace_id
      AND template.status = 'active';
    IF selected_version IS NULL THEN
      RAISE EXCEPTION 'Only a published template in the same workspace may start a case file';
    END IF;
    NEW.template_version_id := selected_version;
  ELSE
    PERFORM 1 FROM public.case_file_template_versions version
    JOIN public.case_file_templates template ON template.id = version.template_id
    WHERE version.id = NEW.template_version_id AND template.id = NEW.template_id
      AND version.workspace_id = NEW.workspace_id AND template.workspace_id = NEW.workspace_id
      AND template.status = 'active' AND version.version = template.publication_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template version does not belong to the selected template and workspace';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER case_file_assign_template_version_before
  BEFORE INSERT ON public.case_files
  FOR EACH ROW EXECUTE FUNCTION public.case_file_assign_template_version();

CREATE OR REPLACE FUNCTION public.case_file_protect_template_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id THEN
    RAISE EXCEPTION 'The template and published version of a case file are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER case_file_protect_template_version_before
  BEFORE UPDATE ON public.case_files
  FOR EACH ROW EXECUTE FUNCTION public.case_file_protect_template_version();
