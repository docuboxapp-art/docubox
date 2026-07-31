-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP calls from cron
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if it exists (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expiry-check-hourly') THEN
    PERFORM cron.unschedule('expiry-check-hourly');
  END IF;
END $$;

-- Schedule expiry check to run every hour
-- This will:
--   1. Send 72h expiry warnings to owners and participants
--   2. Mark overdue documents as 'vencido' and notify all parties
SELECT cron.schedule(
  'expiry-check-hourly',
  '0 * * * *',  -- every hour at minute 0
  $$
  SELECT net.http_post(
    url := current_setting('app.site_url', true) || '/api/notifications/expiry-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
