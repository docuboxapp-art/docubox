-- Migration: Create signature_evidence table for autograph digital signatures
-- This is separate from document_evidence (which tracks document upload forensics)

CREATE TABLE IF NOT EXISTS public.signature_evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  evidence_type         TEXT NOT NULL DEFAULT 'autograph_signature',
  -- 'autograph_signature' | 'session_capture' | 'biometric_selfie'

  -- Firma autógrafa
  image_sha256          TEXT,
  strokes_sha256        TEXT,
  combined_sha256       TEXT,
  human_score           NUMERIC(4,2),
  anomaly_flags         TEXT[]  DEFAULT '{}',
  total_strokes         SMALLINT,
  total_duration_ms     INTEGER,
  avg_pressure          NUMERIC(5,3),

  -- Paths en Supabase Storage (no las imágenes)
  storage_image_path    TEXT,
  storage_strokes_path  TEXT,
  storage_frames_paths  TEXT[],
  storage_selfie_path   TEXT,

  -- Sesión
  ip_address            TEXT,
  user_agent            TEXT,
  timezone              TEXT,
  geo_latitude          NUMERIC(9,6),
  geo_longitude         NUMERIC(9,6),
  geo_accuracy_m        INTEGER,
  fingerprint_id        TEXT,

  -- Frames de sesión
  total_frames          SMALLINT,
  frame_events          JSONB,

  -- Biométrico
  face_match_score      NUMERIC(5,1),
  face_match_verdict    TEXT,
  nubarium_request_id   TEXT,
  biometric_method      TEXT,

  -- Auditoría
  captured_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_by           UUID NOT NULL REFERENCES auth.users(id),
  is_voided             BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signature_evidence_document_id
  ON public.signature_evidence (document_id);

CREATE INDEX IF NOT EXISTS idx_signature_evidence_captured_by
  ON public.signature_evidence (captured_by);

CREATE INDEX IF NOT EXISTS idx_signature_evidence_captured_at
  ON public.signature_evidence (captured_at DESC);

-- RLS
ALTER TABLE public.signature_evidence ENABLE ROW LEVEL SECURITY;

-- Solo las Edge Functions (service role) pueden insertar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'signature_evidence' AND policyname = 'sig_evidence_service_role_insert'
  ) THEN
    CREATE POLICY sig_evidence_service_role_insert
      ON public.signature_evidence FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Firmantes y propietarios pueden leer su propia evidencia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'signature_evidence' AND policyname = 'sig_evidence_participants_select'
  ) THEN
    CREATE POLICY sig_evidence_participants_select
      ON public.signature_evidence FOR SELECT
      USING (
        captured_by = auth.uid()
        OR document_id IN (
          SELECT documento_id FROM public.participation_responses
          WHERE participante_id = auth.uid()
        )
      );
  END IF;
END $$;

-- NADIE puede borrar ni actualizar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'signature_evidence' AND policyname = 'sig_evidence_no_update'
  ) THEN
    CREATE POLICY sig_evidence_no_update
      ON public.signature_evidence FOR UPDATE
      USING (FALSE);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'signature_evidence' AND policyname = 'sig_evidence_no_delete'
  ) THEN
    CREATE POLICY sig_evidence_no_delete
      ON public.signature_evidence FOR DELETE
      USING (FALSE);
  END IF;
END $$;

-- Add metodo_firma column to user_profiles if not exists (for autografa type)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS metodo_firma TEXT;

-- Add firma_autografa_created_at and firma_autografa_last_used columns
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS firma_autografa_created_at TIMESTAMPTZ;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS firma_autografa_last_used TIMESTAMPTZ;

COMMENT ON TABLE public.signature_evidence IS
  'Evidencia forense de firmas autógrafas digitales. INMUTABLE: sin UPDATE ni DELETE.';
