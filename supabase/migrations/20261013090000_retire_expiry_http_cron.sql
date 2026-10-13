-- Vercel Cron now invokes /api/notifications/expiry-check hourly with CRON_SECRET.
-- The old pg_cron job used unset app.site_url/app.service_role_key settings,
-- producing an invalid pg_net URL on every execution.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expiry-check-hourly') THEN
    PERFORM cron.unschedule('expiry-check-hourly');
  END IF;
END;
$$;
