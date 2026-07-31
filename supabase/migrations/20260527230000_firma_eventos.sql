-- Migration: firma_eventos
-- Tabla para registrar eventos de firma con evidencia geolocalización (JSONB)

CREATE TABLE IF NOT EXISTS public.firma_eventos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id    UUID NOT NULL,
  participante_id UUID,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo_evento     TEXT NOT NULL DEFAULT 'firma_completada',
  evidencia_geo   JSONB,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_firma_eventos_documento_id
  ON public.firma_eventos (documento_id);

CREATE INDEX IF NOT EXISTS idx_firma_eventos_user_id
  ON public.firma_eventos (user_id);

CREATE INDEX IF NOT EXISTS idx_firma_eventos_created_at
  ON public.firma_eventos (created_at DESC);

-- Enable RLS
ALTER TABLE public.firma_eventos ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "firma_eventos_insert_authenticated" ON public.firma_eventos;
CREATE POLICY "firma_eventos_insert_authenticated"
  ON public.firma_eventos
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "firma_eventos_select_own" ON public.firma_eventos;
CREATE POLICY "firma_eventos_select_own"
  ON public.firma_eventos
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Allow service role full access (for server-side inserts)
DROP POLICY IF EXISTS "firma_eventos_service_role_all" ON public.firma_eventos;
CREATE POLICY "firma_eventos_service_role_all"
  ON public.firma_eventos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
