-- Only run with an empty live dispatch queue. Uses a repeatable snapshot and
-- rolls back: this check must not create a real outbound request.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '25s';
DO $test$
DECLARE job_command text; before_queue bigint; after_queue bigint; mismatches integer;
BEGIN
  WITH fixture(status, scheduled_at, next_retry_at, claim_expires_at, eligible) AS (
    VALUES
      ('scheduled',now()-interval '1 min',null::timestamptz,null::timestamptz,true),
      ('scheduled',now()+interval '1 min',null::timestamptz,null::timestamptz,false),
      ('retrying',now()-interval '2 min',now()-interval '1 min',null::timestamptz,true),
      ('retrying',now()-interval '2 min',now()+interval '1 min',null::timestamptz,false),
      ('processing',now()-interval '2 min',null::timestamptz,now()-interval '1 min',true),
      ('processing',now()-interval '2 min',null::timestamptz,now()+interval '1 min',false),
      ('processing',now()-interval '2 min',null::timestamptz,null::timestamptz,false),
      ('sent',now()-interval '2 min',null::timestamptz,null::timestamptz,false),
      ('failed',now()-interval '2 min',null::timestamptz,null::timestamptz,false),
      ('cancelled',now()-interval '2 min',null::timestamptz,null::timestamptz,false),
      ('scheduled',now(),null::timestamptz,null::timestamptz,true)
  )
  SELECT count(*) INTO mismatches FROM fixture WHERE
    coalesce((status IN ('scheduled','retrying') AND coalesce(next_retry_at,scheduled_at)<=now())
      OR (status='processing' AND claim_expires_at<=now()),false) IS DISTINCT FROM eligible;
  IF mismatches <> 0 THEN RAISE EXCEPTION 'Dispatcher eligibility regression'; END IF;
  SELECT command INTO job_command FROM cron.job WHERE jobname='form-launch-dispatch';
  IF job_command NOT ILIKE '%WHERE EXISTS%' OR job_command NOT ILIKE '%form_send_schedules%' THEN
    RAISE EXCEPTION 'Dispatcher idle guard missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.form_send_schedules WHERE
     (status IN ('scheduled','retrying') AND coalesce(next_retry_at,scheduled_at)<=now())
     OR(status='processing' AND claim_expires_at<=now())) THEN
    SELECT count(*) INTO before_queue FROM net.http_request_queue;
    EXECUTE job_command;
    SELECT count(*) INTO after_queue FROM net.http_request_queue;
    IF after_queue <> before_queue THEN RAISE EXCEPTION 'Empty dispatcher enqueued an HTTP request'; END IF;
  ELSE
    RAISE EXCEPTION 'Skip network check: live queue is not empty';
  END IF;
END $test$;
ROLLBACK;
