-- Email verification tokens table
-- Stores tokens for custom email verification flow (button-based, no OTP)

CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON public.email_verification_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON public.email_verification_tokens(user_id);

ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_email_verification_tokens" ON public.email_verification_tokens;
CREATE POLICY "service_role_manage_email_verification_tokens"
  ON public.email_verification_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "users_read_own_email_verification_tokens" ON public.email_verification_tokens;
CREATE POLICY "users_read_own_email_verification_tokens"
  ON public.email_verification_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Add email_verified column to user_profiles if not exists
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NULL;
