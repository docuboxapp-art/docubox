-- Details entered by the launcher are suggestions, never verified identity data.
ALTER TABLE public.form_tokens
  ADD COLUMN IF NOT EXISTS launch_prefill jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.form_send_schedules
  ADD COLUMN IF NOT EXISTS launch_prefill jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.form_public_invitees (
  form_id uuid NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  launch_prefill jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (form_id, recipient_email),
  CONSTRAINT form_public_invitees_lowercase_email CHECK (recipient_email = lower(recipient_email))
);

CREATE INDEX IF NOT EXISTS form_public_invitees_invited_by_idx
  ON public.form_public_invitees (invited_by, invited_at DESC);

ALTER TABLE public.form_public_invitees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_public_invitees FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_public_invitees TO service_role;
