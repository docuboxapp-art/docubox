BEGIN;

ALTER TABLE public.form_templates
  ADD COLUMN approval_workflow_id uuid REFERENCES public.organization_approval_workflows(id) ON DELETE SET NULL,
  ADD COLUMN approval_workflow_instance_id uuid REFERENCES public.organization_workflow_instances(id) ON DELETE SET NULL,
  ADD COLUMN archived_from_status text CHECK (archived_from_status IN ('draft', 'published', 'paused', 'closed'));

ALTER TABLE public.form_templates DROP CONSTRAINT form_templates_status_check;
ALTER TABLE public.form_templates ADD CONSTRAINT form_templates_status_check
  CHECK (status IN ('draft', 'in_review', 'published', 'paused', 'closed', 'archived'));

UPDATE public.form_templates
SET archived_from_status = CASE
  WHEN published_at IS NULL THEN 'draft'
  ELSE 'closed'
END
WHERE status = 'archived' AND archived_from_status IS NULL;

CREATE INDEX form_templates_approval_instance_idx
  ON public.form_templates (approval_workflow_instance_id)
  WHERE approval_workflow_instance_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_form_template_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  root public.form_templates;
  workspace_record public.workspaces;
  active_workflow uuid;
  review_record public.organization_workflow_instances;
  actor uuid := auth.uid();
  can_manage boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR OLD.published_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.form_tokens WHERE template_id = OLD.id)
      OR EXISTS (SELECT 1 FROM public.form_responses WHERE template_id = OLD.id) THEN
      RAISE EXCEPTION 'Only unused drafts can be deleted; archive published forms' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO workspace_record FROM public.workspaces WHERE id = OLD.workspace_id;
    IF actor IS NULL OR (OLD.created_by <> actor AND NOT (
      workspace_record.owner_id = actor OR
      (workspace_record.workspace_type = 'business' AND public.has_organization_permission(OLD.workspace_id, 'resources.manage'))
    )) THEN
      RAISE EXCEPTION 'Form management permission required' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF actor IS NULL OR NEW.created_by <> actor OR NEW.status <> 'draft'
      OR NEW.published_at IS NOT NULL OR NEW.approval_workflow_instance_id IS NOT NULL THEN
      RAISE EXCEPTION 'Create an owned draft before publishing' USING ERRCODE = '42501';
    END IF;
    IF NEW.root_template_id IS NULL THEN
      NEW.version_number := 1;
    ELSE
      SELECT * INTO root FROM public.form_templates
      WHERE id = NEW.root_template_id AND workspace_id = NEW.workspace_id
        AND root_template_id IS NULL FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Form family not accessible' USING ERRCODE = '42501';
      END IF;
      SELECT * INTO workspace_record FROM public.workspaces WHERE id = NEW.workspace_id;
      IF NOT (workspace_record.owner_id = actor OR
        (workspace_record.workspace_type = 'business' AND public.has_organization_permission(NEW.workspace_id, 'resources.manage'))) THEN
        RAISE EXCEPTION 'Form version permission required' USING ERRCODE = '42501';
      END IF;
      SELECT COALESCE(MAX(version_number), 1) + 1 INTO NEW.version_number
      FROM public.form_templates
      WHERE workspace_id = NEW.workspace_id AND (id = root.id OR root_template_id = root.id);
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(NEW.root_template_id, NEW.version_number, NEW.workspace_id, NEW.created_by)
    IS DISTINCT FROM ROW(OLD.root_template_id, OLD.version_number, OLD.workspace_id, OLD.created_by) THEN
    RAISE EXCEPTION 'Form identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.approval_workflow_id, NEW.approval_workflow_instance_id)
    IS DISTINCT FROM ROW(OLD.approval_workflow_id, OLD.approval_workflow_instance_id)
    AND NOT (OLD.status = 'draft' AND NEW.status = 'in_review') THEN
    RAISE EXCEPTION 'Approval identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' OR OLD.published_at IS NOT NULL THEN
    IF ROW(NEW.name, NEW.description, NEW.schema, NEW.settings, NEW.pdf_base_path,
           NEW.form_schema, NEW.pdf_schema, NEW.requires_signature, NEW.allowed_signature_types, NEW.document_id)
      IS DISTINCT FROM
       ROW(OLD.name, OLD.description, OLD.schema, OLD.settings, OLD.pdf_base_path,
           OLD.form_schema, OLD.pdf_schema, OLD.requires_signature, OLD.allowed_signature_types, OLD.document_id) THEN
      RAISE EXCEPTION 'Create a new draft version to edit a published form' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'in_review', 'published', 'archived'))
    OR (OLD.status = 'in_review' AND NEW.status NOT IN ('in_review', 'draft', 'published'))
    OR (OLD.status = 'published' AND NEW.status NOT IN ('published', 'paused', 'closed', 'archived'))
    OR (OLD.status = 'paused' AND NEW.status NOT IN ('paused', 'published', 'closed', 'archived'))
    OR (OLD.status = 'closed' AND NEW.status NOT IN ('closed', 'archived'))
    OR (OLD.status = 'archived' AND NEW.status <> 'archived'
      AND NEW.status IS DISTINCT FROM OLD.archived_from_status) THEN
    RAISE EXCEPTION 'Invalid form lifecycle transition' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO workspace_record FROM public.workspaces WHERE id = OLD.workspace_id;
  can_manage := workspace_record.owner_id = actor OR
    (workspace_record.workspace_type = 'business' AND public.has_organization_permission(OLD.workspace_id, 'resources.manage'));

  IF OLD.status = 'in_review' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT * INTO review_record FROM public.organization_workflow_instances
    WHERE id = OLD.approval_workflow_instance_id AND workspace_id = OLD.workspace_id
      AND subject_type = 'form' AND subject_id = OLD.id::text;
    IF NOT FOUND OR NOT (
      (NEW.status = 'published' AND review_record.status = 'approved') OR
      (NEW.status = 'draft' AND review_record.status IN ('rejected', 'cancelled', 'expired', 'failed'))
    ) THEN
      RAISE EXCEPTION 'Approval decision required for review transition' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status = 'published' THEN
    SELECT id INTO active_workflow FROM public.organization_approval_workflows
    WHERE workspace_id = OLD.workspace_id AND status = 'published'
      AND id::text = workspace_record.organization_settings->>'default_workflow_id';
    IF actor IS NULL OR NOT can_manage OR
      (workspace_record.workspace_type = 'business' AND active_workflow IS NOT NULL) THEN
      RAISE EXCEPTION 'Direct publication is not permitted; submit for approval' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status = 'in_review' THEN
    SELECT id INTO active_workflow FROM public.organization_approval_workflows
    WHERE workspace_id = OLD.workspace_id AND status = 'published'
      AND id::text = workspace_record.organization_settings->>'default_workflow_id';
    SELECT * INTO review_record FROM public.organization_workflow_instances
    WHERE id = NEW.approval_workflow_instance_id AND workspace_id = OLD.workspace_id
      AND workflow_id = NEW.approval_workflow_id
      AND subject_type = 'form' AND subject_id = OLD.id::text;
    IF workspace_record.workspace_type <> 'business' OR active_workflow IS NULL
      OR NEW.approval_workflow_id IS DISTINCT FROM active_workflow OR NOT FOUND
      OR review_record.status NOT IN ('active', 'approved', 'rejected', 'cancelled', 'expired', 'failed')
      OR actor IS NULL OR (OLD.created_by <> actor AND NOT can_manage) THEN
      RAISE EXCEPTION 'Valid organization approval required' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'in_review' THEN
    IF actor IS NULL OR (OLD.created_by <> actor AND NOT can_manage) THEN
      RAISE EXCEPTION 'Form management permission required' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status = 'draft' AND (actor IS NULL OR (OLD.created_by <> actor AND NOT can_manage)) THEN
    RAISE EXCEPTION 'Form editing permission required' USING ERRCODE = '42501';
  END IF;

  NEW.published_at := OLD.published_at;
  NEW.closed_at := OLD.closed_at;
  IF NEW.status = 'published' AND OLD.status IN ('draft', 'in_review') THEN
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
  NEW.archived_from_status := OLD.archived_from_status;
  NEW.archived_at := OLD.archived_at;
  IF NEW.status = 'archived' AND OLD.status <> 'archived' THEN
    NEW.archived_from_status := OLD.status;
    NEW.archived_at := now();
  ELSIF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    NEW.archived_from_status := NULL;
    NEW.archived_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_form_template_version(source_id uuid)
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
    RAISE EXCEPTION 'Form version permission required' USING ERRCODE = '42501';
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

CREATE FUNCTION public.submit_form_for_approval(
  ws_id uuid, target_form_id uuid, target_workflow_id uuid,
  requested_context jsonb, requested_idempotency_key uuid
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  form_record public.form_templates;
  workspace_record public.workspaces;
  instance_id uuid;
  outcome text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_organization_permission(ws_id, 'workflows.execute') THEN
    RAISE EXCEPTION 'Organization workflow permission required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO workspace_record FROM public.workspaces WHERE id = ws_id;
  IF NOT FOUND OR workspace_record.workspace_type <> 'business'
    OR workspace_record.organization_settings->>'default_workflow_id' IS DISTINCT FROM target_workflow_id::text THEN
    RAISE EXCEPTION 'Organization approval is not configured' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO form_record FROM public.form_templates
  WHERE id = target_form_id AND workspace_id = ws_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Form not found' USING ERRCODE = 'P0002';
  END IF;
  IF form_record.status <> 'draft' OR form_record.published_at IS NOT NULL
    OR (form_record.created_by <> auth.uid() AND NOT public.has_organization_permission(ws_id, 'resources.manage')) THEN
    RAISE EXCEPTION 'Form cannot be submitted for approval' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(form_record.name)) = 0 OR jsonb_typeof(form_record.schema) <> 'array'
    OR jsonb_array_length(form_record.schema) = 0 THEN
    RAISE EXCEPTION 'A name and at least one field are required' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.organization_approval_workflows
  WHERE id = target_workflow_id AND workspace_id = ws_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Published approval workflow not found' USING ERRCODE = 'P0002';
  END IF;
  instance_id := public.start_organization_workflow_instance(
    ws_id, target_workflow_id, 'form', target_form_id::text,
    COALESCE(requested_context, '{}'::jsonb), requested_idempotency_key
  );
  UPDATE public.form_templates SET status = 'in_review',
    approval_workflow_id = target_workflow_id,
    approval_workflow_instance_id = instance_id
  WHERE id = target_form_id;
  SELECT status INTO outcome FROM public.organization_workflow_instances WHERE id = instance_id;
  IF outcome = 'approved' THEN
    UPDATE public.form_templates SET status = 'published' WHERE id = target_form_id;
  ELSIF outcome IN ('rejected', 'cancelled', 'expired', 'failed') THEN
    UPDATE public.form_templates SET status = 'draft' WHERE id = target_form_id;
  END IF;
  RETURN instance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_form_for_approval(uuid, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_form_for_approval(uuid, uuid, uuid, jsonb, uuid) TO authenticated;

CREATE FUNCTION public.sync_form_approval_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.subject_type <> 'form' OR NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'approved' THEN
    UPDATE public.form_templates SET status = 'published'
    WHERE id::text = NEW.subject_id AND workspace_id = NEW.workspace_id
      AND approval_workflow_instance_id = NEW.id AND status = 'in_review';
  ELSIF NEW.status IN ('rejected', 'cancelled', 'expired', 'failed') THEN
    UPDATE public.form_templates SET status = 'draft'
    WHERE id::text = NEW.subject_id AND workspace_id = NEW.workspace_id
      AND approval_workflow_instance_id = NEW.id AND status = 'in_review';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_form_approval_outcome
  AFTER UPDATE OF status ON public.organization_workflow_instances
  FOR EACH ROW EXECUTE FUNCTION public.sync_form_approval_outcome();

REVOKE ALL ON FUNCTION public.sync_form_approval_outcome() FROM PUBLIC, anon, authenticated;

COMMIT;
