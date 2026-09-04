-- External RFC 3161 provenance. Existing rows remain valid and are identified
-- as legacy/internal by null provenance fields. No secrets or authorization
-- material is stored in this table.
ALTER TABLE public.timestamp_records
  ADD COLUMN IF NOT EXISTS tsa_provider_role text,
  ADD COLUMN IF NOT EXISTS tsa_endpoint_id text,
  ADD COLUMN IF NOT EXISTS tsa_certificate_subject text,
  ADD COLUMN IF NOT EXISTS tsa_root_fingerprint_sha256 char(64),
  ADD COLUMN IF NOT EXISTS tsa_chain_fingerprints_sha256 jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trust_bundle_id text,
  ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_reason text,
  ADD COLUMN IF NOT EXISTS primary_failure_code text,
  ADD COLUMN IF NOT EXISTS primary_failure_class text;

ALTER TABLE public.timestamp_records
  DROP CONSTRAINT IF EXISTS timestamp_records_tsa_provider_role_check,
  ADD CONSTRAINT timestamp_records_tsa_provider_role_check
    CHECK (tsa_provider_role IS NULL OR tsa_provider_role IN ('PRIMARY', 'FALLBACK')),
  DROP CONSTRAINT IF EXISTS timestamp_records_primary_failure_class_check,
  ADD CONSTRAINT timestamp_records_primary_failure_class_check
    CHECK (
      primary_failure_class IS NULL
      OR primary_failure_class IN ('TEMPORARY_FAILURE', 'SECURITY_VALIDATION_FAILURE')
    ),
  DROP CONSTRAINT IF EXISTS timestamp_records_chain_fingerprints_array_check,
  ADD CONSTRAINT timestamp_records_chain_fingerprints_array_check
    CHECK (jsonb_typeof(tsa_chain_fingerprints_sha256) = 'array');

CREATE INDEX IF NOT EXISTS idx_timestamp_records_provider_created
  ON public.timestamp_records(tsa_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_timestamp_records_fallback_created
  ON public.timestamp_records(created_at DESC)
  WHERE fallback_used;

COMMENT ON COLUMN public.timestamp_records.trust_bundle_id IS
  'Versioned public trust material used when the timestamp was verified.';
COMMENT ON COLUMN public.timestamp_records.fallback_reason IS
  'Operational or cryptographic primary-provider failure code; never contains credentials.';

;
