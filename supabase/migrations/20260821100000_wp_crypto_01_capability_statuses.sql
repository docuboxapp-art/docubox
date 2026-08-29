-- WP-CRYPTO-01 completion: additive capability states and independent NOM-151 status.
-- This migration does not certify historical records or alter their evidence.

ALTER TABLE public.document_certifications
  ADD COLUMN IF NOT EXISTS nom151_status TEXT NOT NULL DEFAULT 'not_configured';

ALTER TABLE public.document_certifications
  DROP CONSTRAINT IF EXISTS document_certifications_crypto_capabilities_check;

ALTER TABLE public.document_certifications
  ADD CONSTRAINT document_certifications_crypto_capabilities_check
  CHECK (
    integrity_status IN ('not_configured','pending','processing','development','valid','invalid','unavailable','manual_review','not_applicable')
    AND pdf_signature_status IN ('not_configured','pending','processing','development','valid','invalid','unavailable','manual_review','not_applicable')
    AND certificate_status IN ('not_configured','pending','processing','development','valid','invalid','unavailable','manual_review','not_applicable')
    AND timestamp_status IN ('not_configured','pending','processing','development','valid','invalid','unavailable','manual_review','not_applicable')
    AND verification_status IN ('not_configured','pending','processing','development','valid','invalid','unavailable','manual_review','not_applicable')
    AND nom151_status IN ('not_configured','pending','processing','development','valid','invalid','unavailable','manual_review','not_applicable')
  ) NOT VALID;

ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_crypto_capabilities_check;

COMMENT ON COLUMN public.document_certifications.nom151_status IS
  'NOM-151 lifecycle state. It is independent from RFC 3161 timestamps and PAdES.';
