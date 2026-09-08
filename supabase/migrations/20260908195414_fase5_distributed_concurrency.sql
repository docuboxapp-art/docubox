-- Phase 5: distributed coordination for public verification and the internal
-- cryptographic lifecycle runner. All entry points remain server-only.

CREATE OR REPLACE FUNCTION public.consume_server_rate_limit(
  p_key_hash TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.consume_ai_rate_limit(p_key_hash, p_limit, p_window_seconds);
$$;

REVOKE ALL ON FUNCTION public.consume_server_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_server_rate_limit(TEXT, INTEGER, INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.consume_server_rate_limit(TEXT, INTEGER, INTEGER) IS
  'Distributed fixed-window limiter for trusted server routes; keys are SHA-256 digests.';
COMMENT ON TABLE public.ai_rate_limit_buckets IS
  'Distributed server-only rate-limit buckets; keys are SHA-256 digests.';

CREATE OR REPLACE FUNCTION public.get_public_document_verification_bundle(
  p_identifier TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'document', jsonb_build_object(
      'id', document.id,
      'documento_id', document.documento_id,
      'folio_interno', document.folio_interno,
      'nombre', document.nombre,
      'descripcion', document.descripcion,
      'estado', document.estado,
      'es_publico', document.es_publico,
      'owner_id', document.owner_id,
      'file_name', document.file_name,
      'file_size', document.file_size,
      'file_type', document.file_type,
      'file_url', document.file_url,
      'file_hash_sha256', document.file_hash_sha256,
      'sealed_pdf_path', document.sealed_pdf_path,
      'sealed_pdf_hash', document.sealed_pdf_hash,
      'sealed_at', document.sealed_at,
      'xml_hash_sha256', document.xml_hash_sha256,
      'xml_generated_at', document.xml_generated_at,
      'created_at', document.created_at,
      'updated_at', document.updated_at,
      'fecha_completado', document.fecha_completado,
      'participantes', document.participantes
    ),
    'owner_full_name', (
      SELECT profile.full_name
      FROM public.user_profiles profile
      WHERE profile.id = document.owner_id
      LIMIT 1
    ),
    'evidence', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', evidence.id,
          'evidence_type', evidence.evidence_type,
          'captured_at', evidence.captured_at,
          'participant_name', evidence.participant_name,
          'participant_role', evidence.participant_role,
          'signature_hash', evidence.signature_hash,
          'efirma_nombre', evidence.efirma_nombre,
          'efirma_rfc', evidence.efirma_rfc,
          'cert_rfc', evidence.cert_rfc
        ) ORDER BY evidence.captured_at ASC
      )
      FROM public.signature_evidence evidence
      WHERE evidence.document_id = document.id
        AND evidence.is_voided = FALSE
    ), '[]'::JSONB)
  )
  FROM public.documentos document
  WHERE document.estado = 'completado'
    AND CASE
      WHEN p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        THEN document.id::TEXT = p_identifier
      ELSE document.documento_id = p_identifier OR document.folio_interno = p_identifier
    END
  ORDER BY CASE WHEN document.documento_id = p_identifier THEN 0 ELSE 1 END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_document_verification_bundle(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_document_verification_bundle(TEXT)
  TO service_role;

COMMENT ON FUNCTION public.get_public_document_verification_bundle(TEXT) IS
  'Service-only, single-round-trip bundle for the public completed-document verifier.';

CREATE OR REPLACE FUNCTION public.claim_crypto_lifecycle_e2e_run(
  p_run_id UUID,
  p_workspace_id UUID,
  p_actor_id UUID,
  p_retry_seconds INTEGER DEFAULT 30,
  p_lease_seconds INTEGER DEFAULT 900
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'CRYPTO_LIFECYCLE_E2E_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_run_id IS NULL OR p_workspace_id IS NULL OR p_actor_id IS NULL
    OR p_retry_seconds < 1 OR p_retry_seconds > 3600
    OR p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'CRYPTO_LIFECYCLE_E2E_CLAIM_INVALID';
  END IF;

  -- Serialize only the short claim transaction. The actual cryptographic work
  -- runs outside the database transaction and is represented by a durable row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('docubox:crypto-lifecycle-e2e', 0)
  );

  UPDATE public.platform_system_jobs
  SET status = 'failed',
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP,
      error_code = 'CRYPTO_LIFECYCLE_E2E_LEASE_EXPIRED',
      error_summary = 'The distributed execution lease expired.'
  WHERE job_type = 'crypto_lifecycle_e2e'
    AND status = 'processing'
    AND started_at <= CURRENT_TIMESTAMP - pg_catalog.make_interval(secs => p_lease_seconds);

  IF EXISTS (
    SELECT 1
    FROM public.platform_system_jobs
    WHERE job_type = 'crypto_lifecycle_e2e'
      AND status = 'processing'
      AND started_at > CURRENT_TIMESTAMP - pg_catalog.make_interval(secs => p_lease_seconds)
  ) THEN
    RETURN 'ACTIVE_RUN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.platform_system_jobs
    WHERE job_type = 'crypto_lifecycle_e2e'
      AND resource_type = 'user'
      AND resource_id = p_actor_id::TEXT
      AND started_at > CURRENT_TIMESTAMP - pg_catalog.make_interval(secs => p_retry_seconds)
  ) THEN
    RETURN 'RETRY_TOO_SOON';
  END IF;

  INSERT INTO public.platform_system_jobs (
    job_type,
    workspace_id,
    resource_type,
    resource_id,
    correlation_id,
    status,
    attempt,
    max_attempts,
    queued_at,
    started_at,
    updated_at
  ) VALUES (
    'crypto_lifecycle_e2e',
    p_workspace_id,
    'user',
    p_actor_id::TEXT,
    p_run_id::TEXT,
    'processing',
    1,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

  RETURN 'CLAIMED';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_crypto_lifecycle_e2e_run(
  p_run_id UUID,
  p_status TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'CRYPTO_LIFECYCLE_E2E_SERVICE_ROLE_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'CRYPTO_LIFECYCLE_E2E_STATUS_INVALID';
  END IF;

  UPDATE public.platform_system_jobs
  SET status = p_status,
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP,
      error_code = CASE WHEN p_status = 'failed' THEN p_error_code ELSE NULL END,
      error_summary = NULL
  WHERE job_type = 'crypto_lifecycle_e2e'
    AND correlation_id = p_run_id::TEXT
    AND status = 'processing'
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_crypto_lifecycle_e2e_run(UUID, UUID, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_crypto_lifecycle_e2e_run(UUID, UUID, UUID, INTEGER, INTEGER)
  TO service_role;
REVOKE ALL ON FUNCTION public.finish_crypto_lifecycle_e2e_run(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_crypto_lifecycle_e2e_run(UUID, TEXT, TEXT)
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_platform_system_jobs_crypto_lifecycle_claim
  ON public.platform_system_jobs(job_type, status, started_at DESC)
  WHERE job_type = 'crypto_lifecycle_e2e';
