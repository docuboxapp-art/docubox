-- WP-CRYPTO-04: public X.509 certificate metadata for a managed signing key.
-- These fields deliberately exclude private keys, CA keys, tokens and CSRs.

ALTER TABLE public.cryptographic_keys
  ADD COLUMN IF NOT EXISTS certificate_serial_number TEXT,
  ADD COLUMN IF NOT EXISTS certificate_subject TEXT,
  ADD COLUMN IF NOT EXISTS certificate_issuer TEXT,
  ADD COLUMN IF NOT EXISTS certificate_not_before TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificate_not_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS certificate_signature_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS certificate_public_key_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS certificate_key_usage TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS certificate_extended_key_usage TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS certificate_chain_status TEXT,
  ADD COLUMN IF NOT EXISTS certificate_environment TEXT;

ALTER TABLE public.cryptographic_keys
  DROP CONSTRAINT IF EXISTS cryptographic_keys_certificate_environment_check;
ALTER TABLE public.cryptographic_keys
  ADD CONSTRAINT cryptographic_keys_certificate_environment_check
  CHECK (certificate_environment IS NULL OR certificate_environment IN ('DEVELOPMENT', 'STAGING', 'PRODUCTION')) NOT VALID;
ALTER TABLE public.cryptographic_keys
  VALIDATE CONSTRAINT cryptographic_keys_certificate_environment_check;

CREATE INDEX IF NOT EXISTS idx_cryptographic_keys_certificate_expiry
  ON public.cryptographic_keys (certificate_not_after)
  WHERE certificate_not_after IS NOT NULL;

COMMENT ON COLUMN public.cryptographic_keys.certificate_pem IS
  'Public signing certificate only. Never store a private key, PKCS#12 bundle, CA private key, or secret here.';
COMMENT ON COLUMN public.cryptographic_keys.certificate_chain_status IS
  'Result of the latest backend X.509 chain and KeyManagementProvider public-key binding check.';

;
