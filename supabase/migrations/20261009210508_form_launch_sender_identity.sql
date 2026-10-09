-- Keep the identity of the person who actually launched each private invitation.
-- Template ownership and workspace names are not reliable substitutes on reminders.
ALTER TABLE public.form_tokens
  ADD COLUMN IF NOT EXISTS launched_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS launcher_name text,
  ADD COLUMN IF NOT EXISTS sent_to_self boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.form_tokens.launcher_name IS
  'Display-name snapshot of the authenticated user who launched the form.';
COMMENT ON COLUMN public.form_tokens.sent_to_self IS
  'Whether the launcher addressed the invitation to their own account email.';
