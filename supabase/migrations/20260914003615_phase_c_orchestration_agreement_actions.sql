-- DOCUBOX Phase C: extend the existing Colabora automation/event runtime.
-- This migration is additive and does not modify signed documents, evidence,
-- cryptographic material, participant JSONB semantics or existing workflows.

CREATE TABLE IF NOT EXISTS public.document_send_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','processing','retrying','succeeded','failed','cancelled','skipped')),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 240),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(payload) = 'object'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_by TEXT,
  claim_expires_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_detail TEXT CHECK (last_error_detail IS NULL OR char_length(last_error_detail) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS document_send_schedules_due_idx
  ON public.document_send_schedules(status, COALESCE(next_retry_at, scheduled_at))
  WHERE status IN ('scheduled','retrying');

CREATE TABLE IF NOT EXISTS public.document_routing_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  participant_reference_id UUID NOT NULL REFERENCES public.document_participant_references(id) ON DELETE CASCADE,
  participant_json_id TEXT NOT NULL,
  source_event_id UUID REFERENCES public.document_operational_events(id) ON DELETE SET NULL,
  routing_mode TEXT NOT NULL CHECK (routing_mode IN ('delay','date_time','after_event')),
  activate_at TIMESTAMPTZ,
  wait_event_type TEXT CHECK (wait_event_type IS NULL OR wait_event_type ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  timezone TEXT CHECK (timezone IS NULL OR char_length(timezone) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('waiting_event','scheduled','processing','retrying','succeeded','failed','cancelled','skipped')),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 240),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_by TEXT,
  claim_expires_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_detail TEXT CHECK (last_error_detail IS NULL OR char_length(last_error_detail) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, idempotency_key),
  CHECK (
    (routing_mode = 'after_event' AND wait_event_type IS NOT NULL
      AND ((status = 'waiting_event' AND activate_at IS NULL)
        OR (status <> 'waiting_event' AND activate_at IS NOT NULL)))
    OR (routing_mode IN ('delay','date_time') AND activate_at IS NOT NULL AND status <> 'waiting_event')
  )
);

CREATE INDEX IF NOT EXISTS document_routing_schedules_due_idx
  ON public.document_routing_schedules(status, COALESCE(next_retry_at, activate_at))
  WHERE status IN ('scheduled','retrying');
CREATE INDEX IF NOT EXISTS document_routing_schedules_wait_event_idx
  ON public.document_routing_schedules(document_id, wait_event_type)
  WHERE status = 'waiting_event';

ALTER TABLE public.collaboration_automation_runs
  ADD COLUMN IF NOT EXISTS canonical_event_id UUID REFERENCES public.document_operational_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS condition_result JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.collaboration_automation_runs
  DROP CONSTRAINT IF EXISTS collaboration_automation_runs_status_check;
ALTER TABLE public.collaboration_automation_runs
  ADD CONSTRAINT collaboration_automation_runs_status_check
  CHECK (status IN ('queued','running','succeeded','retrying','failed','dead_lettered','cancelled','skipped'));

CREATE TABLE IF NOT EXISTS public.collaboration_automation_action_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_run_id UUID NOT NULL REFERENCES public.collaboration_automation_runs(id) ON DELETE CASCADE,
  automation_version_id UUID NOT NULL REFERENCES public.collaboration_automation_versions(id) ON DELETE RESTRICT,
  canonical_event_id UUID REFERENCES public.document_operational_events(id) ON DELETE SET NULL,
  action_index INTEGER NOT NULL CHECK (action_index BETWEEN 0 AND 99),
  action_type TEXT NOT NULL CHECK (action_type IN ('notify','activity','webhook','document_metadata','create_task','request_nom151')),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 300),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','succeeded','retrying','failed','cancelled','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  result_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_code TEXT,
  error_detail TEXT CHECK (error_detail IS NULL OR char_length(error_detail) <= 1000),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (automation_run_id, action_index)
);

CREATE INDEX IF NOT EXISTS collaboration_automation_action_runs_status_idx
  ON public.collaboration_automation_action_runs(workspace_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS tareas_automation_main_action_unique
  ON public.tareas(workspace_id, main_action)
  WHERE main_action LIKE 'automation:%';

ALTER TABLE public.organization_webhook_deliveries
  ADD COLUMN IF NOT EXISTS canonical_event_id UUID REFERENCES public.document_operational_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correlation_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.organization_webhook_deliveries
  DROP CONSTRAINT IF EXISTS organization_webhook_deliveries_status_check;
ALTER TABLE public.organization_webhook_deliveries
  ADD CONSTRAINT organization_webhook_deliveries_status_check
  CHECK (status IN ('pending','processing','retrying','delivered','failed','discarded'));

CREATE UNIQUE INDEX IF NOT EXISTS organization_webhook_delivery_logical_key
  ON public.organization_webhook_deliveries(endpoint_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS organization_webhook_deliveries_due_idx
  ON public.organization_webhook_deliveries(status, COALESCE(next_retry_at, created_at))
  WHERE status IN ('pending','retrying');

ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fallback_channel TEXT
    CHECK (fallback_channel IS NULL OR fallback_channel IN ('email','sms')),
  ADD COLUMN IF NOT EXISTS delivery_policy TEXT NOT NULL DEFAULT 'single'
    CHECK (delivery_policy IN ('single','fallback','multidelivery'));

CREATE INDEX IF NOT EXISTS notification_deliveries_due_phase_c_idx
  ON public.notification_deliveries(status, COALESCE(next_retry_at, queued_at))
  WHERE status IN ('queued','failed');

CREATE OR REPLACE FUNCTION public.enforce_phase_c_schedule_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  document_workspace UUID;
BEGIN
  SELECT workspace_id INTO document_workspace
  FROM public.documentos
  WHERE id = NEW.document_id;

  IF NOT FOUND OR document_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'phase_c_schedule_document_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'document_routing_schedules'
     AND NOT EXISTS (
       SELECT 1 FROM public.document_participant_references participant
       WHERE participant.id = NEW.participant_reference_id
         AND participant.document_id = NEW.document_id
         AND participant.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
     ) THEN
    RAISE EXCEPTION 'phase_c_schedule_participant_scope_mismatch' USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_document_send_schedule_scope ON public.document_send_schedules;
CREATE TRIGGER enforce_document_send_schedule_scope
  BEFORE INSERT OR UPDATE ON public.document_send_schedules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase_c_schedule_scope();
DROP TRIGGER IF EXISTS enforce_document_routing_schedule_scope ON public.document_routing_schedules;
CREATE TRIGGER enforce_document_routing_schedule_scope
  BEFORE INSERT OR UPDATE ON public.document_routing_schedules
  FOR EACH ROW EXECUTE FUNCTION public.enforce_phase_c_schedule_scope();

CREATE OR REPLACE FUNCTION public.claim_due_document_send_schedule(
  p_worker_id TEXT,
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS SETOF public.document_send_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     OR length(btrim(COALESCE(p_worker_id, ''))) < 4 THEN
    RAISE EXCEPTION 'phase_c_worker_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT schedule.id
    FROM public.document_send_schedules schedule
    WHERE schedule.status IN ('scheduled','retrying')
      AND COALESCE(schedule.next_retry_at, schedule.scheduled_at) <= p_now
      AND (schedule.claim_expires_at IS NULL OR schedule.claim_expires_at <= p_now)
    ORDER BY COALESCE(schedule.next_retry_at, schedule.scheduled_at), schedule.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.document_send_schedules schedule
  SET status = 'processing',
      claimed_by = p_worker_id,
      claim_expires_at = p_now + INTERVAL '5 minutes',
      attempt_count = schedule.attempt_count + 1,
      last_error_code = NULL,
      last_error_detail = NULL,
      updated_at = p_now
  FROM candidate
  WHERE schedule.id = candidate.id
  RETURNING schedule.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_document_routing_schedule(
  p_worker_id TEXT,
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS SETOF public.document_routing_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     OR length(btrim(COALESCE(p_worker_id, ''))) < 4 THEN
    RAISE EXCEPTION 'phase_c_worker_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT schedule.id
    FROM public.document_routing_schedules schedule
    WHERE schedule.status IN ('scheduled','retrying')
      AND COALESCE(schedule.next_retry_at, schedule.activate_at) <= p_now
      AND (schedule.claim_expires_at IS NULL OR schedule.claim_expires_at <= p_now)
    ORDER BY COALESCE(schedule.next_retry_at, schedule.activate_at), schedule.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.document_routing_schedules schedule
  SET status = 'processing',
      claimed_by = p_worker_id,
      claim_expires_at = p_now + INTERVAL '5 minutes',
      attempt_count = schedule.attempt_count + 1,
      last_error_code = NULL,
      last_error_detail = NULL,
      updated_at = p_now
  FROM candidate
  WHERE schedule.id = candidate.id
  RETURNING schedule.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_organization_webhook_delivery(
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS SETOF public.organization_webhook_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'phase_c_worker_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT delivery.id
    FROM public.organization_webhook_deliveries delivery
    WHERE delivery.status IN ('pending','retrying')
      AND COALESCE(delivery.next_retry_at, delivery.created_at) <= p_now
    ORDER BY COALESCE(delivery.next_retry_at, delivery.created_at), delivery.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.organization_webhook_deliveries delivery
  SET status = 'processing',
      attempt_number = delivery.attempt_number + CASE WHEN delivery.status = 'retrying' THEN 1 ELSE 0 END,
      updated_at = p_now
  FROM candidate
  WHERE delivery.id = candidate.id
  RETURNING delivery.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_notification_delivery(
  p_now TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
RETURNS SETOF public.notification_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'phase_c_worker_not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT delivery.id
    FROM public.notification_deliveries delivery
    WHERE delivery.status IN ('queued','failed')
      AND delivery.channel IN ('email','sms')
      AND COALESCE(delivery.next_retry_at, delivery.queued_at) <= p_now
    ORDER BY COALESCE(delivery.next_retry_at, delivery.queued_at), delivery.queued_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.notification_deliveries delivery
  SET status = 'processing',
      attempt_count = delivery.attempt_count + 1,
      updated_at = p_now
  FROM candidate
  WHERE delivery.id = candidate.id
  RETURNING delivery.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_phase_c_for_document_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate RECORD;
  event_depth INTEGER;
BEGIN
  event_depth := COALESCE((NEW.payload ->> 'automation_depth')::INTEGER, 0);

  UPDATE public.document_routing_schedules
  SET status = 'scheduled',
      activate_at = NEW.occurred_at,
      source_event_id = NEW.id,
      updated_at = CURRENT_TIMESTAMP
  WHERE document_id = NEW.document_id
    AND workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND status = 'waiting_event'
    AND wait_event_type = NEW.event_type;

  FOR candidate IN
    SELECT automation.id AS automation_id,
           automation.workspace_id,
           automation.max_depth,
           version.id AS version_id,
           version.version
    FROM public.collaboration_automations automation
    JOIN public.collaboration_automation_versions version
      ON version.automation_id = automation.id
     AND version.version = automation.current_version
     AND version.published_at IS NOT NULL
    WHERE automation.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
      AND automation.status = 'active'
      AND COALESCE(version.trigger_definition ->> 'event_type', version.trigger_definition ->> 'event')
          IN (NEW.event_type, '*')
  LOOP
    IF event_depth < candidate.max_depth THEN
      INSERT INTO public.collaboration_automation_runs (
        workspace_id, automation_id, automation_version_id, event_id,
        canonical_event_id, idempotency_key, correlation_id, depth,
        input_snapshot, status, scheduled_at
      ) VALUES (
        candidate.workspace_id,
        candidate.automation_id,
        candidate.version_id,
        NEW.id::TEXT,
        NEW.id,
        'canonical:' || NEW.id::TEXT || ':automation:' || candidate.automation_id::TEXT || ':version:' || candidate.version::TEXT,
        NEW.correlation_id,
        event_depth + 1,
        jsonb_build_object(
          'canonical_event_id', NEW.id,
          'event_type', NEW.event_type,
          'document_id', NEW.document_id,
          'workspace_id', NEW.workspace_id,
          'participant_reference_id', NEW.participant_reference_id,
          'actor_user_id', NEW.actor_user_id,
          'occurred_at', NEW.occurred_at,
          'payload', NEW.payload
        ),
        'queued',
        CURRENT_TIMESTAMP
      ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.organization_webhook_deliveries (
    workspace_id, endpoint_id, event_type, event_id, canonical_event_id,
    correlation_id, idempotency_key, payload, status, attempt_number
  )
  SELECT endpoint.workspace_id,
         endpoint.id,
         NEW.event_type,
         NEW.id,
         NEW.id,
         NEW.correlation_id,
         'canonical:' || NEW.id::TEXT || ':endpoint:' || endpoint.id::TEXT,
         '{}'::JSONB,
         'pending',
         1
  FROM public.organization_webhook_endpoints endpoint
  WHERE endpoint.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
    AND endpoint.status = 'active'
    AND (NEW.event_type = ANY(endpoint.event_types) OR '*' = ANY(endpoint.event_types))
  ON CONFLICT (endpoint_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_phase_c_document_event ON public.document_operational_events;
CREATE TRIGGER enqueue_phase_c_document_event
AFTER INSERT ON public.document_operational_events
FOR EACH ROW EXECUTE FUNCTION public.enqueue_phase_c_for_document_event();

CREATE OR REPLACE FUNCTION public.emit_document_terminal_operational_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized_state TEXT;
  event_name TEXT;
BEGIN
  normalized_state := lower(COALESCE(NEW.estado, ''));
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  event_name := CASE
    WHEN normalized_state IN ('completado','completed','firmado') THEN 'document.completed'
    WHEN normalized_state IN ('cancelado','cancelled') THEN 'document.cancelled'
    WHEN normalized_state IN ('vencido','expired') THEN 'document.expired'
    ELSE NULL
  END;
  IF event_name IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.document_operational_events (
    workspace_id, document_id, event_type, event_key, source, payload
  ) VALUES (
    NEW.workspace_id,
    NEW.id,
    event_name,
    'document-state:' || event_name,
    'database',
    jsonb_build_object('previous_status', OLD.estado, 'status', NEW.estado)
  ) ON CONFLICT (document_id, event_key) DO NOTHING;

  IF event_name IN ('document.cancelled','document.expired') THEN
    UPDATE public.document_send_schedules
      SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE document_id = NEW.id AND status IN ('scheduled','retrying');
    UPDATE public.document_routing_schedules
      SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE document_id = NEW.id AND status IN ('waiting_event','scheduled','retrying');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emit_document_terminal_event ON public.documentos;
CREATE TRIGGER emit_document_terminal_event
AFTER UPDATE OF estado ON public.documentos
FOR EACH ROW EXECUTE FUNCTION public.emit_document_terminal_operational_event();

ALTER TABLE public.document_send_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_routing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_automation_action_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_send_schedules_read ON public.document_send_schedules;
CREATE POLICY document_send_schedules_read ON public.document_send_schedules
  FOR SELECT TO authenticated USING (public.can_access_documento(document_id));
DROP POLICY IF EXISTS document_routing_schedules_read ON public.document_routing_schedules;
CREATE POLICY document_routing_schedules_read ON public.document_routing_schedules
  FOR SELECT TO authenticated USING (public.can_access_documento(document_id));
DROP POLICY IF EXISTS collaboration_automation_action_runs_read ON public.collaboration_automation_action_runs;
CREATE POLICY collaboration_automation_action_runs_read ON public.collaboration_automation_action_runs
  FOR SELECT TO authenticated
  USING (public.has_organization_permission(workspace_id, 'automations.view'));

REVOKE ALL ON public.document_send_schedules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.document_routing_schedules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.collaboration_automation_action_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_send_schedules TO authenticated;
GRANT SELECT ON public.document_routing_schedules TO authenticated;
GRANT SELECT ON public.collaboration_automation_action_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_send_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_routing_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collaboration_automation_action_runs TO service_role;

REVOKE ALL ON FUNCTION public.enforce_phase_c_schedule_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_document_send_schedule(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_document_routing_schedule(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_organization_webhook_delivery(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_notification_delivery(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_phase_c_for_document_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emit_document_terminal_operational_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_document_send_schedule(TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_document_routing_schedule(TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_organization_webhook_delivery(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_notification_delivery(TIMESTAMPTZ) TO service_role;

INSERT INTO public.platform_feature_flags (
  flag_key, name, description, global_enabled, rollout_percentage, allowed_plans
) VALUES
  ('delayed_routing', 'Routing programado', 'Habilita transiciones temporales sobre el routing documental existente.', false, 0, '{}'),
  ('multichannel_orchestration', 'Orquestación multicanal', 'Habilita adaptadores de entrega sobre Notification Service.', false, 0, '{}'),
  ('webhook_dispatcher', 'Despachador de webhooks', 'Habilita entregas HMAC desde eventos canónicos.', false, 0, '{}')
ON CONFLICT (flag_key) DO NOTHING;

COMMENT ON TABLE public.document_send_schedules IS
  'Additive, tenant-scoped schedule records. Workers must atomically claim and revalidate the document before delivery.';
COMMENT ON TABLE public.document_routing_schedules IS
  'Temporal gates layered after AUTH-003 commit and before the existing participant routing activation.';
COMMENT ON TABLE public.collaboration_automation_action_runs IS
  'Per-action execution ledger extending the existing versioned Colabora automation runtime.';
