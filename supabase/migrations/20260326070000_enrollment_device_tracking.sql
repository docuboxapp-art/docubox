-- Add enrollment device/IP/browser tracking columns to enrollment_tokens
ALTER TABLE public.enrollment_tokens
  ADD COLUMN IF NOT EXISTS enrollment_ip TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_browser TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_device TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_os TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_city TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_country TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_region TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS enrollment_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS enrollment_place_name TEXT,
  ADD COLUMN IF NOT EXISTS enrollment_logged_at TIMESTAMPTZ;
