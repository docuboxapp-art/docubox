-- Colabora automation effects must remain idempotent across retries and worker restarts.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency
  ON public.notifications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.collaboration_activity_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_collaboration_activity_idempotency
  ON public.collaboration_activity_events(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.notifications.idempotency_key IS
  'Backend-only key used to deduplicate side effects such as automation notifications.';

COMMENT ON COLUMN public.collaboration_activity_events.idempotency_key IS
  'Workspace-scoped key used to deduplicate automation and integration events.';
