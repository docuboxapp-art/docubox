-- DOCUBOX security and cryptographic integrity hardening.
-- Additive migration: preserves legacy tables and imports their history by hash.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared authorization helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.try_uuid(value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
BEGIN
  RETURN value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_documento(p_document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documentos d
    WHERE d.id = p_document_id
      AND (
        d.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members wm
          WHERE wm.workspace_id = d.workspace_id
            AND wm.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.participation_responses pr
          WHERE pr.documento_id = d.id
            AND (
              pr.participante_id = auth.uid()
              OR lower(pr.participante_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.try_uuid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_uuid(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_documento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_documento(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Canonical append-only legal evidence ledger for public.documentos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.legal_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  event_type text NOT NULL CHECK (event_type ~ '^[A-Z0-9_]{3,80}$'),
  event_category text NOT NULL CHECK (event_category IN (
    'LIFECYCLE','ACCESS','PARTICIPANT','NOTIFICATION','SIGNATURE','IDENTITY',
    'COMPLIANCE','SECURITY','CERTIFICATION','VERIFICATION','LEGACY_IMPORT'
  )),
  event_result text NOT NULL DEFAULT 'SUCCESS' CHECK (event_result IN (
    'SUCCESS','FAILED','DENIED','PENDING','PARTIAL','INDETERMINATE'
  )),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'SYSTEM' CHECK (actor_type IN (
    'USER','PARTICIPANT','SYSTEM','SERVICE','PROVIDER','ANONYMOUS'
  )),
  actor_email_hash char(64),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text,
  source_system text NOT NULL DEFAULT 'DOCUBOX',
  source_record_id uuid,
  document_sha256 char(64),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_canonical_text text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  previous_event_hash char(64),
  chain_material text NOT NULL,
  event_hash char(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_email_hash IS NULL OR actor_email_hash ~ '^[a-f0-9]{64}$'),
  CHECK (document_sha256 IS NULL OR document_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[a-f0-9]{64}$'),
  CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (document_id, sequence_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_evidence_events_idempotency_idx
  ON public.legal_evidence_events(document_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS legal_evidence_events_document_idx
  ON public.legal_evidence_events(document_id, sequence_number);
CREATE INDEX IF NOT EXISTS legal_evidence_events_correlation_idx
  ON public.legal_evidence_events(correlation_id);
CREATE INDEX IF NOT EXISTS legal_evidence_events_tenant_idx
  ON public.legal_evidence_events(tenant_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION public.reject_legal_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'LEGAL_EVIDENCE_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS immutable_legal_evidence_events ON public.legal_evidence_events;
CREATE TRIGGER immutable_legal_evidence_events
  BEFORE UPDATE OR DELETE ON public.legal_evidence_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_legal_evidence_mutation();

CREATE OR REPLACE FUNCTION public.append_legal_evidence_event(
  p_document_id uuid,
  p_event_type text,
  p_event_category text,
  p_event_result text,
  p_actor_id uuid,
  p_actor_type text,
  p_payload jsonb,
  p_document_sha256 text DEFAULT NULL,
  p_actor_email text DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_source_system text DEFAULT 'DOCUBOX',
  p_source_record_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS public.legal_evidence_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_existing public.legal_evidence_events%ROWTYPE;
  v_row public.legal_evidence_events%ROWTYPE;
  v_sequence integer;
  v_previous_hash text;
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_payload_text text;
  v_payload_hash text;
  v_event_uuid uuid := gen_random_uuid();
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
  v_chain_material text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_event_type !~ '^[A-Z0-9_]{3,80}$' THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_EVENT_TYPE_INVALID';
  END IF;
  IF p_document_sha256 IS NOT NULL AND lower(p_document_sha256) !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_HASH_INVALID';
  END IF;

  SELECT * INTO v_document FROM public.documentos WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_EVIDENCE_DOCUMENT_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.legal_evidence_events
    WHERE document_id = p_document_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT COALESCE(MAX(sequence_number), 0) + 1,
         (ARRAY_AGG(event_hash ORDER BY sequence_number DESC))[1]
    INTO v_sequence, v_previous_hash
  FROM public.legal_evidence_events
  WHERE document_id = p_document_id;

  v_payload_text := v_payload::text;
  v_payload_hash := encode(digest(convert_to(v_payload_text, 'UTF8'), 'sha256'), 'hex');
  v_chain_material := concat_ws('|',
    'DOCUBOX_LEGAL_EVIDENCE', '1.0', v_event_uuid::text, p_document_id::text,
    v_sequence::text, p_event_type, p_event_category, p_event_result,
    COALESCE(p_actor_id::text, ''), p_actor_type,
    to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    COALESCE(lower(p_document_sha256), ''), v_payload_hash,
    COALESCE(v_previous_hash, repeat('0', 64))
  );

  INSERT INTO public.legal_evidence_events (
    event_uuid, tenant_id, workspace_id, document_id, sequence_number,
    event_type, event_category, event_result, actor_id, actor_type,
    actor_email_hash, correlation_id, idempotency_key, source_system,
    source_record_id, document_sha256, payload, payload_canonical_text,
    payload_sha256, previous_event_hash, chain_material, event_hash, occurred_at
  ) VALUES (
    v_event_uuid, COALESCE(v_document.workspace_id, v_document.owner_id),
    v_document.workspace_id, p_document_id, v_sequence, p_event_type,
    p_event_category, p_event_result, p_actor_id, p_actor_type,
    CASE WHEN p_actor_email IS NULL THEN NULL ELSE encode(digest(lower(trim(p_actor_email)), 'sha256'), 'hex') END,
    COALESCE(p_correlation_id, gen_random_uuid()), p_idempotency_key,
    COALESCE(NULLIF(p_source_system, ''), 'DOCUBOX'), p_source_record_id,
    lower(p_document_sha256), v_payload, v_payload_text, v_payload_hash,
    v_previous_hash, v_chain_material,
    encode(digest(convert_to(v_chain_material, 'UTF8'), 'sha256'), 'hex'), v_occurred_at
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.append_legal_evidence_event(
  uuid,text,text,text,uuid,text,jsonb,text,text,uuid,text,text,uuid,timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_legal_evidence_event(
  uuid,text,text,text,uuid,text,jsonb,text,text,uuid,text,text,uuid,timestamptz
) TO service_role;

ALTER TABLE public.legal_evidence_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_evidence_select_authorized ON public.legal_evidence_events;
CREATE POLICY legal_evidence_select_authorized
  ON public.legal_evidence_events FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));
DROP POLICY IF EXISTS legal_evidence_service_all ON public.legal_evidence_events;
CREATE POLICY legal_evidence_service_all
  ON public.legal_evidence_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Import legacy activity records by reference and hash. The original table is retained.
DO $$
DECLARE
  v_doc record;
  v_activity record;
  v_sequence integer;
  v_previous_hash text;
  v_payload jsonb;
  v_payload_text text;
  v_payload_hash text;
  v_event_uuid uuid;
  v_chain_material text;
  v_occurred_at timestamptz;
BEGIN
  FOR v_doc IN
    SELECT id, owner_id, workspace_id, file_hash_sha256, created_at
    FROM public.documentos
    ORDER BY created_at, id
  LOOP
    SELECT COALESCE(MAX(sequence_number), 0),
           (ARRAY_AGG(event_hash ORDER BY sequence_number DESC))[1]
      INTO v_sequence, v_previous_hash
    FROM public.legal_evidence_events
    WHERE document_id = v_doc.id;

    FOR v_activity IN
      SELECT id, actor_id, action, category, details, created_at
      FROM public.document_activity_log
      WHERE documento_id = v_doc.id
      ORDER BY created_at, id
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.legal_evidence_events
        WHERE source_system = 'DOCUMENT_ACTIVITY_LOG' AND source_record_id = v_activity.id
      ) THEN CONTINUE; END IF;

      v_sequence := v_sequence + 1;
      v_event_uuid := gen_random_uuid();
      v_occurred_at := v_activity.created_at;
      v_payload := jsonb_build_object(
        'legacy_table', 'document_activity_log',
        'legacy_id', v_activity.id,
        'legacy_action', v_activity.action,
        'legacy_category', v_activity.category,
        'legacy_details_sha256', encode(digest(COALESCE(v_activity.details, '{}'::jsonb)::text, 'sha256'), 'hex')
      );
      v_payload_text := v_payload::text;
      v_payload_hash := encode(digest(convert_to(v_payload_text, 'UTF8'), 'sha256'), 'hex');
      v_chain_material := concat_ws('|',
        'DOCUBOX_LEGAL_EVIDENCE', '1.0', v_event_uuid::text, v_doc.id::text,
        v_sequence::text, 'LEGACY_ACTIVITY_IMPORTED', 'LEGACY_IMPORT', 'SUCCESS',
        COALESCE(v_activity.actor_id::text, ''), 'SYSTEM',
        to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        CASE WHEN v_doc.file_hash_sha256 ~* '^[a-f0-9]{64}$' THEN lower(v_doc.file_hash_sha256) ELSE '' END,
        v_payload_hash, COALESCE(v_previous_hash, repeat('0', 64))
      );

      INSERT INTO public.legal_evidence_events (
        event_uuid, tenant_id, workspace_id, document_id, sequence_number,
        event_type, event_category, event_result, actor_id, actor_type,
        source_system, source_record_id, document_sha256, payload,
        payload_canonical_text, payload_sha256, previous_event_hash,
        chain_material, event_hash, occurred_at
      ) VALUES (
        v_event_uuid, COALESCE(v_doc.workspace_id, v_doc.owner_id), v_doc.workspace_id,
        v_doc.id, v_sequence, 'LEGACY_ACTIVITY_IMPORTED', 'LEGACY_IMPORT',
        'SUCCESS', CASE WHEN EXISTS (
          SELECT 1 FROM auth.users au WHERE au.id = v_activity.actor_id
        ) THEN v_activity.actor_id ELSE NULL END,
        'SYSTEM', 'DOCUMENT_ACTIVITY_LOG',
        v_activity.id,
        CASE WHEN v_doc.file_hash_sha256 ~* '^[a-f0-9]{64}$' THEN lower(v_doc.file_hash_sha256) ELSE NULL END,
        v_payload, v_payload_text, v_payload_hash, v_previous_hash,
        v_chain_material, encode(digest(convert_to(v_chain_material, 'UTF8'), 'sha256'), 'hex'),
        v_occurred_at
      );
      v_previous_hash := encode(digest(convert_to(v_chain_material, 'UTF8'), 'sha256'), 'hex');
    END LOOP;

    IF v_sequence = 0 THEN
      v_event_uuid := gen_random_uuid();
      v_sequence := 1;
      v_occurred_at := v_doc.created_at;
      v_payload := jsonb_build_object('legacy_snapshot', true, 'reason', 'NO_ACTIVITY_ROWS');
      v_payload_text := v_payload::text;
      v_payload_hash := encode(digest(convert_to(v_payload_text, 'UTF8'), 'sha256'), 'hex');
      v_chain_material := concat_ws('|',
        'DOCUBOX_LEGAL_EVIDENCE', '1.0', v_event_uuid::text, v_doc.id::text,
        '1', 'LEGACY_DOCUMENT_SNAPSHOT', 'LEGACY_IMPORT', 'SUCCESS',
        v_doc.owner_id::text, 'SYSTEM',
        to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        CASE WHEN v_doc.file_hash_sha256 ~* '^[a-f0-9]{64}$' THEN lower(v_doc.file_hash_sha256) ELSE '' END,
        v_payload_hash, repeat('0', 64)
      );
      INSERT INTO public.legal_evidence_events (
        event_uuid, tenant_id, workspace_id, document_id, sequence_number,
        event_type, event_category, event_result, actor_id, actor_type,
        source_system, document_sha256, payload, payload_canonical_text,
        payload_sha256, chain_material, event_hash, occurred_at
      ) VALUES (
        v_event_uuid, COALESCE(v_doc.workspace_id, v_doc.owner_id), v_doc.workspace_id,
        v_doc.id, 1, 'LEGACY_DOCUMENT_SNAPSHOT', 'LEGACY_IMPORT', 'SUCCESS',
        CASE WHEN EXISTS (
          SELECT 1 FROM auth.users au WHERE au.id = v_doc.owner_id
        ) THEN v_doc.owner_id ELSE NULL END,
        'SYSTEM', 'DOCUMENTOS_BACKFILL',
        CASE WHEN v_doc.file_hash_sha256 ~* '^[a-f0-9]{64}$' THEN lower(v_doc.file_hash_sha256) ELSE NULL END,
        v_payload, v_payload_text, v_payload_hash, v_chain_material,
        encode(digest(convert_to(v_chain_material, 'UTF8'), 'sha256'), 'hex'), v_occurred_at
      );
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Secure, purpose-specific OTP challenges
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signature_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'DOCUMENT_SIGNATURE' CHECK (purpose = 'DOCUMENT_SIGNATURE'),
  recipient_email_sha256 char(64) NOT NULL CHECK (recipient_email_sha256 ~ '^[a-f0-9]{64}$'),
  code_digest char(64) NOT NULL CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','SENT','FAILED')),
  provider_message_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signature_otp_lookup_idx
  ON public.signature_otp_challenges(user_id, document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS signature_otp_expiry_idx
  ON public.signature_otp_challenges(expires_at)
  WHERE consumed_at IS NULL AND locked_at IS NULL;

ALTER TABLE public.signature_otp_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signature_otp_service_all ON public.signature_otp_challenges;
CREATE POLICY signature_otp_service_all ON public.signature_otp_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Prevent direct clients from reading legacy plaintext OTPs.
DROP POLICY IF EXISTS "users_manage_own_otps" ON public.signature_otps;
DROP POLICY IF EXISTS signature_otps_emergency_service_all ON public.signature_otps;
DROP POLICY IF EXISTS signature_otps_service_only ON public.signature_otps;
CREATE POLICY signature_otps_service_only ON public.signature_otps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.consume_signature_otp(
  p_document_id uuid,
  p_user_id uuid,
  p_code_digest text
)
RETURNS TABLE(status text, challenge_id uuid, attempts_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_challenge public.signature_otp_challenges%ROWTYPE;
  v_attempts integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SIGNATURE_OTP_SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_code_digest !~ '^[a-f0-9]{64}$' THEN
    RETURN QUERY SELECT 'INVALID'::text, NULL::uuid, 0;
    RETURN;
  END IF;

  SELECT * INTO v_challenge
  FROM public.signature_otp_challenges
  WHERE document_id = p_document_id
    AND user_id = p_user_id
    AND purpose = 'DOCUMENT_SIGNATURE'
    AND delivery_status = 'SENT'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, 0; RETURN; END IF;
  IF v_challenge.consumed_at IS NOT NULL THEN RETURN QUERY SELECT 'CONSUMED'::text, v_challenge.id, 0; RETURN; END IF;
  IF v_challenge.locked_at IS NOT NULL THEN RETURN QUERY SELECT 'LOCKED'::text, v_challenge.id, 0; RETURN; END IF;
  IF v_challenge.expires_at <= now() THEN RETURN QUERY SELECT 'EXPIRED'::text, v_challenge.id, 0; RETURN; END IF;

  IF v_challenge.code_digest = lower(p_code_digest) THEN
    UPDATE public.signature_otp_challenges
    SET consumed_at = now()
    WHERE id = v_challenge.id;
    RETURN QUERY SELECT 'VERIFIED'::text, v_challenge.id,
      GREATEST(v_challenge.max_attempts - v_challenge.attempts, 0);
    RETURN;
  END IF;

  v_attempts := v_challenge.attempts + 1;
  UPDATE public.signature_otp_challenges
  SET attempts = v_attempts,
      locked_at = CASE WHEN v_attempts >= max_attempts THEN now() ELSE locked_at END
  WHERE id = v_challenge.id;
  RETURN QUERY SELECT
    CASE WHEN v_attempts >= v_challenge.max_attempts THEN 'LOCKED' ELSE 'INVALID' END::text,
    v_challenge.id,
    GREATEST(v_challenge.max_attempts - v_attempts, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_signature_otp(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_signature_otp(uuid,uuid,text) TO service_role;

-- ---------------------------------------------------------------------------
-- Identity enrollment: authenticated encryption and private records
-- ---------------------------------------------------------------------------

ALTER TABLE public.enrollment_tokens
  ADD COLUMN IF NOT EXISTS encryption_version text,
  ADD COLUMN IF NOT EXISTS issued_ip inet;
ALTER TABLE public.enrollment_results
  ADD COLUMN IF NOT EXISTS encryption_version text;
ALTER TABLE public.id_capture_logs
  ADD COLUMN IF NOT EXISTS encryption_version text;

DROP POLICY IF EXISTS "authenticated_read_own_id_capture_logs" ON public.id_capture_logs;
DROP POLICY IF EXISTS "service_role_manage_id_capture_logs" ON public.id_capture_logs;
DROP POLICY IF EXISTS id_capture_logs_emergency_service_all ON public.id_capture_logs;
DROP POLICY IF EXISTS id_capture_logs_service_all ON public.id_capture_logs;
CREATE POLICY id_capture_logs_service_all ON public.id_capture_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS enrollment_tokens_issued_ip_created_idx
  ON public.enrollment_tokens(issued_ip, created_at DESC)
  WHERE issued_ip IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_identity_enrollment(
  p_token text,
  p_result jsonb
)
RETURNS TABLE(enrollment_result_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token public.enrollment_tokens%ROWTYPE;
  v_result_id uuid;
  v_completed_at timestamptz := now();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'IDENTITY_ENROLLMENT_SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_token
  FROM public.enrollment_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'IDENTITY_ENROLLMENT_NOT_FOUND'; END IF;
  IF v_token.expires_at <= now() THEN RAISE EXCEPTION 'IDENTITY_ENROLLMENT_EXPIRED'; END IF;
  IF v_token.status = 'completed' THEN RAISE EXCEPTION 'IDENTITY_ENROLLMENT_ALREADY_COMPLETED'; END IF;
  IF v_token.processing_status <> 'validated' THEN RAISE EXCEPTION 'IDENTITY_ENROLLMENT_NOT_VALIDATED'; END IF;

  INSERT INTO public.enrollment_results (
    enrollment_token_id, user_id, token, session_id, nombre,
    apellido_paterno, apellido_materno, curp, rfc, fecha_nacimiento,
    sexo, tipo_identificacion, face_encoding_encrypted, encryption_iv,
    encryption_version, face_match_score, face_match_passed,
    document_metadata, status, notified_at, raw_response
  ) VALUES (
    v_token.id, v_token.user_id, v_token.token, v_token.session_id,
    NULLIF(p_result ->> 'nombre', ''),
    NULLIF(p_result ->> 'apellido_paterno', ''),
    NULLIF(p_result ->> 'apellido_materno', ''),
    NULLIF(p_result ->> 'curp', ''),
    NULLIF(p_result ->> 'rfc', ''),
    NULLIF(p_result ->> 'fecha_nacimiento', ''),
    NULLIF(p_result ->> 'sexo', ''),
    NULLIF(p_result ->> 'tipo_identificacion', ''),
    v_token.face_encoding_encrypted, NULL,
    COALESCE(v_token.encryption_version, 'AES-256-GCM-V1'),
    v_token.face_match_score, true,
    COALESCE(p_result -> 'document_metadata', '{}'::jsonb),
    'completed', v_completed_at,
    COALESCE(p_result -> 'provider_reference', '{}'::jsonb)
  )
  RETURNING id INTO v_result_id;

  UPDATE public.enrollment_tokens SET
    status = 'completed', completed_at = v_completed_at,
    nombre = NULLIF(p_result ->> 'nombre', ''),
    apellido_paterno = NULLIF(p_result ->> 'apellido_paterno', ''),
    apellido_materno = NULLIF(p_result ->> 'apellido_materno', ''),
    curp = NULLIF(p_result ->> 'curp', ''),
    rfc = NULLIF(p_result ->> 'rfc', ''),
    fecha_nacimiento = NULLIF(p_result ->> 'fecha_nacimiento', ''),
    sexo = NULLIF(p_result ->> 'sexo', ''),
    tipo_identificacion = NULLIF(p_result ->> 'tipo_identificacion', ''),
    raw_data = COALESCE(p_result -> 'provider_reference', '{}'::jsonb)
  WHERE id = v_token.id;

  IF v_token.user_id IS NOT NULL THEN
    UPDATE public.user_verification_status SET
      biometric_verified = true,
      biometric_verified_at = COALESCE(biometric_verified_at, v_completed_at),
      biometric_source = 'enrollment',
      enrollment_result_id = v_result_id
    WHERE user_id = v_token.user_id;
  END IF;

  RETURN QUERY SELECT v_result_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_identity_enrollment(text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_identity_enrollment(text,jsonb)
  TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_results_one_per_token_idx
  ON public.enrollment_results(enrollment_token_id);

DROP POLICY IF EXISTS "public_insert_enrollment_tokens" ON public.enrollment_tokens;
DROP POLICY IF EXISTS "public_select_enrollment_tokens" ON public.enrollment_tokens;
DROP POLICY IF EXISTS "public_update_enrollment_tokens" ON public.enrollment_tokens;
DROP POLICY IF EXISTS enrollment_tokens_emergency_service_all ON public.enrollment_tokens;
DROP POLICY IF EXISTS enrollment_tokens_owner_read ON public.enrollment_tokens;
CREATE POLICY enrollment_tokens_owner_read ON public.enrollment_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS enrollment_tokens_service_all ON public.enrollment_tokens;
CREATE POLICY enrollment_tokens_service_all ON public.enrollment_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_enrollment_results" ON public.enrollment_results;
DROP POLICY IF EXISTS "public_select_enrollment_results" ON public.enrollment_results;
DROP POLICY IF EXISTS "public_update_enrollment_results" ON public.enrollment_results;
DROP POLICY IF EXISTS anon_read_by_session_id ON public.enrollment_results;
DROP POLICY IF EXISTS enrollment_results_emergency_service_all ON public.enrollment_results;
DROP POLICY IF EXISTS enrollment_results_owner_read ON public.enrollment_results;
CREATE POLICY enrollment_results_owner_read ON public.enrollment_results
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS enrollment_results_service_all ON public.enrollment_results;
CREATE POLICY enrollment_results_service_all ON public.enrollment_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Legacy identity provider logs contain PII and provider responses. They are
-- server-side audit records, never public datasets.
DROP POLICY IF EXISTS "public_insert_curp_validations" ON public.curp_validations;
DROP POLICY IF EXISTS "public_select_curp_validations" ON public.curp_validations;
DROP POLICY IF EXISTS curp_validations_emergency_service_all ON public.curp_validations;
DROP POLICY IF EXISTS curp_validations_service_all ON public.curp_validations;
CREATE POLICY curp_validations_service_all ON public.curp_validations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_serial_validations" ON public.serial_validations;
DROP POLICY IF EXISTS "public_select_serial_validations" ON public.serial_validations;
DROP POLICY IF EXISTS serial_validations_emergency_service_all ON public.serial_validations;
DROP POLICY IF EXISTS serial_validations_service_all ON public.serial_validations;
CREATE POLICY serial_validations_service_all ON public.serial_validations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_nubarium_ocr_logs" ON public.nubarium_ocr_logs;
DROP POLICY IF EXISTS "public_select_nubarium_ocr_logs" ON public.nubarium_ocr_logs;
DROP POLICY IF EXISTS nubarium_ocr_logs_emergency_service_all ON public.nubarium_ocr_logs;
DROP POLICY IF EXISTS nubarium_ocr_logs_service_all ON public.nubarium_ocr_logs;
CREATE POLICY nubarium_ocr_logs_service_all ON public.nubarium_ocr_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_face_comparison_logs" ON public.face_comparison_logs;
DROP POLICY IF EXISTS "public_select_face_comparison_logs" ON public.face_comparison_logs;
DROP POLICY IF EXISTS face_comparison_logs_emergency_service_all ON public.face_comparison_logs;
DROP POLICY IF EXISTS face_comparison_logs_service_all ON public.face_comparison_logs;
CREATE POLICY face_comparison_logs_service_all ON public.face_comparison_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Mobile QR sessions are accessed through short-lived capability APIs. Direct
-- anonymous table and storage access exposed every active token and upload.
DROP POLICY IF EXISTS "public_can_read_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
DROP POLICY IF EXISTS "public_can_update_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
DROP POLICY IF EXISTS mobile_upload_sessions_emergency_service_all ON public.mobile_upload_sessions;
DROP POLICY IF EXISTS mobile_upload_sessions_service_all ON public.mobile_upload_sessions;
CREATE POLICY mobile_upload_sessions_service_all ON public.mobile_upload_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mobile_uploads_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "mobile_uploads_auth_select" ON storage.objects;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars','avatars',true,2097152,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS avatars_owner_insert ON storage.objects;
CREATE POLICY avatars_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name LIKE ('avatars/' || auth.uid()::text || '.%')
  );
DROP POLICY IF EXISTS avatars_owner_update ON storage.objects;
CREATE POLICY avatars_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND name LIKE ('avatars/' || auth.uid()::text || '.%'))
  WITH CHECK (bucket_id = 'avatars' AND name LIKE ('avatars/' || auth.uid()::text || '.%'));

-- ---------------------------------------------------------------------------
-- RLS corrections for existing evidence and metadata tables
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Usuarios autenticados pueden leer sus propios sellos" ON public.document_signature_seals;
DROP POLICY IF EXISTS document_signature_seals_authorized_read ON public.document_signature_seals;
CREATE POLICY document_signature_seals_authorized_read
  ON public.document_signature_seals FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

DROP POLICY IF EXISTS "owner_can_read_metadata" ON public.document_metadata;
CREATE POLICY "owner_can_read_metadata"
  ON public.document_metadata FOR SELECT TO authenticated
  USING (
    (documentos_id IS NOT NULL AND public.can_access_documento(documentos_id))
    OR EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_metadata.document_id AND d.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_role_can_insert_metadata" ON public.document_metadata;
CREATE POLICY "service_role_can_insert_metadata"
  ON public.document_metadata FOR INSERT TO authenticated
  WITH CHECK (documentos_id IS NOT NULL AND public.can_access_documento(documentos_id));
DROP POLICY IF EXISTS "service_role_can_update_metadata" ON public.document_metadata;
CREATE POLICY "service_role_can_update_metadata"
  ON public.document_metadata FOR UPDATE TO authenticated
  USING (documentos_id IS NOT NULL AND public.can_access_documento(documentos_id))
  WITH CHECK (documentos_id IS NOT NULL AND public.can_access_documento(documentos_id));
DROP POLICY IF EXISTS document_metadata_service_all ON public.document_metadata;
CREATE POLICY document_metadata_service_all ON public.document_metadata
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sig_evidence_participants_select ON public.signature_evidence;
DROP POLICY IF EXISTS signature_evidence_authorized_read ON public.signature_evidence;
ALTER TABLE public.signature_evidence
  ADD COLUMN IF NOT EXISTS cert_fingerprint_sha256 text,
  ADD COLUMN IF NOT EXISTS signed_payload_sha256 text,
  ADD COLUMN IF NOT EXISTS validation_provider text,
  ADD COLUMN IF NOT EXISTS provider_reference text;
ALTER TABLE public.signature_evidence
  DROP CONSTRAINT IF EXISTS signature_evidence_cert_fingerprint_sha256_valid,
  ADD CONSTRAINT signature_evidence_cert_fingerprint_sha256_valid CHECK (
    cert_fingerprint_sha256 IS NULL OR cert_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS signature_evidence_signed_payload_sha256_valid,
  ADD CONSTRAINT signature_evidence_signed_payload_sha256_valid CHECK (
    signed_payload_sha256 IS NULL OR signed_payload_sha256 ~ '^[a-f0-9]{64}$'
  );
CREATE POLICY signature_evidence_authorized_read
  ON public.signature_evidence FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

DROP POLICY IF EXISTS "nom151_doc_owner_read" ON public.nom151_constancias_doc;
DROP POLICY IF EXISTS nom151_doc_authorized_read ON public.nom151_constancias_doc;
CREATE POLICY nom151_doc_authorized_read
  ON public.nom151_constancias_doc FOR SELECT TO authenticated
  USING (public.can_access_documento(documento_id));

CREATE UNIQUE INDEX IF NOT EXISTS nom151_one_active_record_per_document_idx
  ON public.nom151_constancias_doc(documento_id)
  WHERE status IN ('processing', 'issued');

ALTER TABLE public.nom151_constancias_doc
  DROP CONSTRAINT IF EXISTS nom151_issued_artifacts_valid,
  ADD CONSTRAINT nom151_issued_artifacts_valid CHECK (
    status <> 'issued'
    OR (
      pdf_sha256_local ~ '^[a-f0-9]{64}$'
      AND constancia_sha256 ~ '^[a-f0-9]{64}$'
      AND length(nubarium_codigo_validacion) > 0
      AND length(nubarium_hash) > 0
      AND length(constancia_path) > 0
      AND COALESCE(constancia_size_bytes, 0) > 0
    )
  );

DROP POLICY IF EXISTS certification_owner_read ON public.document_certifications;
DROP POLICY IF EXISTS certification_authorized_read ON public.document_certifications;
CREATE POLICY certification_authorized_read ON public.document_certifications FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

DROP POLICY IF EXISTS evidence_manifests_authorized_read ON public.evidence_manifests;
CREATE POLICY evidence_manifests_authorized_read ON public.evidence_manifests FOR SELECT TO authenticated
  USING (public.can_access_documento(document_id));

DROP POLICY IF EXISTS evidence_manifest_items_authorized_read ON public.evidence_manifest_items;
CREATE POLICY evidence_manifest_items_authorized_read ON public.evidence_manifest_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.evidence_manifests em
    WHERE em.id = evidence_manifest_items.evidence_manifest_id
      AND public.can_access_documento(em.document_id)
  ));

DROP POLICY IF EXISTS timestamp_records_authorized_read ON public.timestamp_records;
CREATE POLICY timestamp_records_authorized_read ON public.timestamp_records FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_certifications dc
    WHERE dc.id = timestamp_records.document_certification_id
      AND public.can_access_documento(dc.document_id)
  ));

DROP POLICY IF EXISTS certification_transitions_authorized_read ON public.certification_state_transitions;
CREATE POLICY certification_transitions_authorized_read ON public.certification_state_transitions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_certifications dc
    WHERE dc.id = certification_state_transitions.certification_id
      AND public.can_access_documento(dc.document_id)
  ));

DROP POLICY IF EXISTS certification_access_authorized_read ON public.certification_access_logs;
CREATE POLICY certification_access_authorized_read ON public.certification_access_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.document_certifications dc
    WHERE dc.id = certification_access_logs.certification_id
      AND public.can_access_documento(dc.document_id)
  ));

-- ---------------------------------------------------------------------------
-- Certification provenance and independent validation metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.document_certifications
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS execution_environment text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (execution_environment IN ('UNKNOWN','DEVELOPMENT','STAGING','PRODUCTION')),
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS audit_event_count integer NOT NULL DEFAULT 0 CHECK (audit_event_count >= 0),
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validator_version text,
  ADD COLUMN IF NOT EXISTS document_storage_version text;

ALTER TABLE public.timestamp_records
  ADD COLUMN IF NOT EXISTS validation_provider text,
  ADD COLUMN IF NOT EXISTS revocation_status text NOT NULL DEFAULT 'NOT_CHECKED'
    CHECK (revocation_status IN ('GOOD','REVOKED','UNKNOWN','NOT_CHECKED')),
  ADD COLUMN IF NOT EXISTS validation_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.cryptographic_keys
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS certificate_chain_pem text,
  ADD COLUMN IF NOT EXISTS certificate_not_after timestamptz,
  ADD COLUMN IF NOT EXISTS attestation jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Required private buckets and storage policies
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('certification-artifacts','certification-artifacts',false,52428800,
    ARRAY['application/pdf','application/json','application/zip','application/octet-stream','text/plain','application/pkix-cert']),
  ('documents-signed','documents-signed',false,52428800,ARRAY['application/pdf']),
  ('nom151-constancias','nom151-constancias',false,10485760,ARRAY['application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS certification_artifacts_service_write ON storage.objects;
CREATE POLICY certification_artifacts_service_write ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'certification-artifacts')
  WITH CHECK (bucket_id = 'certification-artifacts');
DROP POLICY IF EXISTS certification_artifacts_authorized_read ON storage.objects;
CREATE POLICY certification_artifacts_authorized_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'certification-artifacts'
    AND public.can_access_documento(public.try_uuid((storage.foldername(name))[2]))
  );

DROP POLICY IF EXISTS documents_signed_service_write ON storage.objects;
CREATE POLICY documents_signed_service_write ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'documents-signed')
  WITH CHECK (bucket_id = 'documents-signed');
DROP POLICY IF EXISTS documents_signed_authorized_read ON storage.objects;
CREATE POLICY documents_signed_authorized_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents-signed'
    AND public.can_access_documento(COALESCE(
      public.try_uuid((storage.foldername(name))[2]),
      public.try_uuid((storage.foldername(name))[1])
    ))
  );

DROP POLICY IF EXISTS nom151_constancias_service_write ON storage.objects;
CREATE POLICY nom151_constancias_service_write ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'nom151-constancias')
  WITH CHECK (bucket_id = 'nom151-constancias');
DROP POLICY IF EXISTS nom151_constancias_authorized_read ON storage.objects;
CREATE POLICY nom151_constancias_authorized_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'nom151-constancias'
    AND public.can_access_documento(public.try_uuid((storage.foldername(name))[3]))
  );

COMMENT ON TABLE public.legal_evidence_events IS
  'Canonical append-only legal evidence ledger for public.documentos. Legacy rows are retained in their source tables and referenced by hash.';
COMMENT ON TABLE public.signature_otp_challenges IS
  'Purpose-specific signature OTP challenges. Only keyed digests are stored; raw OTP values never enter the database.';
