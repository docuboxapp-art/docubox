-- Migration: Add e.firma linked fields to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS efirma_rfc TEXT,
  ADD COLUMN IF NOT EXISTS efirma_serial TEXT,
  ADD COLUMN IF NOT EXISTS efirma_nombre TEXT,
  ADD COLUMN IF NOT EXISTS efirma_vigencia_fin TEXT,
  ADD COLUMN IF NOT EXISTS efirma_linked_at TIMESTAMPTZ;
