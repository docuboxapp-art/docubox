-- Evidence Package V2.1 finalization. Additive and backward compatible with
-- immutable 2.0 packages and historical V1 XML objects.

ALTER TABLE public.document_versions
  ADD COLUMN IF NOT EXISTS evidence_version smallint,
  ADD COLUMN IF NOT EXISTS evidence_schema_version text,
  ADD COLUMN IF NOT EXISTS evidence_selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_policy_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS evidence_policy_sha256 char(64);

ALTER TABLE public.document_versions
  DROP CONSTRAINT IF EXISTS document_versions_evidence_version_check,
  ADD CONSTRAINT document_versions_evidence_version_check
    CHECK (evidence_version IS NULL OR evidence_version IN (1, 2)),
  DROP CONSTRAINT IF EXISTS document_versions_evidence_schema_check,
  ADD CONSTRAINT document_versions_evidence_schema_check
    CHECK (
      (evidence_version IS NULL AND evidence_schema_version IS NULL)
      OR (evidence_version = 1 AND evidence_schema_version LIKE '1.%')
      OR (evidence_version = 2 AND evidence_schema_version IN ('2.0', '2.1'))
    ),
  DROP CONSTRAINT IF EXISTS document_versions_evidence_policy_hash_check,
  ADD CONSTRAINT document_versions_evidence_policy_hash_check
    CHECK (evidence_policy_sha256 IS NULL OR evidence_policy_sha256 ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE FUNCTION public.prevent_frozen_document_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_only_evidence_selection boolean;
  v_valid_encrypted_storage_switch boolean;
BEGIN
  v_only_evidence_selection :=
    (to_jsonb(NEW) - ARRAY[
      'evidence_version','evidence_schema_version','evidence_selected_at',
      'evidence_policy_snapshot','evidence_policy_sha256'
    ]) =
    (to_jsonb(OLD) - ARRAY[
      'evidence_version','evidence_schema_version','evidence_selected_at',
      'evidence_policy_snapshot','evidence_policy_sha256'
    ]);

  v_valid_encrypted_storage_switch :=
    NEW.storage_path IS DISTINCT FROM OLD.storage_path
    AND NEW.id = OLD.id
    AND NEW.version_number = OLD.version_number
    AND NEW.document_id = OLD.document_id
    AND NEW.workspace_id = OLD.workspace_id
    AND NEW.sha256 = OLD.sha256
    AND NEW.status = OLD.status
    AND NEW.mime_type = OLD.mime_type
    AND NEW.byte_size IS NOT DISTINCT FROM OLD.byte_size
    AND NEW.frozen_at IS NOT DISTINCT FROM OLD.frozen_at
    AND NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at
    AND NEW.evidence_version IS NOT DISTINCT FROM OLD.evidence_version
    AND NEW.evidence_schema_version IS NOT DISTINCT FROM OLD.evidence_schema_version
    AND NEW.evidence_selected_at IS NOT DISTINCT FROM OLD.evidence_selected_at
    AND NEW.evidence_policy_snapshot IS NOT DISTINCT FROM OLD.evidence_policy_snapshot
    AND NEW.evidence_policy_sha256 IS NOT DISTINCT FROM OLD.evidence_policy_sha256
    AND EXISTS (
      SELECT 1
      FROM public.document_encryption_metadata metadata
      WHERE metadata.document_version_id = OLD.id
        AND metadata.tenant_id = OLD.workspace_id
        AND metadata.document_id = OLD.document_id
        AND metadata.storage_bucket = 'documents'
        AND metadata.storage_path = NEW.storage_path
        AND metadata.plaintext_sha256 = OLD.sha256
        AND metadata.status = 'active'
    );

  IF OLD.evidence_selected_at IS NOT NULL AND (
    NEW.evidence_version IS DISTINCT FROM OLD.evidence_version OR
    NEW.evidence_schema_version IS DISTINCT FROM OLD.evidence_schema_version OR
    NEW.evidence_policy_snapshot IS DISTINCT FROM OLD.evidence_policy_snapshot OR
    NEW.evidence_policy_sha256 IS DISTINCT FROM OLD.evidence_policy_sha256
  ) THEN
    RAISE EXCEPTION 'EVIDENCE_VERSION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF OLD.frozen_at IS NOT NULL OR OLD.status IN ('sent','signed') THEN
    IF v_valid_encrypted_storage_switch THEN
      RETURN NEW;
    END IF;
    IF NOT (
      v_only_evidence_selection
      AND OLD.evidence_version IS NULL
      AND NEW.evidence_version IS NOT NULL
      AND NEW.evidence_schema_version IS NOT NULL
      AND NEW.evidence_selected_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'frozen_document_version' USING ERRCODE = '55000';
    END IF;
  END IF;
  NEW.version_number := OLD.version_number;
  NEW.document_id := OLD.document_id;
  NEW.workspace_id := OLD.workspace_id;
  RETURN NEW;
END;
$$;

UPDATE public.document_versions version
SET evidence_version = 2,
    evidence_schema_version = package.schema_version,
    evidence_selected_at = COALESCE(package.closed_at, package.generated_at)
FROM public.evidence_packages package
WHERE package.document_version_id = version.id
  AND package.closed_at IS NOT NULL
  AND version.evidence_version IS NULL;

-- Preserve the historical rows that already have a V1 object. Never regenerate them.
UPDATE public.document_versions version
SET evidence_version = 1,
    evidence_schema_version = '1.0',
    evidence_selected_at = COALESCE(version.signed_at, version.frozen_at, version.created_at)
FROM public.documentos document
WHERE version.document_id = document.id
  AND version.evidence_version IS NULL
  AND NULLIF(document.xml_evidencia_path, '') IS NOT NULL
  AND version.version_number = (
    SELECT max(candidate.version_number)
    FROM public.document_versions candidate
    WHERE candidate.document_id = document.id
  );

ALTER TABLE public.evidence_packages
  DROP CONSTRAINT IF EXISTS evidence_packages_evidence_version_check,
  ADD CONSTRAINT evidence_packages_evidence_version_check
    CHECK (evidence_version IN ('2.0', '2.1')),
  DROP CONSTRAINT IF EXISTS evidence_packages_schema_version_check,
  ADD CONSTRAINT evidence_packages_schema_version_check
    CHECK (schema_version IN ('2.0', '2.1'));

ALTER TABLE public.signature_evidence
  ADD COLUMN IF NOT EXISTS capture_id uuid,
  ADD COLUMN IF NOT EXISTS signature_id uuid,
  ADD COLUMN IF NOT EXISTS participant_record_id uuid,
  ADD COLUMN IF NOT EXISTS document_version_id uuid REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS evidence_role text NOT NULL DEFAULT 'CAPTURE',
  ADD COLUMN IF NOT EXISTS image_storage_bucket text,
  ADD COLUMN IF NOT EXISTS strokes_storage_bucket text,
  ADD COLUMN IF NOT EXISTS bundle_storage_bucket text,
  ADD COLUMN IF NOT EXISTS consent_text_version text,
  ADD COLUMN IF NOT EXISTS consent_text_sha256 char(64),
  ADD COLUMN IF NOT EXISTS consent_accepted boolean,
  ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS context_ip_status text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS context_geo_status text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS context_user_agent_status text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS digital_seal text;

UPDATE public.signature_evidence
SET capture_id = id,
    image_storage_bucket = CASE WHEN storage_image_path IS NOT NULL THEN 'signatures' ELSE NULL END,
    strokes_storage_bucket = CASE WHEN storage_strokes_path IS NOT NULL THEN 'evidence' ELSE NULL END,
    bundle_storage_bucket = CASE WHEN efirma_bundle_path IS NOT NULL THEN 'evidence' ELSE NULL END,
    context_ip_status = CASE WHEN ip_address IS NULL OR ip_address = '' OR ip_address = 'unknown' THEN 'unavailable' ELSE 'available' END,
    context_geo_status = CASE WHEN geo_latitude IS NULL OR geo_longitude IS NULL THEN 'unavailable' ELSE 'available' END,
    context_user_agent_status = CASE WHEN user_agent IS NULL OR user_agent = '' THEN 'unavailable' ELSE 'available' END
WHERE capture_id IS NULL;

ALTER TABLE public.signature_evidence
  ALTER COLUMN capture_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN capture_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS signature_evidence_role_check,
  ADD CONSTRAINT signature_evidence_role_check
    CHECK (evidence_role IN ('CAPTURE','VALIDATION','FINAL_SIGNATURE')),
  DROP CONSTRAINT IF EXISTS signature_evidence_consent_hash_check,
  ADD CONSTRAINT signature_evidence_consent_hash_check
    CHECK (consent_text_sha256 IS NULL OR consent_text_sha256 ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT IF EXISTS signature_evidence_context_ip_status_check,
  ADD CONSTRAINT signature_evidence_context_ip_status_check
    CHECK (context_ip_status IN ('available','unavailable','denied','not_applicable')),
  DROP CONSTRAINT IF EXISTS signature_evidence_context_geo_status_check,
  ADD CONSTRAINT signature_evidence_context_geo_status_check
    CHECK (context_geo_status IN ('available','unavailable','denied','not_applicable')),
  DROP CONSTRAINT IF EXISTS signature_evidence_context_user_agent_status_check,
  ADD CONSTRAINT signature_evidence_context_user_agent_status_check
    CHECK (context_user_agent_status IN ('available','unavailable','denied','not_applicable'));

CREATE UNIQUE INDEX IF NOT EXISTS signature_evidence_capture_id_key
  ON public.signature_evidence(capture_id);
CREATE UNIQUE INDEX IF NOT EXISTS signature_evidence_signature_id_key
  ON public.signature_evidence(signature_id)
  WHERE signature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS signature_evidence_final_document_version_idx
  ON public.signature_evidence(document_version_id, participant_record_id, signed_at)
  WHERE evidence_role = 'FINAL_SIGNATURE' AND is_voided = false;

ALTER TABLE public.participation_responses
  ADD COLUMN IF NOT EXISTS participant_record_id uuid,
  ADD COLUMN IF NOT EXISTS document_version_id uuid REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS signature_evidence_id uuid REFERENCES public.signature_evidence(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS consent_text_version text,
  ADD COLUMN IF NOT EXISTS consent_text_sha256 char(64),
  ADD COLUMN IF NOT EXISTS consent_accepted boolean,
  ADD COLUMN IF NOT EXISTS consent_accepted_at timestamptz;

ALTER TABLE public.participation_responses
  DROP CONSTRAINT IF EXISTS participation_responses_consent_hash_check,
  ADD CONSTRAINT participation_responses_consent_hash_check
    CHECK (consent_text_sha256 IS NULL OR consent_text_sha256 ~ '^[a-f0-9]{64}$');

CREATE TABLE IF NOT EXISTS public.evidence_finalizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  source_certification_id uuid REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  evidence_version smallint NOT NULL DEFAULT 2 CHECK (evidence_version = 2),
  schema_version text NOT NULL DEFAULT '2.1' CHECK (schema_version = '2.1'),
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'FINALIZATION_PENDING' CHECK (state IN (
    'DOCUMENT_COMPLETED','FINALIZATION_PENDING','FINALIZATION_PROCESSING',
    'WAITING_FOR_PADES','WAITING_FOR_TIMESTAMP','WAITING_FOR_NOM151',
    'WAITING_FOR_OTS_STAMP','READY_FOR_EVIDENCE_XML','GENERATING_EVIDENCE',
    'SIGNING_EVIDENCE','STORING_EVIDENCE','EVIDENCE_READY',
    'EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS','FINALIZATION_RETRY_SCHEDULED',
    'FINALIZATION_ERROR'
  )),
  checkpoints jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  heartbeat_at timestamptz,
  last_error_code text,
  last_error_detail text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.evidence_packages(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(document_version_id, evidence_version)
);

CREATE INDEX IF NOT EXISTS evidence_finalizations_claim_idx
  ON public.evidence_finalizations(next_attempt_at, created_at)
  WHERE state IN ('FINALIZATION_PENDING','FINALIZATION_RETRY_SCHEDULED');

CREATE OR REPLACE FUNCTION public.claim_evidence_finalization(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 420,
  p_document_id uuid DEFAULT NULL
)
RETURNS SETOF public.evidence_finalizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.evidence_finalizations%ROWTYPE;
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'EVIDENCE_FINALIZATION_LEASE_INVALID';
  END IF;

  SELECT * INTO v_job
  FROM public.evidence_finalizations job
  WHERE (p_document_id IS NULL OR job.document_id = p_document_id)
    AND job.state IN (
      'DOCUMENT_COMPLETED','FINALIZATION_PENDING','FINALIZATION_PROCESSING',
      'WAITING_FOR_PADES','WAITING_FOR_TIMESTAMP','WAITING_FOR_NOM151',
      'WAITING_FOR_OTS_STAMP','READY_FOR_EVIDENCE_XML','GENERATING_EVIDENCE',
      'SIGNING_EVIDENCE','STORING_EVIDENCE','FINALIZATION_RETRY_SCHEDULED'
    )
    AND (
      job.state NOT IN ('FINALIZATION_PENDING','FINALIZATION_RETRY_SCHEDULED')
      OR job.next_attempt_at <= now()
    )
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at < now())
  ORDER BY job.next_attempt_at, job.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.evidence_finalizations
  SET state = 'FINALIZATION_PROCESSING',
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      fencing_token = fencing_token + 1,
      attempt_count = attempt_count + 1,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_evidence_finalization(
  p_job_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_lease_seconds integer DEFAULT 420
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.evidence_finalizations
  SET heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND fencing_token = p_fencing_token
    AND state IN (
      'FINALIZATION_PROCESSING','WAITING_FOR_PADES','WAITING_FOR_TIMESTAMP',
      'WAITING_FOR_NOM151','WAITING_FOR_OTS_STAMP','READY_FOR_EVIDENCE_XML',
      'GENERATING_EVIDENCE','SIGNING_EVIDENCE','STORING_EVIDENCE'
    );
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_evidence_finalization(
  p_job_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_state text,
  p_checkpoints jsonb DEFAULT NULL,
  p_readiness jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_detail text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL,
  p_package_id uuid DEFAULT NULL
)
RETURNS public.evidence_finalizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job public.evidence_finalizations%ROWTYPE;
BEGIN
  UPDATE public.evidence_finalizations
  SET state = p_state,
      checkpoints = COALESCE(p_checkpoints, checkpoints),
      readiness = COALESCE(p_readiness, readiness),
      last_error_code = p_error_code,
      last_error_detail = left(p_error_detail, 1000),
      next_attempt_at = COALESCE(p_retry_at, next_attempt_at),
      package_id = COALESCE(p_package_id, package_id),
      completed_at = CASE WHEN p_state IN ('EVIDENCE_READY','EVIDENCE_READY_WITH_PENDING_SUPPLEMENTS') THEN now() ELSE completed_at END,
      lease_owner = CASE WHEN p_state IN (
        'FINALIZATION_PROCESSING','WAITING_FOR_PADES','WAITING_FOR_TIMESTAMP',
        'WAITING_FOR_NOM151','WAITING_FOR_OTS_STAMP','READY_FOR_EVIDENCE_XML',
        'GENERATING_EVIDENCE','SIGNING_EVIDENCE','STORING_EVIDENCE'
      ) THEN lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN p_state IN (
        'FINALIZATION_PROCESSING','WAITING_FOR_PADES','WAITING_FOR_TIMESTAMP',
        'WAITING_FOR_NOM151','WAITING_FOR_OTS_STAMP','READY_FOR_EVIDENCE_XML',
        'GENERATING_EVIDENCE','SIGNING_EVIDENCE','STORING_EVIDENCE'
      ) THEN lease_expires_at ELSE NULL END,
      updated_at = now()
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
    AND fencing_token = p_fencing_token
  RETURNING * INTO v_job;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVIDENCE_FINALIZATION_FENCING_REJECTED' USING ERRCODE = '40001';
  END IF;
  RETURN v_job;
END;
$$;

CREATE TABLE IF NOT EXISTS public.evidence_signing_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id text NOT NULL,
  key_version text NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'EVIDENCE_SEAL'),
  algorithm text NOT NULL CHECK (algorithm IN ('RSA-PSS-SHA256','RSA-PKCS1-SHA256')),
  public_key_pem text,
  certificate_pem text,
  public_key_fingerprint_sha256 char(64) NOT NULL CHECK (public_key_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','revoked')),
  revoked_at timestamptz,
  replacement_key_id uuid REFERENCES public.evidence_signing_keys(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(key_id, key_version, purpose)
);

CREATE TABLE IF NOT EXISTS public.evidence_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.evidence_packages(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  supplement_type text NOT NULL CHECK (supplement_type IN ('NOM151','OPENTIMESTAMPS','CERTIFICATION','VERIFICATION')),
  source_table text NOT NULL,
  source_record_id uuid NOT NULL,
  previous_supplement_sha256 char(64),
  supplement_sha256 char(64) NOT NULL CHECK (supplement_sha256 ~ '^[a-f0-9]{64}$'),
  storage_bucket text NOT NULL DEFAULT 'evidence-v2-artifacts',
  storage_path text NOT NULL UNIQUE,
  source_artifact_bucket text,
  source_artifact_path text,
  source_artifact_sha256 char(64),
  source_artifact_media_type text,
  docubox_signature jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id, sequence_number),
  UNIQUE(package_id, supplement_type, source_table, source_record_id)
);

ALTER TABLE public.evidence_supplements
  DROP CONSTRAINT IF EXISTS evidence_supplements_source_artifact_hash_check,
  ADD CONSTRAINT evidence_supplements_source_artifact_hash_check
    CHECK (source_artifact_sha256 IS NULL OR source_artifact_sha256 ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE FUNCTION public.reject_evidence_supplement_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'EVIDENCE_SUPPLEMENT_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;
DROP TRIGGER IF EXISTS evidence_supplements_immutable ON public.evidence_supplements;
CREATE TRIGGER evidence_supplements_immutable
  BEFORE UPDATE OR DELETE ON public.evidence_supplements
  FOR EACH ROW EXECUTE FUNCTION public.reject_evidence_supplement_mutation();

CREATE OR REPLACE FUNCTION public.reject_closed_v21_artifact_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.evidence_packages package
    WHERE package.id = NEW.package_id
      AND package.closed_at IS NOT NULL
      AND package.schema_version = '2.1'
  ) THEN
    RAISE EXCEPTION 'EVIDENCE_PACKAGE_ARTIFACT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS evidence_package_artifacts_no_insert_after_v21_close ON public.evidence_package_artifacts;
CREATE TRIGGER evidence_package_artifacts_no_insert_after_v21_close
  BEFORE INSERT ON public.evidence_package_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.reject_closed_v21_artifact_insert();

CREATE OR REPLACE FUNCTION public.reject_packaged_signature_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.evidence_package_artifacts artifact
    JOIN public.evidence_packages package ON package.id = artifact.package_id
    WHERE artifact.source_table = 'signature_evidence'
      AND artifact.source_record_id = OLD.id
      AND package.closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PACKAGED_SIGNATURE_EVIDENCE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS signature_evidence_immutable_after_package ON public.signature_evidence;
CREATE TRIGGER signature_evidence_immutable_after_package
  BEFORE UPDATE OR DELETE ON public.signature_evidence
  FOR EACH ROW EXECUTE FUNCTION public.reject_packaged_signature_evidence_mutation();

ALTER TABLE public.evidence_finalizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_supplements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.evidence_finalizations, public.evidence_signing_keys, public.evidence_supplements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.evidence_finalizations, public.evidence_signing_keys, public.evidence_supplements TO service_role;
GRANT SELECT ON TABLE public.evidence_finalizations, public.evidence_supplements TO authenticated;

CREATE POLICY evidence_finalizations_authorized_select ON public.evidence_finalizations
  FOR SELECT TO authenticated USING (public.can_access_documento(document_id));
CREATE POLICY evidence_supplements_authorized_select ON public.evidence_supplements
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.evidence_packages package
      WHERE package.id = evidence_supplements.package_id
        AND public.can_access_documento(package.document_id)
    )
  );

REVOKE ALL ON FUNCTION public.claim_evidence_finalization(text,integer,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_evidence_finalization(uuid,text,bigint,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_evidence_finalization(uuid,text,bigint,text,jsonb,jsonb,text,text,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evidence_finalization(text,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_evidence_finalization(uuid,text,bigint,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_evidence_finalization(uuid,text,bigint,text,jsonb,jsonb,text,text,timestamptz,uuid) TO service_role;

COMMENT ON TABLE public.evidence_finalizations IS 'Durable, leased and fenced Evidence V2.1 finalization jobs.';
COMMENT ON TABLE public.evidence_supplements IS 'Append-only signed certifications received after the immutable base evidence XML was closed.';
