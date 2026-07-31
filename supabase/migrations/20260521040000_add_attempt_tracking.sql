-- Add attempt tracking columns to mobile_upload_sessions (for /captura-id-movil)
ALTER TABLE public.mobile_upload_sessions
  ADD COLUMN IF NOT EXISTS id_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selfie_attempt_count integer NOT NULL DEFAULT 0;

-- Add attempt tracking columns to enrollment_tokens (for /enrolamiento)
ALTER TABLE public.enrollment_tokens
  ADD COLUMN IF NOT EXISTS id_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selfie_attempt_count integer NOT NULL DEFAULT 0;

-- Allow 'cancelled' as a valid status for mobile_upload_sessions
-- (status column is typically text, so no enum change needed)
-- Allow 'cancelled' as a valid status for enrollment_tokens
-- (status column is typically text, so no enum change needed)
