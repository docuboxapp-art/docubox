-- Migration: Add Nubarium validation result columns to signature_evidence
-- Timestamp: 20260518100000

ALTER TABLE public.signature_evidence
  ADD COLUMN IF NOT EXISTS nubarium_estado          TEXT,
  ADD COLUMN IF NOT EXISTS nubarium_fecha_consulta  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nubarium_codigo_validacion TEXT;

-- Index for lookups by Nubarium estado
CREATE INDEX IF NOT EXISTS idx_sig_evidence_nubarium_estado
  ON public.signature_evidence (nubarium_estado)
  WHERE nubarium_estado IS NOT NULL;
