-- Add metadata column to mobile_upload_sessions for id_capture mode
ALTER TABLE public.mobile_upload_sessions
  ADD COLUMN IF NOT EXISTS metadata JSONB;
