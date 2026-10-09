-- Invitation links remain private. Public forms mint a separate, user-bound token
-- only after the respondent has authenticated with a verified account.
ALTER TABLE public.form_tokens
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES auth.users(id);

ALTER TABLE public.form_tokens
  DROP CONSTRAINT IF EXISTS form_tokens_access_mode_check;
ALTER TABLE public.form_tokens
  ADD CONSTRAINT form_tokens_access_mode_check
  CHECK (access_mode IN ('private', 'public'));

CREATE INDEX IF NOT EXISTS form_tokens_public_respondent_idx
  ON public.form_tokens (template_id, recipient_user_id)
  WHERE access_mode = 'public' AND recipient_user_id IS NOT NULL;

ALTER TABLE public.form_responses
  ADD COLUMN IF NOT EXISTS respondent_user_id uuid REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS form_responses_one_public_response_per_user
  ON public.form_responses (template_id, respondent_user_id)
  WHERE respondent_user_id IS NOT NULL;
