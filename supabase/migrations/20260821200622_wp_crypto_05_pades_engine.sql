-- WP-CRYPTO-05: verifiable PAdES-B-B technical evidence.
-- Additive only. This stores public metadata and hashes, never CMS secrets or private keys.

ALTER TABLE public.document_certifications
  ADD COLUMN IF NOT EXISTS pades_profile TEXT,
  ADD COLUMN IF NOT EXISTS pades_signature_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS pades_digest_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS pades_certificate_serial TEXT,
  ADD COLUMN IF NOT EXISTS pades_certificate_fingerprint_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS pades_byte_range JSONB,
  ADD COLUMN IF NOT EXISTS pades_cms_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS pades_pdf_hash_after_signature TEXT,
  ADD COLUMN IF NOT EXISTS pades_signing_time_declared TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pades_verification_result JSONB,
  ADD COLUMN IF NOT EXISTS pades_verified_at TIMESTAMPTZ;

ALTER TABLE public.document_certifications
  DROP CONSTRAINT IF EXISTS document_certifications_pades_profile_check;
ALTER TABLE public.document_certifications
  ADD CONSTRAINT document_certifications_pades_profile_check
  CHECK (pades_profile IS NULL OR pades_profile IN ('PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA')) NOT VALID;
ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_pades_profile_check;

CREATE TABLE IF NOT EXISTS public.document_pdf_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  document_certification_id UUID NOT NULL REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  pades_profile TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'VALID',
  signature_algorithm TEXT NOT NULL,
  digest_algorithm TEXT NOT NULL,
  certificate_serial TEXT NOT NULL,
  certificate_fingerprint_sha256 TEXT NOT NULL,
  byte_range JSONB NOT NULL,
  cms_sha256 TEXT NOT NULL,
  pdf_hash_after_signature TEXT NOT NULL,
  signing_time_declared TIMESTAMPTZ NOT NULL,
  verification_result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  CONSTRAINT document_pdf_signatures_profile_check CHECK (pades_profile IN ('PAdES-B-B', 'PAdES-B-T', 'PAdES-B-LT', 'PAdES-B-LTA')),
  CONSTRAINT document_pdf_signatures_status_check CHECK (status IN ('VALID', 'INVALID', 'NOT_CONFIGURED', 'FAILED')),
  CONSTRAINT document_pdf_signatures_certificate_fingerprint_check CHECK (certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT document_pdf_signatures_cms_hash_check CHECK (cms_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT document_pdf_signatures_pdf_hash_check CHECK (pdf_hash_after_signature ~ '^[a-f0-9]{64}$'),
  UNIQUE (document_certification_id)
);

CREATE INDEX IF NOT EXISTS idx_document_pdf_signatures_tenant_document
  ON public.document_pdf_signatures (tenant_id, document_id, created_at DESC);

ALTER TABLE public.document_pdf_signatures ENABLE ROW LEVEL SECURITY;

-- Certification evidence is written only from trusted backend services. The
-- ordinary data API has no policy for this table, so private technical records
-- are not exposed through anon/authenticated client roles.
REVOKE ALL ON TABLE public.document_pdf_signatures FROM anon, authenticated;

COMMENT ON TABLE public.document_pdf_signatures IS
  'PAdES technical verification metadata. CMS bytes are stored in the private certification artifact package; no private key material is stored here.';
