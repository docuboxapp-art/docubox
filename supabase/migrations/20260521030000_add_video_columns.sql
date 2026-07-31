-- Add selfie_video_b64 column to id_capture_logs for storing 3-second video proof of life
ALTER TABLE public.id_capture_logs
  ADD COLUMN IF NOT EXISTS selfie_video_b64 TEXT;

-- Add raw_response JSONB column to enrollment_results for storing video and anverso base64
ALTER TABLE public.enrollment_results
  ADD COLUMN IF NOT EXISTS raw_response JSONB;
