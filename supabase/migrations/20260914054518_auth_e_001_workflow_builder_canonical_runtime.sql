-- AUTH-E-001 extends the existing organization workflow runtime. It does not
-- introduce a second definition, instance, scheduler, routing or event system.

ALTER TABLE public.organization_workflow_step_instances
  ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS completion_event_id UUID
    REFERENCES public.document_operational_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_workflow_steps_signature_event
  ON public.organization_workflow_step_instances(workspace_id, step_type, status)
  WHERE step_type = 'signature' AND status = 'active';

COMMENT ON COLUMN public.organization_workflow_step_instances.configuration IS
  'Immutable step configuration copied from the exact published workflow version snapshot.';
COMMENT ON COLUMN public.organization_workflow_step_instances.completion_event_id IS
  'Canonical document event that completed an event-driven workflow step.';

CREATE OR REPLACE FUNCTION public.validate_organization_workflow_definition(requested_definition JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  step JSONB;
  expected_order INTEGER := 1;
  start_count INTEGER := 0;
  terminal_count INTEGER := 0;
  builder_node_count INTEGER := 0;
  builder_edge_count INTEGER := 0;
  reachable_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(requested_definition) <> 'object'
     OR jsonb_typeof(requested_definition->'steps') <> 'array'
     OR jsonb_array_length(requested_definition->'steps') < 2
     OR jsonb_array_length(requested_definition->'steps') > 60 THEN
    RETURN FALSE;
  END IF;

  FOR step IN
    SELECT value
    FROM jsonb_array_elements(requested_definition->'steps')
    ORDER BY (value->>'order')::INTEGER
  LOOP
    IF NULLIF(BTRIM(step->>'id'), '') IS NULL
       OR NULLIF(BTRIM(step->>'label'), '') IS NULL
       OR COALESCE(step->>'order', '') !~ '^[0-9]+$'
       OR (step->>'order')::INTEGER <> expected_order
       OR COALESCE(step->>'type', '') NOT IN (
         'start', 'review', 'approval', 'signature', 'identity', 'condition',
         'notification', 'wait', 'approved', 'rejected', 'cancelled'
       ) THEN
      RETURN FALSE;
    END IF;
    IF step->>'type' = 'start' THEN start_count := start_count + 1; END IF;
    IF step->>'type' IN ('approved', 'rejected', 'cancelled') THEN
      terminal_count := terminal_count + 1;
    END IF;
    IF COALESCE((step->>'sla_hours')::INTEGER, 0) < 0 THEN RETURN FALSE; END IF;
    expected_order := expected_order + 1;
  END LOOP;

  IF start_count <> 1 OR terminal_count < 1 THEN RETURN FALSE; END IF;

  -- Builder v2 is intentionally a single, acyclic path. Legacy definitions
  -- retain their historical contract and continue through the same runtime.
  IF COALESCE((requested_definition->>'schema_version')::INTEGER, 1) = 2 THEN
    IF requested_definition->>'mode' <> 'sequential'
       OR jsonb_typeof(requested_definition->'builder'->'nodes') <> 'array'
       OR jsonb_typeof(requested_definition->'builder'->'edges') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') candidate
         WHERE candidate->>'type' NOT IN (
           'start', 'approval', 'signature', 'wait', 'approved', 'rejected', 'cancelled'
         )
       ) THEN
      RETURN FALSE;
    END IF;

    SELECT jsonb_array_length(requested_definition->'builder'->'nodes'),
           jsonb_array_length(requested_definition->'builder'->'edges')
    INTO builder_node_count, builder_edge_count;
    IF builder_node_count <> jsonb_array_length(requested_definition->'steps')
       OR builder_edge_count <> builder_node_count - 1
       OR (
         SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE node->>'type' = 'start'
       ) <> 1
       OR (
         SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE node->>'type' = 'end'
       ) < 1
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE NULLIF(node->>'id', '') IS NULL
           OR NULLIF(BTRIM(node->>'label'), '') IS NULL
           OR node->>'type' NOT IN ('start', 'approval', 'signature', 'delay', 'end')
       )
       OR EXISTS (
         SELECT node->>'id'
         FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         GROUP BY node->>'id'
         HAVING COUNT(*) > 1
       )
       OR EXISTS (
         SELECT edge->>'id'
         FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
         GROUP BY edge->>'id'
         HAVING COUNT(*) > 1
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
         WHERE edge->>'source' = edge->>'target'
           OR NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
             WHERE node->>'id' = edge->>'source'
           )
           OR NOT EXISTS (
             SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
             WHERE node->>'id' = edge->>'target'
           )
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE (
           SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
           WHERE edge->>'target' = node->>'id'
         ) <> CASE WHEN node->>'type' = 'start' THEN 0 ELSE 1 END
         OR (
           SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
           WHERE edge->>'source' = node->>'id'
         ) <> CASE WHEN node->>'type' = 'end' THEN 0 ELSE 1 END
       )
       OR EXISTS (
         SELECT 1
         FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') runtime_step
           WHERE runtime_step->>'id' = node->>'id'
         )
       ) THEN
      RETURN FALSE;
    END IF;

    WITH RECURSIVE graph_path(node_id) AS (
      SELECT node->>'id'
      FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
      WHERE node->>'type' = 'start'
      UNION
      SELECT edge->>'target'
      FROM graph_path path
      JOIN LATERAL jsonb_array_elements(requested_definition->'builder'->'edges') edge
        ON edge->>'source' = path.node_id
    )
    SELECT COUNT(*) INTO reachable_count FROM graph_path;
    IF reachable_count <> builder_node_count THEN RETURN FALSE; END IF;
  END IF;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_organization_workflow_definition(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_organization_workflow_definition(JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.publish_organization_workflow(
  ws_id UUID,
  target_workflow_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  workflow_record public.organization_approval_workflows%ROWTYPE;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'workflows.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO workflow_record
  FROM public.organization_approval_workflows
  WHERE id = target_workflow_id AND workspace_id = ws_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF workflow_record.status <> 'draft' THEN
    RAISE EXCEPTION 'only_draft_workflows_can_be_published' USING ERRCODE = '55000';
  END IF;
  IF NOT public.validate_organization_workflow_definition(workflow_record.definition) THEN
    RAISE EXCEPTION 'published_organization_workflow_is_invalid' USING ERRCODE = '23514';
  END IF;

  UPDATE public.organization_approval_workflows
  SET status = 'published',
      published_at = CURRENT_TIMESTAMP,
      published_by = auth.uid(),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_workflow_id;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, module
  ) VALUES (
    ws_id, auth.uid(), 'workflow.published', 'organization_approval_workflow',
    target_workflow_id::TEXT, 'Flujo de aprobación publicado',
    jsonb_build_object(
      'version', workflow_record.version,
      'definition_schema_version', COALESCE(workflow_record.definition->>'schema_version', '1')
    ), 'workflows'
  );
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
  first_action_type TEXT;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'workflows.execute') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(BTRIM(requested_subject_type), '') IS NULL
     OR NULLIF(BTRIM(requested_subject_id), '') IS NULL
     OR requested_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'workflow_instance_request_is_incomplete' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO workflow_record
  FROM public.organization_approval_workflows
  WHERE id = target_workflow_id AND workspace_id = ws_id AND status = 'published';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published_organization_workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.validate_organization_workflow_definition(workflow_record.definition) THEN
    RAISE EXCEPTION 'published_organization_workflow_is_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO instance_id
  FROM public.organization_workflow_instances
  WHERE workspace_id = ws_id AND idempotency_key = requested_idempotency_key;
  IF FOUND THEN RETURN instance_id; END IF;

  SELECT (value->>'order')::INTEGER, value->>'type'
  INTO first_action_order, first_action_type
  FROM jsonb_array_elements(workflow_record.definition->'steps')
  WHERE value->>'type' <> 'start'
  ORDER BY (value->>'order')::INTEGER
  LIMIT 1;

  INSERT INTO public.organization_workflow_instances (
    workspace_id, workflow_id, workflow_version, definition_snapshot, subject_type,
    subject_id, current_step_order, context, idempotency_key, started_by
  ) VALUES (
    ws_id, workflow_record.id, workflow_record.version, workflow_record.definition,
    BTRIM(requested_subject_type), BTRIM(requested_subject_id), COALESCE(first_action_order, 1),
    COALESCE(requested_context, '{}'::JSONB), requested_idempotency_key, auth.uid()
  ) RETURNING id INTO instance_id;

  FOR step IN
    SELECT value FROM jsonb_array_elements(workflow_record.definition->'steps')
  LOOP
    INSERT INTO public.organization_workflow_step_instances (
      workspace_id, workflow_instance_id, step_id, step_order, step_type, label,
      assignee_type, assignee_id, status, due_at, configuration
    ) VALUES (
      ws_id,
      instance_id,
      COALESCE(NULLIF(step->>'id', ''), 'step-' || (step->>'order')),
      (step->>'order')::INTEGER,
      step->>'type',
      step->>'label',
      NULLIF(step->>'assignee_type', ''),
      NULLIF(step->>'assignee_id', ''),
      CASE
        WHEN step->>'type' = 'start' THEN 'approved'
        WHEN (step->>'order')::INTEGER = first_action_order THEN 'active'
        ELSE 'pending'
      END,
      CASE
        WHEN (step->>'order')::INTEGER = first_action_order
             AND step->>'type' = 'wait'
             AND NULLIF(step->>'sla_hours', '') IS NOT NULL
        THEN CURRENT_TIMESTAMP + make_interval(hours => (step->>'sla_hours')::INTEGER)
        ELSE NULL
      END,
      COALESCE(step->'configuration', '{}'::JSONB)
    );
  END LOOP;

  IF first_action_type IN ('approved', 'rejected', 'cancelled') THEN
    UPDATE public.organization_workflow_step_instances
    SET status = 'approved', acted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE workflow_instance_id = instance_id AND step_order = first_action_order;
    UPDATE public.organization_workflow_instances
    SET status = first_action_type,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = instance_id;
  END IF;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, module
  ) VALUES (
    ws_id, auth.uid(), 'workflow.instance.started', 'organization_workflow_instance',
    instance_id::TEXT, 'Instancia de flujo iniciada',
    jsonb_build_object(
      'workflow_id', target_workflow_id,
      'workflow_version', workflow_record.version,
      'subject_type', requested_subject_type,
      'subject_id', requested_subject_id
    ), 'workflows'
  );
  RETURN instance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_organization_workflow_instance_internal(
  target_instance_id UUID,
  target_step_id TEXT,
  requested_outcome TEXT,
  requested_actor UUID,
  requested_event_id UUID,
  requested_comment TEXT,
  requested_evidence JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  instance_record public.organization_workflow_instances%ROWTYPE;
  current_step public.organization_workflow_step_instances%ROWTYPE;
  next_step public.organization_workflow_step_instances%ROWTYPE;
  instance_outcome TEXT;
BEGIN
  IF requested_outcome NOT IN ('approved', 'rejected', 'skipped', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'workflow_step_outcome_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO instance_record
  FROM public.organization_workflow_instances
  WHERE id = target_instance_id AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT * INTO current_step
  FROM public.organization_workflow_step_instances
  WHERE workflow_instance_id = target_instance_id
    AND step_id = target_step_id
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.organization_workflow_step_instances
  SET status = requested_outcome,
      acted_by = requested_actor,
      acted_at = CURRENT_TIMESTAMP,
      decision_comment = NULLIF(BTRIM(requested_comment), ''),
      completion_event_id = requested_event_id,
      evidence = COALESCE(evidence, '{}'::JSONB) || COALESCE(requested_evidence, '{}'::JSONB),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = current_step.id AND status = 'active';

  IF requested_outcome IN ('rejected', 'cancelled', 'failed') THEN
    instance_outcome := CASE requested_outcome
      WHEN 'rejected' THEN 'rejected'
      WHEN 'cancelled' THEN 'cancelled'
      ELSE 'failed'
    END;
    UPDATE public.organization_workflow_step_instances
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE workflow_instance_id = target_instance_id AND status = 'pending';
    UPDATE public.organization_workflow_instances
    SET status = instance_outcome,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = target_instance_id;
  ELSE
    SELECT * INTO next_step
    FROM public.organization_workflow_step_instances
    WHERE workflow_instance_id = target_instance_id
      AND step_order > current_step.step_order
      AND status = 'pending'
    ORDER BY step_order
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      UPDATE public.organization_workflow_instances
      SET status = 'approved', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = target_instance_id;
    ELSIF next_step.step_type IN ('approved', 'rejected', 'cancelled') THEN
      UPDATE public.organization_workflow_step_instances
      SET status = 'approved', acted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = next_step.id;
      UPDATE public.organization_workflow_instances
      SET status = next_step.step_type,
          current_step_order = next_step.step_order,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = target_instance_id;
    ELSE
      UPDATE public.organization_workflow_step_instances
      SET status = 'active',
          due_at = CASE
            WHEN step_type = 'wait' AND COALESCE(configuration->>'duration_hours', '') ~ '^[0-9]+$'
            THEN CURRENT_TIMESTAMP + make_interval(hours => (configuration->>'duration_hours')::INTEGER)
            WHEN step_type = 'wait' AND COALESCE(configuration->>'duration_value', '') ~ '^[0-9]+$'
            THEN CURRENT_TIMESTAMP + make_interval(
              hours => CASE
                WHEN configuration->>'duration_unit' = 'days'
                THEN (configuration->>'duration_value')::INTEGER * 24
                ELSE (configuration->>'duration_value')::INTEGER
              END
            )
            ELSE due_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = next_step.id;
      UPDATE public.organization_workflow_instances
      SET current_step_order = next_step.step_order, updated_at = CURRENT_TIMESTAMP
      WHERE id = target_instance_id;
    END IF;
  END IF;

  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, module
  ) VALUES (
    instance_record.workspace_id,
    requested_actor,
    'workflow.step.completed',
    'organization_workflow_instance',
    target_instance_id::TEXT,
    'Etapa de flujo completada',
    jsonb_build_object(
      'step_id', target_step_id,
      'step_type', current_step.step_type,
      'outcome', requested_outcome,
      'canonical_event_id', requested_event_id
    ),
    'workflows'
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_organization_workflow_instance_internal(
  UUID, TEXT, TEXT, UUID, UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_organization_workflow_step(
  ws_id UUID,
  target_instance_id UUID,
  target_step_id TEXT,
  requested_decision TEXT,
  requested_comment TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  step_record public.organization_workflow_step_instances%ROWTYPE;
  actor_member_id UUID;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'workflows.execute') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF requested_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'workflow_manual_decision_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT step.* INTO step_record
  FROM public.organization_workflow_step_instances step
  JOIN public.organization_workflow_instances instance ON instance.id = step.workflow_instance_id
  WHERE step.workspace_id = ws_id
    AND step.workflow_instance_id = target_instance_id
    AND step.step_id = target_step_id
    AND step.status = 'active'
    AND instance.status = 'active'
  FOR UPDATE OF step;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active_workflow_step_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF step_record.step_type NOT IN ('approval', 'review') THEN
    RAISE EXCEPTION 'workflow_step_is_not_manually_actionable' USING ERRCODE = '55000';
  END IF;
  IF step_record.assignee_id IS NOT NULL THEN
    SELECT id INTO actor_member_id
    FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND status = 'active'
    LIMIT 1;
    IF step_record.assignee_id NOT IN (auth.uid()::TEXT, COALESCE(actor_member_id::TEXT, ''))
       AND NOT public.has_organization_permission(ws_id, 'workflows.manage') THEN
      RAISE EXCEPTION 'workflow_step_assignee_required' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN public.advance_organization_workflow_instance_internal(
    target_instance_id,
    target_step_id,
    requested_decision,
    auth.uid(),
    NULL,
    requested_comment,
    jsonb_build_object('source', 'manual_approval')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_organization_workflow_step(
  UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_organization_workflow_step(
  UUID, UUID, TEXT, TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_organization_workflow_from_canonical_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate RECORD;
  expected_event TEXT;
BEGIN
  FOR candidate IN
    SELECT instance.id AS instance_id, step.step_id, step.configuration
    FROM public.organization_workflow_instances instance
    JOIN public.organization_workflow_step_instances step
      ON step.workflow_instance_id = instance.id
    WHERE instance.workspace_id = NEW.workspace_id
      AND instance.subject_type = 'document'
      AND instance.subject_id = NEW.document_id::TEXT
      AND instance.status = 'active'
      AND step.status = 'active'
      AND step.step_type = 'signature'
    FOR UPDATE OF instance, step
  LOOP
    expected_event := COALESCE(
      NULLIF(candidate.configuration->>'completion_event', ''),
      'document.completed'
    );
    IF expected_event = NEW.event_type THEN
      PERFORM public.advance_organization_workflow_instance_internal(
        candidate.instance_id,
        candidate.step_id,
        'approved',
        NEW.actor_user_id,
        NEW.id,
        NULL,
        jsonb_build_object(
          'source', 'canonical_event',
          'event_type', NEW.event_type,
          'correlation_id', NEW.correlation_id
        )
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS advance_org_workflow_on_document_event
  ON public.document_operational_events;
CREATE TRIGGER advance_org_workflow_on_document_event
  AFTER INSERT ON public.document_operational_events
  FOR EACH ROW EXECUTE FUNCTION public.advance_organization_workflow_from_canonical_event();

REVOKE ALL ON FUNCTION public.advance_organization_workflow_from_canonical_event()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.advance_due_organization_workflow_steps(
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  p_limit INTEGER DEFAULT 25
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate RECORD;
  advanced_count INTEGER := 0;
BEGIN
  FOR candidate IN
    SELECT workflow_instance_id, step_id
    FROM public.organization_workflow_step_instances
    WHERE step_type = 'wait'
      AND status = 'active'
      AND due_at IS NOT NULL
      AND due_at <= p_now
    ORDER BY due_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public.advance_organization_workflow_instance_internal(
      candidate.workflow_instance_id,
      candidate.step_id,
      'approved',
      NULL,
      NULL,
      NULL,
      jsonb_build_object('source', 'phase_c_scheduler', 'due_at', p_now)
    ) THEN
      advanced_count := advanced_count + 1;
    END IF;
  END LOOP;
  RETURN advanced_count;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_due_organization_workflow_steps(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_due_organization_workflow_steps(TIMESTAMPTZ, INTEGER)
  TO service_role;

REVOKE ALL ON FUNCTION public.publish_organization_workflow(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_organization_workflow_instance(UUID, UUID, TEXT, TEXT, JSONB, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_organization_workflow(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_organization_workflow_instance(UUID, UUID, TEXT, TEXT, JSONB, UUID)
  TO authenticated;

UPDATE public.platform_feature_flags
SET name = 'Workflow Builder',
    description = 'Definiciones visuales versionadas sobre organization_workflow_instances.',
    updated_at = CURRENT_TIMESTAMP
WHERE flag_key = 'workflow_builder';
