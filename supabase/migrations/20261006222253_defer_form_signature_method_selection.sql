-- Signature methods are chosen when a form is sent, not when its template is published.
BEGIN;

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

COMMIT;
