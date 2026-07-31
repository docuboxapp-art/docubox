-- Add image storage columns to id_capture_logs for posterior consultation
ALTER TABLE public.id_capture_logs
  ADD COLUMN IF NOT EXISTS anverso_b64 TEXT,
  ADD COLUMN IF NOT EXISTS reverso_b64 TEXT,
  ADD COLUMN IF NOT EXISTS selfie_b64 TEXT,
  ADD COLUMN IF NOT EXISTS curp_extracted TEXT,
  ADD COLUMN IF NOT EXISTS nombre_extracted TEXT,
  ADD COLUMN IF NOT EXISTS curp_match BOOLEAN,
  ADD COLUMN IF NOT EXISTS curp_profile TEXT,
  ADD COLUMN IF NOT EXISTS document_id_ref UUID;
