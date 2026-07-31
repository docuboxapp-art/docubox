-- Migration: Add e.firma SAT evidence columns to signature_evidence
-- Timestamp: 20260513040000

-- Add e.firma specific columns to signature_evidence
ALTER TABLE public.signature_evidence
  ADD COLUMN IF NOT EXISTS efirma_serial        TEXT,
  ADD COLUMN IF NOT EXISTS efirma_rfc           TEXT,
  ADD COLUMN IF NOT EXISTS efirma_nombre        TEXT,
  ADD COLUMN IF NOT EXISTS efirma_vigencia_fin  TEXT,
  ADD COLUMN IF NOT EXISTS efirma_nubarium_resp JSONB,
  ADD COLUMN IF NOT EXISTS signature_hash       TEXT;

-- Index for lookups by e.firma serial
CREATE INDEX IF NOT EXISTS idx_signature_evidence_efirma_serial
  ON public.signature_evidence (efirma_serial)
  WHERE efirma_serial IS NOT NULL;

-- Index for lookups by signature_hash
CREATE INDEX IF NOT EXISTS idx_signature_evidence_signature_hash
  ON public.signature_evidence (signature_hash)
  WHERE signature_hash IS NOT NULL;
