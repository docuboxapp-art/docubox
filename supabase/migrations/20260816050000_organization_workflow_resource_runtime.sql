-- Workflow runtime snapshots and governed resource lifecycle.

CREATE TABLE IF NOT EXISTS public.organization_workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  workflow_id UUID NOT NULL REFERENCES public.organization_approval_workflows(id) ON DELETE RESTRICT,
  workflow_version INTEGER NOT NULL,
  definition_snapshot JSONB NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'approved', 'rejected', 'cancelled', 'expired', 'failed')),
  current_step_order INTEGER NOT NULL DEFAULT 1,
  context JSONB NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key UUID NOT NULL,
  started_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, workflow_id, subject_type, subject_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.organization_workflow_step_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  workflow_instance_id UUID NOT NULL REFERENCES public.organization_workflow_instances(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  label TEXT NOT NULL,
  assignee_type TEXT,
  assignee_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'approved', 'rejected', 'skipped', 'expired', 'cancelled', 'failed')),
  due_at TIMESTAMPTZ,
  acted_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  acted_at TIMESTAMPTZ,
  decision_comment TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_instance_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_org_workflow_instances_subject
  ON public.organization_workflow_instances(workspace_id, subject_type, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_org_workflow_steps_active
  ON public.organization_workflow_step_instances(workspace_id, status, due_at)
  WHERE status IN ('pending', 'active');

INSERT INTO public.organization_permissions (permission_key, name, description, category) VALUES
  ('workflows.execute', 'Ejecutar flujos', 'Iniciar instancias de flujos publicados.', 'Gobernanza')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.organization_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.organization_roles role
CROSS JOIN public.organization_permissions permission
WHERE role.system_key IN ('owner', 'admin', 'member')
  AND permission.permission_key = 'workflows.execute'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.protect_published_organization_resource()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'published' AND (
    NEW.name IS DISTINCT FROM OLD.name
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
    OR NEW.signature_policy_id IS DISTINCT FROM OLD.signature_policy_id
    OR NEW.configuration IS DISTINCT FROM OLD.configuration
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.locked IS DISTINCT FROM OLD.locked
  ) THEN
    RAISE EXCEPTION 'published_organization_resource_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_published_organization_resource ON public.organization_shared_resources;
CREATE TRIGGER protect_published_organization_resource
  BEFORE UPDATE ON public.organization_shared_resources
  FOR EACH ROW EXECUTE FUNCTION public.protect_published_organization_resource();

CREATE OR REPLACE FUNCTION public.publish_organization_shared_resource(ws_id UUID, target_resource_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resource_record public.organization_shared_resources%ROWTYPE;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'resources.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO resource_record
  FROM public.organization_shared_resources
  WHERE id = target_resource_id AND workspace_id = ws_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_resource_not_found' USING ERRCODE = 'P0002'; END IF;
  IF resource_record.status NOT IN ('draft', 'in_review', 'approved') THEN
    RAISE EXCEPTION 'organization_resource_cannot_be_published' USING ERRCODE = '55000';
  END IF;
  IF resource_record.workflow_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_approval_workflows
    WHERE id = resource_record.workflow_id AND workspace_id = ws_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'organization_resource_workflow_not_published' USING ERRCODE = '23514';
  END IF;
  IF resource_record.signature_policy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organization_signature_policies
    WHERE id = resource_record.signature_policy_id AND workspace_id = ws_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'organization_resource_policy_not_published' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_shared_resources
  SET status = 'published', locked = TRUE, updated_at = CURRENT_TIMESTAMP
  WHERE id = target_resource_id;
  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload, module, severity)
  VALUES (ws_id, auth.uid(), 'resource.published', 'organization_shared_resource', target_resource_id::TEXT,
    'Recurso organizacional publicado', jsonb_build_object('version', resource_record.version), 'resources', 'high');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization_shared_resource_version(ws_id UUID, source_resource_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_record public.organization_shared_resources%ROWTYPE;
  next_version INTEGER;
  new_id UUID;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'resources.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO source_record FROM public.organization_shared_resources
  WHERE id = source_resource_id AND workspace_id = ws_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_resource_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM public.organization_shared_resources
  WHERE workspace_id = ws_id AND name = source_record.name AND resource_type = source_record.resource_type;
  INSERT INTO public.organization_shared_resources (
    workspace_id, resource_type, document_template_id, form_template_id, name, description,
    visibility, owner_user_id, custodian_user_id, workflow_id, signature_policy_id,
    version, status, locked, configuration, created_by
  ) VALUES (
    ws_id, source_record.resource_type, source_record.document_template_id, source_record.form_template_id,
    source_record.name, source_record.description, source_record.visibility, source_record.owner_user_id,
    source_record.custodian_user_id, source_record.workflow_id, source_record.signature_policy_id,
    next_version, 'draft', FALSE, source_record.configuration, auth.uid()
  ) RETURNING id INTO new_id;
  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload, module)
  VALUES (ws_id, auth.uid(), 'resource.version.created', 'organization_shared_resource', new_id::TEXT,
    'Nueva versión de recurso creada', jsonb_build_object('source_id', source_resource_id, 'version', next_version), 'resources');
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_organization_workflow_instance(
  ws_id UUID,
  target_workflow_id UUID,
  requested_subject_type TEXT,
  requested_subject_id TEXT,
  requested_context JSONB,
  requested_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  workflow_record public.organization_approval_workflows%ROWTYPE;
  instance_id UUID;
  step JSONB;
  first_action_order INTEGER;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'workflows.execute') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(BTRIM(requested_subject_type), '') IS NULL
    OR NULLIF(BTRIM(requested_subject_id), '') IS NULL
    OR requested_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'workflow_instance_request_is_incomplete' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO workflow_record FROM public.organization_approval_workflows
  WHERE id = target_workflow_id AND workspace_id = ws_id AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'published_organization_workflow_not_found' USING ERRCODE = 'P0002'; END IF;

  IF jsonb_typeof(workflow_record.definition->'steps') IS DISTINCT FROM 'array'
    OR jsonb_array_length(workflow_record.definition->'steps') < 2
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(workflow_record.definition->'steps') candidate
      WHERE NULLIF(BTRIM(candidate->>'type'), '') IS NULL
        OR NULLIF(BTRIM(candidate->>'label'), '') IS NULL
        OR COALESCE(candidate->>'order', '') !~ '^[0-9]+$'
    )
    OR EXISTS (
      SELECT 1
      FROM (
        SELECT (candidate->>'order')::INTEGER AS step_order
        FROM jsonb_array_elements(workflow_record.definition->'steps') candidate
      ) ordered_steps
      GROUP BY step_order
      HAVING COUNT(*) > 1
    ) THEN
    RAISE EXCEPTION 'published_organization_workflow_is_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO instance_id FROM public.organization_workflow_instances
  WHERE workspace_id = ws_id AND idempotency_key = requested_idempotency_key;
  IF FOUND THEN RETURN instance_id; END IF;

  SELECT MIN((value->>'order')::INTEGER) INTO first_action_order
  FROM jsonb_array_elements(workflow_record.definition->'steps')
  WHERE value->>'type' <> 'start';

  INSERT INTO public.organization_workflow_instances (
    workspace_id, workflow_id, workflow_version, definition_snapshot, subject_type,
    subject_id, current_step_order, context, idempotency_key, started_by
  ) VALUES (
    ws_id, workflow_record.id, workflow_record.version, workflow_record.definition,
    BTRIM(requested_subject_type), BTRIM(requested_subject_id), COALESCE(first_action_order, 1),
    COALESCE(requested_context, '{}'::JSONB), requested_idempotency_key, auth.uid()
  ) RETURNING id INTO instance_id;

  FOR step IN SELECT value FROM jsonb_array_elements(workflow_record.definition->'steps') LOOP
    INSERT INTO public.organization_workflow_step_instances (
      workspace_id, workflow_instance_id, step_id, step_order, step_type, label,
      assignee_type, assignee_id, status, due_at
    ) VALUES (
      ws_id, instance_id, COALESCE(NULLIF(step->>'id', ''), 'step-' || (step->>'order')), (step->>'order')::INTEGER, step->>'type', step->>'label',
      NULLIF(step->>'assignee_type', ''), NULLIF(step->>'assignee_id', ''),
      CASE
        WHEN step->>'type' = 'start' THEN 'approved'
        WHEN (step->>'order')::INTEGER = first_action_order THEN 'active'
        ELSE 'pending'
      END,
      CASE WHEN NULLIF(step->>'sla_hours', '') IS NOT NULL
        THEN CURRENT_TIMESTAMP + make_interval(hours => (step->>'sla_hours')::INTEGER)
        ELSE NULL END
    );
  END LOOP;

  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload, module)
  VALUES (ws_id, auth.uid(), 'workflow.instance.started', 'organization_workflow_instance', instance_id::TEXT,
    'Instancia de flujo iniciada', jsonb_build_object('workflow_id', target_workflow_id, 'workflow_version', workflow_record.version, 'subject_type', requested_subject_type, 'subject_id', requested_subject_id), 'workflows');
  RETURN instance_id;
END;
$$;

ALTER TABLE public.organization_workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_workflow_step_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_read_workflow_instances" ON public.organization_workflow_instances;
CREATE POLICY "org_members_read_workflow_instances" ON public.organization_workflow_instances
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'workflows.read'));
DROP POLICY IF EXISTS "org_members_read_workflow_steps" ON public.organization_workflow_step_instances;
CREATE POLICY "org_members_read_workflow_steps" ON public.organization_workflow_step_instances
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'workflows.read'));

GRANT SELECT ON public.organization_workflow_instances TO authenticated;
GRANT SELECT ON public.organization_workflow_step_instances TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_workflow_instances FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.organization_workflow_step_instances FROM authenticated;
REVOKE ALL ON FUNCTION public.protect_published_organization_resource() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_organization_shared_resource(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_organization_shared_resource_version(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_organization_workflow_instance(UUID, UUID, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_organization_shared_resource(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_shared_resource_version(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_organization_workflow_instance(UUID, UUID, TEXT, TEXT, JSONB, UUID) TO authenticated;
