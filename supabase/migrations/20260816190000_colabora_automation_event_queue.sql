-- Queue published Colabora automations from canonical activity events.
-- The unique idempotency key prevents duplicate runs when an event is replayed.

CREATE OR REPLACE FUNCTION public.enqueue_collaboration_automations_for_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate RECORD;
  event_depth INTEGER;
BEGIN
  event_depth := COALESCE((NEW.metadata ->> 'automation_depth')::INTEGER, 0);

  FOR candidate IN
    SELECT
      automation.id AS automation_id,
      automation.workspace_id,
      automation.max_depth,
      version.id AS version_id,
      version.trigger_definition
    FROM public.collaboration_automations automation
    JOIN public.collaboration_automation_versions version
      ON version.automation_id = automation.id
     AND version.version = automation.current_version
     AND version.published_at IS NOT NULL
    WHERE automation.workspace_id = NEW.workspace_id
      AND automation.status = 'active'
      AND (
        version.trigger_definition ->> 'event_type' = NEW.event_type
        OR version.trigger_definition ->> 'event_type' = '*'
      )
  LOOP
    IF event_depth < candidate.max_depth THEN
      INSERT INTO public.collaboration_automation_runs (
        workspace_id,
        automation_id,
        automation_version_id,
        event_id,
        idempotency_key,
        correlation_id,
        depth,
        input_snapshot,
        status,
        scheduled_at
      )
      VALUES (
        candidate.workspace_id,
        candidate.automation_id,
        candidate.version_id,
        NEW.id::TEXT,
        'activity:' || NEW.id::TEXT || ':automation:' || candidate.automation_id::TEXT,
        NEW.correlation_id,
        event_depth + 1,
        jsonb_build_object(
          'activity_event_id', NEW.id,
          'event_type', NEW.event_type,
          'resource_type', NEW.resource_type,
          'resource_id', NEW.resource_id,
          'actor_user_id', NEW.actor_user_id,
          'metadata', NEW.metadata
        ),
        'queued',
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_collaboration_automations_activity
  ON public.collaboration_activity_events;
CREATE TRIGGER enqueue_collaboration_automations_activity
AFTER INSERT ON public.collaboration_activity_events
FOR EACH ROW EXECUTE FUNCTION public.enqueue_collaboration_automations_for_activity();

REVOKE ALL ON FUNCTION public.enqueue_collaboration_automations_for_activity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_collaboration_automations_for_activity()
  TO service_role;
