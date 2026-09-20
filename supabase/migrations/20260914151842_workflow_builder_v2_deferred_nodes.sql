-- Workflow Builder V2 executes deferred nodes on the existing organization
-- workflow runtime. No parallel definition, instance, scheduler or event bus.

ALTER TABLE public.organization_workflow_step_instances
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS execution_claim_token UUID,
  ADD COLUMN IF NOT EXISTS execution_claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_code TEXT
    CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  ADD COLUMN IF NOT EXISTS branch_decision BOOLEAN,
  ADD COLUMN IF NOT EXISTS branch_decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS organization_workflow_executable_steps_due_idx
  ON public.organization_workflow_step_instances(
    status, COALESCE(next_retry_at, created_at), execution_claim_expires_at
  )
  WHERE step_type IN ('notification','action','webhook','condition') AND status = 'active';

COMMENT ON COLUMN public.organization_workflow_step_instances.branch_decision IS
  'Committed true/false decision for a condition step; retries never reevaluate it.';
COMMENT ON COLUMN public.organization_workflow_step_instances.execution_claim_token IS
  'Short-lived worker claim on the existing canonical workflow step instance.';

CREATE OR REPLACE FUNCTION public.validate_organization_workflow_definition(requested_definition JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  step JSONB;
  schema_version INTEGER := COALESCE((requested_definition->>'schema_version')::INTEGER, 1);
  expected_order INTEGER := 1;
  start_count INTEGER := 0;
  terminal_count INTEGER := 0;
  builder_node_count INTEGER := 0;
  reachable_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(requested_definition) <> 'object'
     OR jsonb_typeof(requested_definition->'steps') <> 'array'
     OR jsonb_array_length(requested_definition->'steps') < 2
     OR jsonb_array_length(requested_definition->'steps') > 60 THEN
    RETURN FALSE;
  END IF;

  FOR step IN
    SELECT value FROM jsonb_array_elements(requested_definition->'steps')
    ORDER BY (value->>'order')::INTEGER
  LOOP
    IF NULLIF(BTRIM(step->>'id'), '') IS NULL
       OR NULLIF(BTRIM(step->>'label'), '') IS NULL
       OR COALESCE(step->>'order', '') !~ '^[0-9]+$'
       OR (step->>'order')::INTEGER <> expected_order
       OR COALESCE(step->>'type', '') NOT IN (
         'start','review','approval','signature','identity','condition','notification',
         'action','webhook','wait','approved','rejected','cancelled'
       ) THEN
      RETURN FALSE;
    END IF;
    IF step->>'type' = 'start' THEN start_count := start_count + 1; END IF;
    IF step->>'type' IN ('approved','rejected','cancelled') THEN
      terminal_count := terminal_count + 1;
    END IF;
    expected_order := expected_order + 1;
  END LOOP;
  IF start_count <> 1 OR terminal_count < 1 THEN RETURN FALSE; END IF;

  IF schema_version IN (2, 3) THEN
    IF jsonb_typeof(requested_definition->'builder'->'nodes') <> 'array'
       OR jsonb_typeof(requested_definition->'builder'->'edges') <> 'array' THEN
      RETURN FALSE;
    END IF;
    SELECT jsonb_array_length(requested_definition->'builder'->'nodes')
      INTO builder_node_count;
    IF builder_node_count <> jsonb_array_length(requested_definition->'steps')
       OR (SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
           WHERE node->>'type' = 'start') <> 1
       OR (SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
           WHERE node->>'type' = 'end') < 1
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE NULLIF(node->>'id', '') IS NULL
           OR NULLIF(BTRIM(node->>'label'), '') IS NULL
           OR node->>'type' NOT IN (
             'start','approval','signature','delay','notification','action','webhook','condition','end'
           )
       )
       OR EXISTS (
         SELECT node->>'id' FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         GROUP BY node->>'id' HAVING COUNT(*) > 1
       )
       OR EXISTS (
         SELECT edge->>'id' FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
         GROUP BY edge->>'id' HAVING COUNT(*) > 1
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
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
         SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE (
           SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
           WHERE edge->>'target' = node->>'id'
         ) <> CASE WHEN node->>'type' = 'start' THEN 0 ELSE 1 END
         OR (
           SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
           WHERE edge->>'source' = node->>'id'
         ) <> CASE
           WHEN node->>'type' = 'end' THEN 0
           WHEN schema_version = 3 AND node->>'type' = 'condition' THEN 2
           ELSE 1
         END
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') runtime_step
           WHERE runtime_step->>'id' = node->>'id'
         )
       ) THEN
      RETURN FALSE;
    END IF;

    IF schema_version = 2 THEN
      IF requested_definition->>'mode' <> 'sequential'
         OR jsonb_array_length(requested_definition->'builder'->'edges') <> builder_node_count - 1
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
           WHERE node->>'type' NOT IN ('start','approval','signature','delay','end')
         ) THEN RETURN FALSE; END IF;
    ELSE
      IF requested_definition->>'mode' <> 'directed_acyclic'
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'nodes') node
           WHERE node->>'type' = 'condition'
             AND (
               (SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
                WHERE edge->>'source' = node->>'id' AND edge->>'branch' = 'true') <> 1
               OR
               (SELECT COUNT(*) FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
                WHERE edge->>'source' = node->>'id' AND edge->>'branch' = 'false') <> 1
             )
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') runtime_step
           WHERE runtime_step->>'type' = 'notification'
             AND (
               COALESCE(runtime_step->'configuration'->>'recipient', '') NOT IN ('owner','participant')
               OR jsonb_typeof(runtime_step->'configuration'->'channels') <> 'array'
               OR jsonb_array_length(runtime_step->'configuration'->'channels') < 1
               OR EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(runtime_step->'configuration'->'channels') channel
                 WHERE channel NOT IN ('in_app','email','sms')
               )
             )
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') runtime_step
           WHERE runtime_step->>'type' = 'action'
             AND COALESCE(runtime_step->'configuration'->'action'->>'type', '') NOT IN (
               'notify','activity','webhook','document_metadata','create_task',
               'request_nom151','trigger_lucia_contractual'
             )
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') runtime_step
           WHERE runtime_step->>'type' = 'condition'
             AND (
               COALESCE(runtime_step->'configuration'->'condition'->>'field', '') NOT IN (
                 'event.type','document.status','document.type_id','document.classification',
                 'document.template_id','participant.reference_id','organization.id',
                 'workspace.id','package.status','package.resource_count'
               )
               OR COALESCE(runtime_step->'configuration'->'condition'->>'operator', '') NOT IN (
                 'equals','not_equals','exists','not_exists','contains','in','greater_than','less_than'
               )
             )
         ) THEN RETURN FALSE; END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(requested_definition->'steps') runtime_step
        WHERE (
          runtime_step->>'type' = 'condition'
          AND (
            NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
              WHERE edge->>'source' = runtime_step->>'id' AND edge->>'branch' = 'true'
                AND edge->>'target' = runtime_step->'configuration'->>'true_step_id'
            )
            OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
              WHERE edge->>'source' = runtime_step->>'id' AND edge->>'branch' = 'false'
                AND edge->>'target' = runtime_step->'configuration'->>'false_step_id'
            )
          )
        ) OR (
          runtime_step->>'type' NOT IN ('condition','approved','rejected','cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(requested_definition->'builder'->'edges') edge
            WHERE edge->>'source' = runtime_step->>'id'
              AND edge->>'target' = runtime_step->'configuration'->>'next_step_id'
          )
        )
      ) THEN RETURN FALSE; END IF;
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
  SELECT * INTO workflow_record FROM public.organization_approval_workflows
  WHERE id = target_workflow_id AND workspace_id = ws_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF workflow_record.status <> 'draft' THEN
    RAISE EXCEPTION 'only_draft_workflows_can_be_published' USING ERRCODE = '55000';
  END IF;
  IF NOT public.validate_organization_workflow_definition(workflow_record.definition) THEN
    RAISE EXCEPTION 'published_organization_workflow_is_invalid' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(workflow_record.definition->'steps') step
    WHERE (
      step->>'type' = 'webhook'
      OR (step->>'type' = 'action' AND step->'configuration'->'action'->>'type' = 'webhook')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_webhook_endpoints endpoint
      WHERE endpoint.id = COALESCE(
        NULLIF(step->'configuration'->>'webhook_configuration_id', '')::UUID,
        NULLIF(step->'configuration'->'action'->>'endpoint_id', '')::UUID
      )
      AND endpoint.workspace_id = ws_id
      AND endpoint.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'workflow_webhook_reference_invalid' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_approval_workflows
  SET status = 'published', published_at = CURRENT_TIMESTAMP,
      published_by = auth.uid(), updated_at = CURRENT_TIMESTAMP
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
  first_action_id TEXT;
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'published_organization_workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.validate_organization_workflow_definition(workflow_record.definition) THEN
    RAISE EXCEPTION 'published_organization_workflow_is_invalid' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO instance_id FROM public.organization_workflow_instances
  WHERE workspace_id = ws_id AND idempotency_key = requested_idempotency_key;
  IF FOUND THEN RETURN instance_id; END IF;

  IF COALESCE((workflow_record.definition->>'schema_version')::INTEGER, 1) >= 3 THEN
    SELECT value->'configuration'->>'next_step_id' INTO first_action_id
    FROM jsonb_array_elements(workflow_record.definition->'steps')
    WHERE value->>'type' = 'start' LIMIT 1;
    SELECT (value->>'order')::INTEGER, value->>'type'
      INTO first_action_order, first_action_type
    FROM jsonb_array_elements(workflow_record.definition->'steps')
    WHERE value->>'id' = first_action_id LIMIT 1;
  ELSE
    SELECT (value->>'order')::INTEGER, value->>'type'
      INTO first_action_order, first_action_type
    FROM jsonb_array_elements(workflow_record.definition->'steps')
    WHERE value->>'type' <> 'start'
    ORDER BY (value->>'order')::INTEGER LIMIT 1;
  END IF;

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
      assignee_type, assignee_id, status, due_at, configuration
    ) VALUES (
      ws_id, instance_id, step->>'id', (step->>'order')::INTEGER,
      step->>'type', step->>'label', NULLIF(step->>'assignee_type', ''),
      NULLIF(step->>'assignee_id', ''),
      CASE
        WHEN step->>'type' = 'start' THEN 'approved'
        WHEN (step->>'order')::INTEGER = first_action_order THEN 'active'
        ELSE 'pending'
      END,
      CASE WHEN (step->>'order')::INTEGER = first_action_order
             AND step->>'type' = 'wait' AND NULLIF(step->>'sla_hours', '') IS NOT NULL
        THEN CURRENT_TIMESTAMP + make_interval(hours => (step->>'sla_hours')::INTEGER)
        ELSE NULL END,
      COALESCE(step->'configuration', '{}'::JSONB)
    );
  END LOOP;
  IF first_action_type IN ('approved','rejected','cancelled') THEN
    UPDATE public.organization_workflow_step_instances
    SET status = 'approved', acted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE workflow_instance_id = instance_id AND step_order = first_action_order;
    UPDATE public.organization_workflow_instances
    SET status = first_action_type, completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = instance_id;
  END IF;
  INSERT INTO public.organization_audit_events (
    workspace_id, actor_user_id, event_type, resource_type, resource_id,
    summary, payload, module
  ) VALUES (
    ws_id, auth.uid(), 'workflow.instance.started', 'organization_workflow_instance',
    instance_id::TEXT, 'Instancia de flujo iniciada',
    jsonb_build_object('workflow_id', target_workflow_id, 'workflow_version', workflow_record.version,
      'subject_type', requested_subject_type, 'subject_id', requested_subject_id), 'workflows'
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
  target_step_identifier TEXT;
BEGIN
  IF requested_outcome NOT IN ('approved','rejected','skipped','cancelled','failed') THEN
    RAISE EXCEPTION 'workflow_step_outcome_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO instance_record FROM public.organization_workflow_instances
  WHERE id = target_instance_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO current_step FROM public.organization_workflow_step_instances
  WHERE workflow_instance_id = target_instance_id AND step_id = target_step_id
    AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.organization_workflow_step_instances
  SET status = requested_outcome, acted_by = requested_actor,
      acted_at = CURRENT_TIMESTAMP, decision_comment = NULLIF(BTRIM(requested_comment), ''),
      completion_event_id = requested_event_id,
      evidence = COALESCE(evidence, '{}'::JSONB) || COALESCE(requested_evidence, '{}'::JSONB),
      execution_claim_token = NULL, execution_claim_expires_at = NULL,
      next_retry_at = NULL, last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
  WHERE id = current_step.id AND status = 'active';

  IF requested_outcome IN ('rejected','cancelled','failed') THEN
    instance_outcome := CASE requested_outcome WHEN 'rejected' THEN 'rejected'
      WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END;
    UPDATE public.organization_workflow_step_instances
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE workflow_instance_id = target_instance_id AND status = 'pending';
    UPDATE public.organization_workflow_instances
    SET status = instance_outcome, completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP WHERE id = target_instance_id;
  ELSE
    IF COALESCE((instance_record.definition_snapshot->>'schema_version')::INTEGER, 1) >= 3 THEN
      target_step_identifier := CASE WHEN current_step.step_type = 'condition' THEN
        CASE WHEN current_step.branch_decision IS TRUE
          THEN current_step.configuration->>'true_step_id'
          ELSE current_step.configuration->>'false_step_id' END
        ELSE current_step.configuration->>'next_step_id' END;
      SELECT * INTO next_step FROM public.organization_workflow_step_instances
      WHERE workflow_instance_id = target_instance_id AND step_id = target_step_identifier
        AND status = 'pending' FOR UPDATE;
    ELSE
      SELECT * INTO next_step FROM public.organization_workflow_step_instances
      WHERE workflow_instance_id = target_instance_id
        AND step_order > current_step.step_order AND status = 'pending'
      ORDER BY step_order LIMIT 1 FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      UPDATE public.organization_workflow_step_instances
      SET status = 'skipped', updated_at = CURRENT_TIMESTAMP
      WHERE workflow_instance_id = target_instance_id AND status = 'pending';
      UPDATE public.organization_workflow_instances
      SET status = 'approved', completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP WHERE id = target_instance_id;
    ELSIF next_step.step_type IN ('approved','rejected','cancelled') THEN
      UPDATE public.organization_workflow_step_instances
      SET status = 'approved', acted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = next_step.id;
      UPDATE public.organization_workflow_step_instances
      SET status = 'skipped', updated_at = CURRENT_TIMESTAMP
      WHERE workflow_instance_id = target_instance_id AND status = 'pending';
      UPDATE public.organization_workflow_instances
      SET status = next_step.step_type, current_step_order = next_step.step_order,
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = target_instance_id;
    ELSE
      UPDATE public.organization_workflow_step_instances
      SET status = 'active',
          due_at = CASE WHEN step_type = 'wait' AND NULLIF(configuration->>'duration_value', '') IS NOT NULL
            THEN CURRENT_TIMESTAMP + make_interval(hours =>
              CASE WHEN configuration->>'duration_unit' = 'days'
                THEN (configuration->>'duration_value')::INTEGER * 24
                ELSE (configuration->>'duration_value')::INTEGER END)
            ELSE due_at END,
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
    instance_record.workspace_id, requested_actor, 'workflow.step.completed',
    'organization_workflow_instance', target_instance_id::TEXT, 'Etapa de flujo completada',
    jsonb_build_object('step_id', target_step_id, 'step_type', current_step.step_type,
      'outcome', requested_outcome, 'canonical_event_id', requested_event_id,
      'branch_decision', current_step.branch_decision), 'workflows'
  );
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_organization_workflow_execution_step(
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS TABLE(
  step_instance_id UUID, workflow_instance_id UUID, workspace_id UUID,
  workflow_id UUID, workflow_version INTEGER, workflow_name TEXT,
  subject_type TEXT, subject_id TEXT, started_by UUID, context JSONB,
  step_id TEXT, step_type TEXT, configuration JSONB, attempt_count INTEGER,
  execution_claim_token UUID, branch_decision BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate_id UUID;
  claim_token UUID := gen_random_uuid();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'workflow_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT step.id INTO candidate_id
  FROM public.organization_workflow_step_instances step
  JOIN public.organization_workflow_instances instance
    ON instance.id = step.workflow_instance_id
  WHERE step.status = 'active' AND instance.status = 'active'
    AND step.step_type IN ('notification','action','webhook','condition')
    AND COALESCE(step.next_retry_at, step.created_at) <= p_now
    AND (step.execution_claim_token IS NULL OR step.execution_claim_expires_at <= p_now)
  ORDER BY COALESCE(step.next_retry_at, step.created_at), step.created_at
  LIMIT 1 FOR UPDATE OF step SKIP LOCKED;
  IF candidate_id IS NULL THEN RETURN; END IF;
  UPDATE public.organization_workflow_step_instances
  SET execution_claim_token = claim_token,
      execution_claim_expires_at = p_now + INTERVAL '5 minutes',
      attempt_count = attempt_count + 1,
      last_error_code = NULL,
      updated_at = p_now
  WHERE id = candidate_id;
  RETURN QUERY
  SELECT step.id, instance.id, step.workspace_id, instance.workflow_id,
    instance.workflow_version, workflow.name, instance.subject_type, instance.subject_id,
    instance.started_by, instance.context, step.step_id, step.step_type,
    step.configuration, step.attempt_count, step.execution_claim_token, step.branch_decision
  FROM public.organization_workflow_step_instances step
  JOIN public.organization_workflow_instances instance ON instance.id = step.workflow_instance_id
  JOIN public.organization_approval_workflows workflow ON workflow.id = instance.workflow_id
  WHERE step.id = candidate_id AND step.execution_claim_token = claim_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_organization_workflow_branch_decision(
  target_step_instance_id UUID,
  requested_claim_token UUID,
  requested_decision BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  committed BOOLEAN;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'workflow_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_workflow_step_instances
  SET branch_decision = COALESCE(branch_decision, requested_decision),
      branch_decided_at = COALESCE(branch_decided_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_step_instance_id AND step_type = 'condition' AND status = 'active'
    AND execution_claim_token = requested_claim_token
  RETURNING branch_decision INTO committed;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_condition_claim_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_organization_workflow_execution_step(
  target_step_instance_id UUID,
  requested_claim_token UUID,
  requested_result TEXT,
  requested_event_id UUID,
  requested_evidence JSONB,
  requested_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  step_record public.organization_workflow_step_instances%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'workflow_worker_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF requested_result NOT IN ('succeeded','retry','failed') THEN
    RAISE EXCEPTION 'workflow_execution_result_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO step_record FROM public.organization_workflow_step_instances
  WHERE id = target_step_instance_id AND status = 'active'
    AND execution_claim_token = requested_claim_token FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF requested_result = 'retry' THEN
    UPDATE public.organization_workflow_step_instances
    SET execution_claim_token = NULL, execution_claim_expires_at = NULL,
        next_retry_at = CURRENT_TIMESTAMP + make_interval(
          secs => LEAST(30 * (2 ^ GREATEST(attempt_count - 1, 0))::INTEGER, 3600)
        ),
        last_error_code = LEFT(COALESCE(requested_error_code, 'WORKFLOW_STEP_FAILED'), 120),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = target_step_instance_id;
    RETURN TRUE;
  END IF;
  UPDATE public.organization_workflow_step_instances
  SET execution_claim_token = NULL, execution_claim_expires_at = NULL,
      next_retry_at = NULL,
      last_error_code = CASE WHEN requested_result = 'failed'
        THEN LEFT(COALESCE(requested_error_code, 'WORKFLOW_STEP_FAILED'), 120) ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = target_step_instance_id;
  RETURN public.advance_organization_workflow_instance_internal(
    step_record.workflow_instance_id, step_record.step_id,
    CASE WHEN requested_result = 'succeeded' THEN 'approved' ELSE 'failed' END,
    NULL, requested_event_id, NULL,
    COALESCE(requested_evidence, '{}'::JSONB) || jsonb_build_object('worker_attempt', step_record.attempt_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_organization_workflow_execution_step(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_organization_workflow_branch_decision(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_organization_workflow_execution_step(UUID, UUID, TEXT, UUID, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_organization_workflow_execution_step(TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_organization_workflow_branch_decision(UUID, UUID, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_organization_workflow_execution_step(UUID, UUID, TEXT, UUID, JSONB, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.advance_organization_workflow_instance_internal(
  UUID, TEXT, TEXT, UUID, UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_organization_workflow(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_organization_workflow_instance(UUID, UUID, TEXT, TEXT, JSONB, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_organization_workflow(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_organization_workflow_instance(UUID, UUID, TEXT, TEXT, JSONB, UUID)
  TO authenticated;

UPDATE public.platform_feature_flags
SET name = 'Workflow Builder',
    description = 'Definiciones visuales versionadas con nodos respaldados por el runtime organizacional canonico.',
    updated_at = CURRENT_TIMESTAMP
WHERE flag_key = 'workflow_builder';
