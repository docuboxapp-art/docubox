CREATE TABLE public.form_send_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.form_templates(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requester_name text NOT NULL,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  signature_type text NOT NULL CHECK (signature_type IN ('click_sign', 'autografa_digital', 'efirma_sat')),
  require_liveness boolean NOT NULL DEFAULT false,
  expiration_hours numeric,
  delivery_expires_at timestamptz,
  scheduled_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'retrying', 'sent', 'failed', 'cancelled')),
  token_id uuid REFERENCES public.form_tokens(id),
  attempt_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  claim_expires_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_send_schedules_expiration_hours_check CHECK (expiration_hours IS NULL OR expiration_hours BETWEEN (1.0 / 60.0) AND 720)
);

CREATE INDEX form_send_schedules_due_idx ON public.form_send_schedules (scheduled_at)
  WHERE status IN ('scheduled', 'retrying', 'processing');
CREATE INDEX form_send_schedules_template_idx ON public.form_send_schedules (template_id, created_at DESC);
ALTER TABLE public.form_send_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_send_schedules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_send_schedules TO service_role;

CREATE FUNCTION public.claim_due_form_sends(p_limit integer DEFAULT 20)
RETURNS SETOF public.form_send_schedules
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH due AS (
    SELECT id
    FROM public.form_send_schedules
    WHERE (
      status IN ('scheduled', 'retrying')
      AND COALESCE(next_retry_at, scheduled_at) <= now()
    ) OR (status = 'processing' AND claim_expires_at <= now())
    ORDER BY scheduled_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  UPDATE public.form_send_schedules AS schedule
  SET status = 'processing',
      attempt_count = schedule.attempt_count + 1,
      claim_expires_at = now() + interval '5 minutes',
      updated_at = now()
  FROM due
  WHERE schedule.id = due.id
  RETURNING schedule.*;
$$;

REVOKE ALL ON FUNCTION public.claim_due_form_sends(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_form_sends(integer) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE TABLE public.form_dispatch_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  dispatch_url text NOT NULL,
  secret_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.form_dispatch_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_dispatch_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.form_dispatch_config TO service_role;

CREATE FUNCTION public.configure_form_dispatch(p_url text, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  IF p_url !~ '^https://[^/]+/api/internal/form-launch-dispatch$'
     OR length(p_secret) < 16 THEN
    RAISE EXCEPTION 'Configuración de envío inválida';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('form_launch_dispatch_secret'));
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'form_launch_dispatch_secret';
  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(p_secret, 'form_launch_dispatch_secret', 'Autenticación del procesador de formularios');
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secret);
  END IF;
  INSERT INTO public.form_dispatch_config (singleton, dispatch_url, secret_id)
  VALUES (true, p_url, v_secret_id)
  ON CONFLICT (singleton) DO UPDATE
  SET dispatch_url = EXCLUDED.dispatch_url, secret_id = EXCLUDED.secret_id, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.configure_form_dispatch(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_form_dispatch(text, text) TO service_role;

CREATE FUNCTION public.get_form_dispatch_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT secret.decrypted_secret
  FROM public.form_dispatch_config AS config
  JOIN vault.decrypted_secrets AS secret ON secret.id = config.secret_id
  WHERE config.singleton = true;
$$;
REVOKE ALL ON FUNCTION public.get_form_dispatch_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_form_dispatch_secret() TO service_role;

SELECT cron.schedule(
  'form-launch-dispatch',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := config.dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-docubox-cron-timestamp', floor(extract(epoch FROM now()))::bigint::text,
      'x-docubox-cron-signature', encode(extensions.hmac(floor(extract(epoch FROM now()))::bigint::text, secret.decrypted_secret, 'sha256'), 'hex')
    ),
    body := '{}'::jsonb
  )
  FROM public.form_dispatch_config AS config
  JOIN vault.decrypted_secrets AS secret ON secret.id = config.secret_id;
  $$
);
