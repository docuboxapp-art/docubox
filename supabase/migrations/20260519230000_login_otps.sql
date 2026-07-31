-- Migration: login_otps table for 6-digit OTP login codes
-- Timestamp: 20260519230000

CREATE TABLE IF NOT EXISTS public.login_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by email + code
CREATE INDEX IF NOT EXISTS login_otps_email_code_idx ON public.login_otps (email, otp_code);
CREATE INDEX IF NOT EXISTS login_otps_user_id_idx ON public.login_otps (user_id);

-- RLS: only service role can access (no user-level access needed)
ALTER TABLE public.login_otps ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (bypasses RLS by default)
-- No additional policies needed since we use service role key in API routes
