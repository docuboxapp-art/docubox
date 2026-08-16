-- Backend-only, idempotent usage metering and hard limits for billable Colabora resources.
CREATE OR REPLACE FUNCTION public.record_collaboration_usage_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entitlement TEXT;
  v_meter TEXT;
  v_limit NUMERIC;
  v_usage NUMERIC := 0;
  v_should_meter BOOLEAN := TRUE;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'collaboration_spaces' THEN
      v_entitlement := 'collaboration_core'; v_meter := 'active_spaces';
    WHEN 'collaboration_rooms' THEN
      v_entitlement := 'collaboration_external_rooms'; v_meter := 'external_rooms';
    WHEN 'collaboration_room_guests' THEN
      v_entitlement := 'collaboration_external_rooms'; v_meter := 'external_guests';
    WHEN 'collaboration_automation_runs' THEN
      v_entitlement := 'collaboration_automations'; v_meter := 'automation_runs';
    ELSE
      RETURN NEW;
  END CASE;

  -- Serialize the meter per workspace. This prevents two concurrent requests from
  -- both observing the same remaining capacity and exceeding the contracted limit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.workspace_id::TEXT || ':' || v_meter, 0)
  );

  SELECT NULLIF(oe.limits ->> v_meter, '')::NUMERIC
    INTO v_limit
  FROM public.organization_entitlements oe
  WHERE oe.workspace_id = NEW.workspace_id
    AND oe.entitlement_key = v_entitlement
    AND oe.status IN ('trialing', 'active', 'past_due')
    AND (oe.starts_at IS NULL OR oe.starts_at <= CURRENT_TIMESTAMP)
    AND (oe.ends_at IS NULL OR oe.ends_at > CURRENT_TIMESTAMP)
  LIMIT 1;

  IF TG_TABLE_NAME = 'collaboration_spaces' THEN
    v_should_meter := NEW.status = 'active';
    IF v_should_meter THEN
      SELECT COUNT(*) INTO v_usage
      FROM public.collaboration_spaces
      WHERE workspace_id = NEW.workspace_id AND status = 'active';
    END IF;
  ELSIF TG_TABLE_NAME = 'collaboration_rooms' THEN
    v_should_meter := NEW.status = 'active';
    IF v_should_meter THEN
      SELECT COUNT(*) INTO v_usage
      FROM public.collaboration_rooms
      WHERE workspace_id = NEW.workspace_id AND status = 'active';
    END IF;
  ELSIF TG_TABLE_NAME = 'collaboration_room_guests' THEN
    v_should_meter := NEW.status NOT IN ('expired', 'revoked', 'blocked');
    IF v_should_meter THEN
      SELECT COUNT(*) INTO v_usage
      FROM public.collaboration_room_guests
      WHERE workspace_id = NEW.workspace_id
        AND status NOT IN ('expired', 'revoked', 'blocked');
    END IF;
  ELSE
    SELECT COALESCE(SUM(quantity), 0) INTO v_usage
    FROM public.collaboration_usage_events
    WHERE workspace_id = NEW.workspace_id
      AND meter_key = v_meter
      AND occurred_at >= date_trunc('month', CURRENT_TIMESTAMP);
  END IF;

  -- AFTER INSERT means the current resource is already represented in table counts.
  -- Event meters are historical, so include the current execution explicitly.
  IF TG_TABLE_NAME = 'collaboration_automation_runs' THEN
    v_usage := v_usage + 1;
  END IF;

  IF v_should_meter AND v_limit IS NOT NULL AND v_usage > v_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'collaboration_usage_limit_exceeded',
      DETAIL = format('meter=%s usage=%s limit=%s', v_meter, v_usage, v_limit),
      HINT = 'Upgrade the Colabora entitlement or release active capacity.';
  END IF;

  IF NOT v_should_meter THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.collaboration_usage_events(
    workspace_id, entitlement_key, meter_key, quantity,
    idempotency_key, resource_type, resource_id, metadata
  ) VALUES (
    NEW.workspace_id, v_entitlement, v_meter, 1,
    TG_TABLE_NAME || ':' || NEW.id::TEXT, TG_TABLE_NAME, NEW.id,
    jsonb_build_object('source', 'database_trigger')
  ) ON CONFLICT (workspace_id, meter_key, idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collaboration_spaces_meter_insert ON public.collaboration_spaces;
CREATE TRIGGER collaboration_spaces_meter_insert
  AFTER INSERT ON public.collaboration_spaces
  FOR EACH ROW EXECUTE FUNCTION public.record_collaboration_usage_insert();

DROP TRIGGER IF EXISTS collaboration_rooms_meter_insert ON public.collaboration_rooms;
CREATE TRIGGER collaboration_rooms_meter_insert
  AFTER INSERT ON public.collaboration_rooms
  FOR EACH ROW EXECUTE FUNCTION public.record_collaboration_usage_insert();

DROP TRIGGER IF EXISTS collaboration_room_guests_meter_insert ON public.collaboration_room_guests;
CREATE TRIGGER collaboration_room_guests_meter_insert
  AFTER INSERT ON public.collaboration_room_guests
  FOR EACH ROW EXECUTE FUNCTION public.record_collaboration_usage_insert();

DROP TRIGGER IF EXISTS collaboration_automation_runs_meter_insert ON public.collaboration_automation_runs;
CREATE TRIGGER collaboration_automation_runs_meter_insert
  AFTER INSERT ON public.collaboration_automation_runs
  FOR EACH ROW EXECUTE FUNCTION public.record_collaboration_usage_insert();

REVOKE ALL ON FUNCTION public.record_collaboration_usage_insert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_collaboration_usage_event_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit NUMERIC;
  v_usage NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.workspace_id::TEXT || ':' || NEW.meter_key, 0)
  );
  SELECT NULLIF(oe.limits ->> NEW.meter_key, '')::NUMERIC
    INTO v_limit
  FROM public.organization_entitlements oe
  WHERE oe.workspace_id = NEW.workspace_id
    AND oe.entitlement_key = NEW.entitlement_key
    AND oe.status IN ('trialing', 'active', 'past_due')
    AND (oe.starts_at IS NULL OR oe.starts_at <= CURRENT_TIMESTAMP)
    AND (oe.ends_at IS NULL OR oe.ends_at > CURRENT_TIMESTAMP)
  LIMIT 1;
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity), 0)
    INTO v_usage
  FROM public.collaboration_usage_events
  WHERE workspace_id = NEW.workspace_id
    AND meter_key = NEW.meter_key
    AND occurred_at >= date_trunc('month', CURRENT_TIMESTAMP);
  IF v_usage + NEW.quantity > v_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'collaboration_usage_limit_exceeded',
      DETAIL = format('meter=%s usage=%s requested=%s limit=%s', NEW.meter_key, v_usage, NEW.quantity, v_limit),
      HINT = 'Upgrade the Colabora entitlement before retrying.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collaboration_usage_limit_before_insert
  ON public.collaboration_usage_events;
CREATE TRIGGER collaboration_usage_limit_before_insert
  BEFORE INSERT ON public.collaboration_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_collaboration_usage_event_limit();

REVOKE ALL ON FUNCTION public.enforce_collaboration_usage_event_limit()
  FROM PUBLIC, anon, authenticated;
