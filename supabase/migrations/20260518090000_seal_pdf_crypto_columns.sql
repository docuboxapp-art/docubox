-- DOCUBOX — Migración: columnas de firma criptográfica en document_signature_seals
-- Agrega columnas para registrar el resultado de la firma PKCS#7/PAdES
-- No modifica columnas existentes.
-- NOTA: La tabla document_signature_seals se crea en 20260518085900_document_signature_seals.sql

ALTER TABLE public.document_signature_seals
  ADD COLUMN IF NOT EXISTS crypto_signature_applied BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS signature_subfilter TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS certificate_cn TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS certificate_org TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS certificate_country TEXT DEFAULT NULL;
