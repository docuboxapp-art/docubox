-- Migration: signature_otps table for OTP verification during signing
-- Timestamp: 20260512010000

CREATE TABLE IF NOT EXISTS public.signature_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, document_id)
);

ALTER TABLE public.signature_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_otps" ON public.signature_otps;
CREATE POLICY "users_manage_own_otps"
  ON public.signature_otps
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
