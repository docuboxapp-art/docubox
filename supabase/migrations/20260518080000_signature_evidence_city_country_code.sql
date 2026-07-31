-- Migration: add city and country_code columns to signature_evidence
-- Timestamp: 20260518080000

ALTER TABLE public.signature_evidence
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS country_code text;
