-- Additive OpenTimestamps/Bitcoin evidence layer. The signed PDF remains immutable.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS blockchain_evidence_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS blockchain_evidence_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.document_blockchain_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  tenant_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE SET NULL,
  document_certification_id uuid REFERENCES public.document_certifications(id) ON DELETE SET NULL,
  protocol text NOT NULL DEFAULT 'OpenTimestamps' CHECK (protocol = 'OpenTimestamps'),
  blockchain text NOT NULL DEFAULT 'Bitcoin' CHECK (blockchain = 'Bitcoin'),
  schema_version text NOT NULL DEFAULT '1.0',
  hash_algorithm text NOT NULL DEFAULT 'SHA-256' CHECK (hash_algorithm = 'SHA-256'),
  document_hash char(64) NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  manifest_storage_path text NOT NULL,
  proof_storage_path text,
  proof_sha256 char(64) CHECK (proof_sha256 IS NULL OR proof_sha256 ~ '^[a-f0-9]{64}$'),
  proof_version integer NOT NULL DEFAULT 0 CHECK (proof_version >= 0),
  status text NOT NULL DEFAULT 'GENERATED' CHECK (status IN (
    'GENERATED','SUBMITTED','PENDING_BITCOIN','ANCHORED','VERIFIED',
    'SUBMISSION_FAILED','UPGRADE_FAILED','VERIFICATION_FAILED','INVALID_PROOF','STORAGE_ERROR'
  )),
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VALID','INVALID','FAILED')),
  bitcoin_block_height bigint CHECK (bitcoin_block_height IS NULL OR bitcoin_block_height >= 0),
  bitcoin_block_hash char(64) CHECK (bitcoin_block_hash IS NULL OR bitcoin_block_hash ~ '^[a-f0-9]{64}$'),
  bitcoin_attested_at timestamptz,
  submitted_at timestamptz,
  anchored_at timestamptz,
  verified_at timestamptz,
  last_upgrade_attempt_at timestamptz,
  next_upgrade_attempt_at timestamptz,
  upgrade_attempts integer NOT NULL DEFAULT 0 CHECK (upgrade_attempts >= 0),
  verification_error_code text,
  last_error_message text,
  calendars_configured jsonb NOT NULL DEFAULT '[]'::jsonb,
  calendars_succeeded jsonb NOT NULL DEFAULT '[]'::jsonb,
  calendars_failed jsonb NOT NULL DEFAULT '[]'::jsonb,
  certificate_storage_path text,
  certificate_sha256 char(64) CHECK (certificate_sha256 IS NULL OR certificate_sha256 ~ '^[a-f0-9]{64}$'),
  certificate_generated_at timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, document_hash, schema_version)
);

CREATE TABLE public.document_blockchain_proof_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.document_blockchain_evidence(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  storage_path text NOT NULL,
  proof_sha256 char(64) NOT NULL CHECK (proof_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  source text NOT NULL CHECK (source IN ('SUBMISSION','UPGRADE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_id, version)
);

CREATE TABLE public.document_blockchain_calendar_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.document_blockchain_evidence(id) ON DELETE CASCADE,
  calendar_origin text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('SUBMIT','UPGRADE','VERIFY','HEALTH_CHECK')),
  result text NOT NULL CHECK (result IN ('SUCCESS','FAILED','PENDING')),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_code text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_blockchain_evidence_document_idx ON public.document_blockchain_evidence(document_id, created_at DESC);
CREATE INDEX document_blockchain_evidence_tenant_idx ON public.document_blockchain_evidence(tenant_id, created_at DESC);
CREATE INDEX document_blockchain_evidence_status_idx ON public.document_blockchain_evidence(status, next_upgrade_attempt_at);
CREATE INDEX document_blockchain_evidence_manifest_idx ON public.document_blockchain_evidence(manifest_hash);
CREATE INDEX document_blockchain_proof_versions_evidence_idx ON public.document_blockchain_proof_versions(evidence_id, version DESC);
CREATE INDEX document_blockchain_calendar_attempts_metrics_idx ON public.document_blockchain_calendar_attempts(result, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.protect_document_blockchain_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.document_id <> OLD.document_id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.document_hash <> OLD.document_hash
     OR NEW.evidence_hash <> OLD.evidence_hash
     OR NEW.manifest_hash <> OLD.manifest_hash
     OR NEW.schema_version <> OLD.schema_version
     OR NEW.hash_algorithm <> OLD.hash_algorithm THEN
    RAISE EXCEPTION 'BLOCKCHAIN_EVIDENCE_IMMUTABLE';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_document_blockchain_evidence_before_update
  BEFORE UPDATE ON public.document_blockchain_evidence
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_blockchain_evidence();

CREATE OR REPLACE FUNCTION public.reject_blockchain_evidence_delete_on_hold()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.documentos d
    WHERE d.id = OLD.document_id
      AND (COALESCE(d.legal_hold, false) OR COALESCE(d.legal_hold_status, 'NONE') = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'BLOCKCHAIN_EVIDENCE_LEGAL_HOLD';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER reject_blockchain_evidence_delete_on_hold
  BEFORE DELETE ON public.document_blockchain_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_blockchain_evidence_delete_on_hold();

CREATE OR REPLACE FUNCTION public.reject_blockchain_proof_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('docubox.document_purge_context', true) = 'active' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'BLOCKCHAIN_PROOF_HISTORY_IMMUTABLE';
END;
$$;

CREATE TRIGGER immutable_document_blockchain_proof_versions
  BEFORE UPDATE OR DELETE ON public.document_blockchain_proof_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_blockchain_proof_history_mutation();

CREATE TRIGGER immutable_document_blockchain_calendar_attempts
  BEFORE UPDATE OR DELETE ON public.document_blockchain_calendar_attempts
  FOR EACH ROW EXECUTE FUNCTION public.reject_blockchain_proof_history_mutation();

CREATE OR REPLACE FUNCTION public.claim_pending_blockchain_evidence(p_worker text, p_limit integer DEFAULT 20)
RETURNS SETOF public.document_blockchain_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'BLOCKCHAIN_EVIDENCE_SERVICE_ROLE_REQUIRED';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.document_blockchain_evidence e
    WHERE e.status IN ('GENERATED','SUBMISSION_FAILED','PENDING_BITCOIN','UPGRADE_FAILED','VERIFICATION_FAILED','STORAGE_ERROR')
      AND COALESCE(e.next_upgrade_attempt_at, now()) <= now()
      AND (e.claimed_at IS NULL OR e.claimed_at < now() - interval '15 minutes')
    ORDER BY COALESCE(e.next_upgrade_attempt_at, e.created_at)
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.document_blockchain_evidence e
     SET claimed_at = now(), claimed_by = p_worker, updated_at = now()
    FROM candidates c
   WHERE e.id = c.id
  RETURNING e.*;
END;
$$;

ALTER TABLE public.document_blockchain_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_blockchain_proof_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_blockchain_calendar_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY blockchain_evidence_authorized_read ON public.document_blockchain_evidence
  FOR SELECT TO authenticated USING (public.can_access_documento(document_id));
CREATE POLICY blockchain_evidence_service_all ON public.document_blockchain_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY blockchain_proof_history_authorized_read ON public.document_blockchain_proof_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.document_blockchain_evidence e
    WHERE e.id = evidence_id AND public.can_access_documento(e.document_id)
  ));
CREATE POLICY blockchain_proof_history_service_all ON public.document_blockchain_proof_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY blockchain_calendar_attempts_service_all ON public.document_blockchain_calendar_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.document_blockchain_evidence, public.document_blockchain_proof_versions,
  public.document_blockchain_calendar_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_blockchain_evidence, public.document_blockchain_proof_versions TO authenticated;
GRANT ALL ON public.document_blockchain_evidence, public.document_blockchain_proof_versions,
  public.document_blockchain_calendar_attempts TO service_role;
REVOKE ALL ON FUNCTION public.claim_pending_blockchain_evidence(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_blockchain_evidence(text, integer) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blockchain-evidence', 'blockchain-evidence', false, 52428800,
  ARRAY['application/vnd.opentimestamps.ots','application/octet-stream','application/json','application/pdf','application/zip']
)
ON CONFLICT (id) DO UPDATE SET public = false;

COMMENT ON TABLE public.document_blockchain_evidence IS
  'Additive, privacy-preserving OpenTimestamps evidence for immutable final PDFs.';
COMMENT ON COLUMN public.document_blockchain_evidence.manifest_hash IS
  'SHA-256 of RFC 8785 canonical Docubox Blockchain Evidence Manifest v1; immutable.';
