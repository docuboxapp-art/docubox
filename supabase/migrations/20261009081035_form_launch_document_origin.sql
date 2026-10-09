ALTER TABLE public.form_tokens
  ADD COLUMN IF NOT EXISTS signature_type text
  CHECK (signature_type IN ('click_sign', 'autografa_digital', 'efirma_sat'));

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS source_form_response_id uuid
  UNIQUE REFERENCES public.form_responses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_source_form_response
  ON public.documentos(workspace_id, source_form_response_id)
  WHERE source_form_response_id IS NOT NULL;

COMMENT ON COLUMN public.documentos.source_form_response_id IS
  'Respuesta del formulario que originó el PDF de este documento.';
