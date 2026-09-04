-- Canonical operational notification model. Certified electronic notifications
-- remain in their dedicated tables and are never substituted by this feed.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'legacy.notification',
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unread',
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS action_url TEXT,
  ADD COLUMN IF NOT EXISTS action_label TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

UPDATE public.notifications
SET
  category = CASE lower(type)
    WHEN 'document' THEN 'DOCUMENT'
    WHEN 'task' THEN 'WORKFLOW'
    WHEN 'request' THEN 'ORGANIZATION'
    WHEN 'alert' THEN 'SYSTEM'
    ELSE 'SYSTEM'
  END,
  event_type = CASE lower(type)
    WHEN 'document' THEN 'document.legacy_notification'
    WHEN 'task' THEN 'workflow.legacy_notification'
    WHEN 'request' THEN 'organization.legacy_notification'
    WHEN 'alert' THEN 'system.legacy_alert'
    ELSE 'system.legacy_notification'
  END,
  severity = CASE priority
    WHEN 'alta' THEN 'warning'
    WHEN 'baja' THEN 'info'
    ELSE 'info'
  END,
  status = CASE WHEN read THEN 'read' ELSE 'unread' END,
  read_at = CASE WHEN read AND read_at IS NULL THEN created_at ELSE read_at END
WHERE event_type = 'legacy.notification';

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_category_check,
  DROP CONSTRAINT IF EXISTS notifications_severity_check,
  DROP CONSTRAINT IF EXISTS notifications_status_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_category_check CHECK (category IN (
    'DOCUMENT','SIGNATURE','WORKFLOW','APPROVAL','SECURITY','ORGANIZATION',
    'BILLING','CERTIFICATION','RETENTION','SYSTEM','ACCOUNT','REMINDER'
  )),
  ADD CONSTRAINT notifications_severity_check CHECK (severity IN ('info','success','warning','critical')),
  ADD CONSTRAINT notifications_status_check CHECK (status IN ('unread','read','archived'));

CREATE OR REPLACE FUNCTION public.sync_notification_read_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at = now();
  END IF;

  IF NEW.status = 'read' AND NEW.read_at IS NULL THEN
    NEW.read_at = now();
  END IF;

  IF NEW.status = 'unread' THEN
    NEW.read_at = NULL;
  END IF;

  NEW.read = NEW.status <> 'unread';
  IF NEW.read AND NEW.read_at IS NULL THEN
    NEW.read_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_notification_read_state ON public.notifications;
CREATE TRIGGER sync_notification_read_state
  BEFORE INSERT OR UPDATE OF read, status, read_at, archived_at ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_notification_read_state();

CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created
  ON public.notifications(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_created
  ON public.notifications(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_category_created
  ON public.notifications(user_id, category, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency
  ON public.notifications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'DOCUMENT','SIGNATURE','WORKFLOW','APPROVAL','SECURITY','ORGANIZATION',
    'BILLING','CERTIFICATION','RETENTION','SYSTEM','ACCOUNT','REMINDER'
  )),
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, category)
);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app','email','sms','whatsapp','push','webhook')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','delivered','failed','bounced','cancelled')),
  provider TEXT,
  provider_message_id TEXT,
  recipient_email_sha256 TEXT CHECK (recipient_email_sha256 ~ '^[a-f0-9]{64}$'),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  last_error_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(notification_id, channel)
);

CREATE TABLE IF NOT EXISTS public.notification_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE RESTRICT,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('created','deduplicated','read','unread','archived','delivery_queued','delivery_sent','delivery_failed')),
  request_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_event_log_notification_created
  ON public.notification_event_log(notification_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_retry
  ON public.notification_deliveries(status, queued_at)
  WHERE status IN ('queued','failed');

CREATE OR REPLACE FUNCTION public.reject_notification_event_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Notification event log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS immutable_notification_event_log ON public.notification_event_log;
CREATE TRIGGER immutable_notification_event_log
  BEFORE UPDATE OR DELETE ON public.notification_event_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_notification_event_log_mutation();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_event_log ENABLE ROW LEVEL SECURITY;

-- Browser clients may only read their own operational notifications. State
-- changes and all creation are server-side so they are auditable and cannot be forged.
DROP POLICY IF EXISTS "users_manage_own_notifications" ON public.notifications;
DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS notification_preferences_own ON public.notification_preferences;
CREATE POLICY notification_preferences_own ON public.notification_preferences
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO service_role;

REVOKE ALL ON TABLE public.notification_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_preferences TO service_role;

REVOKE ALL ON TABLE public.notification_deliveries FROM anon, authenticated;
REVOKE ALL ON TABLE public.notification_event_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_event_log TO service_role;

COMMENT ON TABLE public.notifications IS
  'User-facing operational feed. It is not legal evidence and is written only by server-side notification services.';
COMMENT ON TABLE public.notification_deliveries IS
  'Backend-only channel delivery ledger. Email addresses are represented by SHA-256 only.';
COMMENT ON TABLE public.notification_event_log IS
  'Append-only operational audit for notification lifecycle events.';
