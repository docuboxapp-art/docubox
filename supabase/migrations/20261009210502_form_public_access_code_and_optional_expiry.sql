-- A form link only expires when its author explicitly configures a validity period.
ALTER TABLE public.form_tokens ALTER COLUMN expires_at DROP NOT NULL;

-- Public codes are private to the server. The encrypted value lets an authorized
-- form owner retrieve the same code later without changing a shared invitation.
CREATE TABLE public.form_public_access_codes (
  form_id uuid PRIMARY KEY REFERENCES public.form_templates(id) ON DELETE CASCADE,
  code_lookup text NOT NULL UNIQUE,
  code_hash text NOT NULL,
  code_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.form_public_access_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_public_access_codes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_public_access_codes TO service_role;

CREATE TABLE public.form_public_code_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_lookup text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash text NOT NULL,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_public_code_attempts_window_idx
  ON public.form_public_code_attempts (user_id, created_at DESC);
ALTER TABLE public.form_public_code_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.form_public_code_attempts FROM anon, authenticated;
GRANT SELECT, INSERT ON public.form_public_code_attempts TO service_role;

ALTER TABLE public.form_tokens
  ADD COLUMN liveness_verified_at timestamptz,
  ADD COLUMN liveness_reference text;

COMMENT ON COLUMN public.form_tokens.liveness_verified_at IS
  'Provider-confirmed liveness before a public respondent received this token.';
