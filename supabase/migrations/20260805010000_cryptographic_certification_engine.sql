CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.document_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  verification_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  document_uuid uuid NOT NULL,
  document_folio text NOT NULL,
  document_version integer NOT NULL DEFAULT 1 CHECK (document_version > 0),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','FREEZING_DOCUMENT','HASHING_DOCUMENT','BUILDING_DOCUMENT_CHAIN',
    'SIGNING_DOCUMENT_CHAIN','BUILDING_EVIDENCE_MANIFEST','BUILDING_EVIDENCE_CHAIN',
    'SIGNING_EVIDENCE_CHAIN','REQUESTING_TIMESTAMP','VALIDATING_TIMESTAMP',
    'RENDERING_CERTIFICATE','APPENDING_CERTIFICATE','SIGNING_FINAL_PDF',
    'COMPLETED','FAILED','REVOKED'
  )),
  document_body_sha256 char(64),
  certified_pdf_sha256 char(64),
  document_chain_canonical_json jsonb,
  document_chain_display_text text,
  document_chain_sha256 char(64),
  document_seal_base64 text,
  document_seal_sha256 char(64),
  document_signing_key_id text,
  document_signing_key_version text,
  document_public_key_fingerprint_sha256 char(64),
  evidence_manifest_id uuid,
  evidence_manifest_sha256 char(64),
  evidence_chain_canonical_json jsonb,
  evidence_chain_display_text text,
  evidence_chain_sha256 char(64),
  evidence_seal_base64 text,
  evidence_seal_sha256 char(64),
  evidence_signing_key_id text,
  evidence_signing_key_version text,
  evidence_public_key_fingerprint_sha256 char(64),
  certification_package_canonical_json jsonb,
  certification_package_sha256 char(64),
  certification_root_sha256 char(64),
  audit_log_genesis_hash char(64),
  audit_log_final_hash char(64),
  audit_merkle_root char(64),
  certificate_pdf_path text,
  certified_pdf_path text,
  technical_package_path text,
  error_code text,
  error_message text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT uq_document_certification_version UNIQUE (document_id, document_version),
  CONSTRAINT uq_certification_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.evidence_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_manifest_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  canonical_manifest_json jsonb NOT NULL,
  manifest_sha256 char(64) NOT NULL,
  evidence_count integer NOT NULL DEFAULT 0,
  attachment_count integer NOT NULL DEFAULT 0,
  audit_event_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz
);

ALTER TABLE public.document_certifications
  DROP CONSTRAINT IF EXISTS document_certifications_evidence_manifest_id_fkey;
ALTER TABLE public.document_certifications
  ADD CONSTRAINT document_certifications_evidence_manifest_id_fkey
  FOREIGN KEY (evidence_manifest_id) REFERENCES public.evidence_manifests(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.evidence_manifest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  evidence_manifest_id uuid NOT NULL REFERENCES public.evidence_manifests(id) ON DELETE RESTRICT,
  evidence_uuid uuid NOT NULL,
  evidence_type text NOT NULL,
  file_sha256 char(64) NOT NULL,
  metadata_sha256 char(64) NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  storage_object_version text,
  generated_at timestamptz NOT NULL,
  UNIQUE (evidence_manifest_id, evidence_uuid)
);

CREATE TABLE IF NOT EXISTS public.timestamp_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_certification_id uuid NOT NULL REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  standard text NOT NULL DEFAULT 'RFC3161' CHECK (standard = 'RFC3161'),
  status text NOT NULL CHECK (status IN ('VALID','INVALID','PENDING')),
  message_imprint_algorithm text NOT NULL DEFAULT 'SHA-256',
  message_imprint_sha256 char(64) NOT NULL,
  timestamp_request_sha256 char(64),
  timestamp_response_sha256 char(64) NOT NULL,
  timestamp_token_sha256 char(64) NOT NULL,
  gen_time timestamptz NOT NULL,
  tsa_name text NOT NULL,
  tsa_policy_oid text NOT NULL,
  tsa_serial_number text NOT NULL,
  tsa_nonce text,
  tsa_certificate_serial_number text NOT NULL,
  tsa_certificate_fingerprint_sha256 char(64) NOT NULL,
  tsa_issuer text NOT NULL,
  request_storage_path text,
  response_storage_path text NOT NULL,
  token_storage_path text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_certification_id)
);

CREATE TABLE IF NOT EXISTS public.cryptographic_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  key_purpose text NOT NULL CHECK (key_purpose IN ('DOCUMENT_SEAL','EVIDENCE_SEAL','PADES','TSA')),
  kms_key_id text NOT NULL,
  kms_key_version text NOT NULL,
  algorithm text NOT NULL,
  public_key_pem text NOT NULL,
  public_key_fingerprint_sha256 char(64) NOT NULL,
  certificate_pem text,
  certificate_fingerprint_sha256 char(64),
  status text NOT NULL CHECK (status IN ('ACTIVE','RETIRED','REVOKED')),
  activated_at timestamptz NOT NULL,
  retired_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  UNIQUE (kms_key_id, kms_key_version)
);

CREATE TABLE IF NOT EXISTS public.certification_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  certification_id uuid NOT NULL REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid REFERENCES auth.users(id),
  result text NOT NULL CHECK (result IN ('SUCCESS','FAILED','PENDING')),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.certification_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  certification_id uuid REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  verification_uuid uuid,
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  result text NOT NULL CHECK (result IN ('SUCCESS','DENIED','FAILED')),
  ip_hash_sha256 char(64),
  user_agent_hash_sha256 char(64),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_certifications_document ON public.document_certifications(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_transitions_certification ON public.certification_state_transitions(certification_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_certification_access_verification ON public.certification_access_logs(verification_uuid, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.reject_certification_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de certificacion son inmutables';
END;
$$;

DROP TRIGGER IF EXISTS immutable_certification_state_transitions ON public.certification_state_transitions;
CREATE TRIGGER immutable_certification_state_transitions
  BEFORE UPDATE OR DELETE ON public.certification_state_transitions
  FOR EACH ROW EXECUTE FUNCTION public.reject_certification_log_mutation();

DROP TRIGGER IF EXISTS immutable_certification_access_logs ON public.certification_access_logs;
CREATE TRIGGER immutable_certification_access_logs
  BEFORE UPDATE OR DELETE ON public.certification_access_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_certification_log_mutation();

ALTER TABLE public.document_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_manifest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timestamp_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptographic_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certification_state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certification_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certification_owner_read ON public.document_certifications;
CREATE POLICY certification_owner_read ON public.document_certifications FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.documentos d
  WHERE d.id = document_certifications.document_id AND d.owner_id = auth.uid()
));

DROP POLICY IF EXISTS certification_public_keys_read ON public.cryptographic_keys;
CREATE POLICY certification_public_keys_read ON public.cryptographic_keys FOR SELECT
USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'certification-artifacts',
  'certification-artifacts',
  false,
  52428800,
  ARRAY['application/pdf','application/json','application/zip','application/octet-stream','text/plain','application/pkix-cert']
)
ON CONFLICT (id) DO NOTHING;

