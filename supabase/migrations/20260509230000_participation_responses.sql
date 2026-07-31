-- Migration: participation_responses
-- Stores the formal response of each participant (firmante/aprobador) for a document

CREATE TABLE IF NOT EXISTS public.participation_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  participante_email TEXT NOT NULL,
  participante_nombre TEXT,
  participante_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  tipo_participacion TEXT NOT NULL DEFAULT 'firmante', -- 'firmante' | 'aprobador'
  terminos_aceptados BOOLEAN NOT NULL DEFAULT false,
  terminos_aceptados_at TIMESTAMPTZ,
  -- Firma
  firma_data TEXT, -- base64 SVG/PNG of the drawn signature
  firma_completada BOOLEAN NOT NULL DEFAULT false,
  firma_completada_at TIMESTAMPTZ,
  -- Campos completados (JSONB array of {campo_id, label, value})
  campos_completados JSONB DEFAULT '[]'::jsonb,
  -- Aprobador
  aprobacion_completada BOOLEAN NOT NULL DEFAULT false,
  aprobacion_completada_at TIMESTAMPTZ,
  observaciones TEXT,
  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participation_responses_documento_id
  ON public.participation_responses(documento_id);

CREATE INDEX IF NOT EXISTS idx_participation_responses_email
  ON public.participation_responses(participante_email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_participation_responses_unique
  ON public.participation_responses(documento_id, participante_email);

ALTER TABLE public.participation_responses ENABLE ROW LEVEL SECURITY;

-- Participants can insert/update their own response
DROP POLICY IF EXISTS "participants_manage_own_response" ON public.participation_responses;
CREATE POLICY "participants_manage_own_response"
  ON public.participation_responses
  FOR ALL
  TO authenticated
  USING (participante_id = auth.uid() OR participante_email = (
    SELECT email FROM public.user_profiles WHERE id = auth.uid() LIMIT 1
  ))
  WITH CHECK (participante_id = auth.uid() OR participante_email = (
    SELECT email FROM public.user_profiles WHERE id = auth.uid() LIMIT 1
  ));

-- Document owners can read all responses for their documents
DROP POLICY IF EXISTS "owners_read_responses" ON public.participation_responses;
CREATE POLICY "owners_read_responses"
  ON public.participation_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.documentos d
      WHERE d.id = participation_responses.documento_id
        AND d.owner_id = auth.uid()
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_participation_responses_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_participation_responses_updated_at ON public.participation_responses;
CREATE TRIGGER trg_participation_responses_updated_at
  BEFORE UPDATE ON public.participation_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_participation_responses_updated_at();
