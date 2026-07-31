-- Add proteccion_participacion_enabled column to document_security_settings
ALTER TABLE public.document_security_settings
  ADD COLUMN IF NOT EXISTS proteccion_participacion_enabled boolean NOT NULL DEFAULT false;

-- Add index for quick lookup
CREATE INDEX IF NOT EXISTS idx_doc_security_proteccion_participacion
  ON public.document_security_settings (documento_id, proteccion_participacion_enabled);
