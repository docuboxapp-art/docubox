-- Keep the one-minute dispatcher cadence without waking Vercel or reading
-- Vault when the claimant has no eligible scheduled/retry/abandoned send.
DO $migration$
DECLARE
  dispatch_job_id bigint;
BEGIN
  SELECT jobid INTO dispatch_job_id
  FROM cron.job WHERE jobname = 'form-launch-dispatch';
  IF dispatch_job_id IS NULL THEN
    RAISE EXCEPTION 'form-launch-dispatch job is missing';
  END IF;

  PERFORM cron.alter_job(job_id := dispatch_job_id, command := $command$
    SELECT net.http_post(
      url := config.dispatch_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-docubox-cron-timestamp', floor(extract(epoch FROM now()))::bigint::text,
        'x-docubox-cron-signature', encode(extensions.hmac(
          floor(extract(epoch FROM now()))::bigint::text,
          secret.decrypted_secret, 'sha256'), 'hex')
      ),
      body := '{}'::jsonb
    )
    FROM public.form_dispatch_config AS config
    JOIN vault.decrypted_secrets AS secret ON secret.id = config.secret_id
    WHERE EXISTS (
      SELECT 1 FROM public.form_send_schedules
      WHERE (status IN ('scheduled', 'retrying')
        AND COALESCE(next_retry_at, scheduled_at) <= now())
        OR (status = 'processing' AND claim_expires_at <= now())
    );
  $command$);
END;
$migration$;
