-- AUTH-003: atomic operational completion for an existing signing pipeline.
-- Cryptographic work and artifact storage remain outside PostgreSQL. This
-- migration couples the persisted artifact reference, participant response,
-- canonical JSONB state, kiosk consumption and operational events.

ALTER TABLE public.participation_responses
  ADD COLUMN IF NOT EXISTS participant_reference_id UUID
    REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS completion_attempt_id UUID,
  ADD COLUMN IF NOT EXISTS operational_committed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS participation_responses_completion_attempt_key
  ON public.participation_responses(completion_attempt_id)
  WHERE completion_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS participation_responses_participant_reference_idx
  ON public.participation_responses(documento_id, participant_reference_id)
  WHERE participant_reference_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.participant_completion_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  participant_reference_id UUID NOT NULL
    REFERENCES public.document_participant_references(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  in_person_session_id UUID REFERENCES public.in_person_signing_sessions(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('signature','approval')),
  signature_method TEXT CHECK (
    signature_method IS NULL OR signature_method IN ('autografa','efirma','clicksign')
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 240),
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','committed','expired')),
  signature_evidence_id UUID REFERENCES public.signature_evidence(id) ON DELETE RESTRICT,
  participation_response_id UUID REFERENCES public.participation_responses(id) ON DELETE RESTRICT,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  claim_expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes'),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, idempotency_key),
  CHECK ((status <> 'committed') OR (committed_at IS NOT NULL AND participation_response_id IS NOT NULL))
);

ALTER TABLE public.participation_responses
  DROP CONSTRAINT IF EXISTS participation_responses_completion_attempt_id_fkey,
  ADD CONSTRAINT participation_responses_completion_attempt_id_fkey
    FOREIGN KEY (completion_attempt_id)
    REFERENCES public.participant_completion_attempts(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS participant_completion_one_active_idx
  ON public.participant_completion_attempts(document_id, participant_reference_id)
  WHERE status = 'claimed';
CREATE INDEX IF NOT EXISTS participant_completion_document_idx
  ON public.participant_completion_attempts(document_id, participant_reference_id, created_at DESC);
CREATE INDEX IF NOT EXISTS participant_completion_expiration_idx
  ON public.participant_completion_attempts(claim_expires_at)
  WHERE status = 'claimed';

COMMENT ON TABLE public.participant_completion_attempts IS
  'Operational claim and idempotency ledger for participant completion. It does not replace documentos.participantes or the signing pipeline.';

ALTER TABLE public.participant_completion_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.participant_completion_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.participant_completion_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.protect_committed_participation_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.operational_committed_at IS NOT NULL THEN
      RAISE EXCEPTION 'COMMITTED_PARTICIPATION_RESPONSE_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.operational_committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMMITTED_PARTICIPATION_RESPONSE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF current_user <> 'service_role'
     AND (
       NEW.participant_reference_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.participant_reference_id ELSE NULL END
       OR NEW.completion_attempt_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.completion_attempt_id ELSE NULL END
       OR NEW.operational_committed_at IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.operational_committed_at ELSE NULL END
       OR NEW.signature_evidence_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.signature_evidence_id ELSE NULL END
       OR NEW.document_version_id IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.document_version_id ELSE NULL END
       OR NEW.firma_completada IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.firma_completada ELSE false END
       OR NEW.firma_completada_at IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.firma_completada_at ELSE NULL END
       OR NEW.aprobacion_completada IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.aprobacion_completada ELSE false END
       OR NEW.aprobacion_completada_at IS DISTINCT FROM CASE WHEN TG_OP = 'UPDATE' THEN OLD.aprobacion_completada_at ELSE NULL END
     ) THEN
    RAISE EXCEPTION 'PARTICIPATION_COMPLETION_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_committed_participation_response
  ON public.participation_responses;
CREATE TRIGGER protect_committed_participation_response
  BEFORE INSERT OR UPDATE OR DELETE ON public.participation_responses
  FOR EACH ROW EXECUTE FUNCTION public.protect_committed_participation_response();

CREATE OR REPLACE FUNCTION public.enforce_atomic_participant_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_participant JSONB;
  v_previous JSONB;
  v_reference_id UUID;
  v_state TEXT;
  v_previous_state TEXT;
BEGIN
  IF NEW.participantes IS NULL OR jsonb_typeof(NEW.participantes) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_participant IN SELECT value FROM jsonb_array_elements(NEW.participantes)
  LOOP
    v_state := lower(COALESCE(v_participant ->> 'sub_estado', v_participant ->> 'estado', ''));
    IF v_state <> ALL(ARRAY['firmo','firmado','aprobo','aprobado']) THEN
      CONTINUE;
    END IF;
    IF COALESCE(v_participant ->> 'participant_ref_id', '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'ATOMIC_COMPLETION_REFERENCE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    v_reference_id := (v_participant ->> 'participant_ref_id')::UUID;
    v_previous := NULL;
    IF OLD.participantes IS NOT NULL AND jsonb_typeof(OLD.participantes) = 'array' THEN
      SELECT item.participant INTO v_previous
      FROM jsonb_array_elements(OLD.participantes) AS item(participant)
      WHERE item.participant ->> 'participant_ref_id' = v_reference_id::TEXT
      LIMIT 1;
    END IF;
    v_previous_state := lower(COALESCE(v_previous ->> 'sub_estado', v_previous ->> 'estado', ''));
    IF v_previous_state = ANY(ARRAY['firmo','firmado','aprobo','aprobado']) THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.participation_responses response
      JOIN public.participant_completion_attempts attempt
        ON attempt.id = response.completion_attempt_id
      WHERE response.documento_id = NEW.id
        AND response.participant_reference_id = v_reference_id
        AND response.operational_committed_at IS NOT NULL
        AND attempt.status = 'committed'
        AND attempt.document_id = NEW.id
        AND attempt.participant_reference_id = v_reference_id
    ) THEN
      RAISE EXCEPTION 'ATOMIC_PARTICIPANT_COMPLETION_REQUIRED' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_atomic_participant_completion ON public.documentos;
CREATE TRIGGER enforce_atomic_participant_completion
  BEFORE UPDATE OF participantes ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_atomic_participant_completion();

REVOKE ALL ON FUNCTION public.protect_committed_participation_response()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_atomic_participant_completion()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_participant_completion(
  p_document_id UUID,
  p_participant_reference_id UUID,
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_action_type TEXT,
  p_signature_method TEXT,
  p_idempotency_key TEXT,
  p_in_person_session_id UUID DEFAULT NULL,
  p_correlation_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_document public.documentos%ROWTYPE;
  v_reference public.document_participant_references%ROWTYPE;
  v_attempt public.participant_completion_attempts%ROWTYPE;
  v_version_id UUID;
  v_actor_email TEXT := lower(trim(COALESCE(p_actor_email, '')));
  v_participant JSONB;
  v_action TEXT := lower(trim(COALESCE(p_action_type, '')));
  v_method TEXT := lower(trim(COALESCE(p_signature_method, '')));
  v_reuse_attempt BOOLEAN := false;
BEGIN
  IF p_actor_user_id IS NULL OR v_actor_email = ''
     OR v_action <> ALL(ARRAY['signature','approval'])
     OR length(trim(COALESCE(p_idempotency_key, ''))) < 16
     OR (v_action = 'signature' AND v_method <> ALL(ARRAY['autografa','efirma','clicksign']))
     OR (v_action = 'approval' AND v_method <> '') THEN
    RAISE EXCEPTION 'COMPLETION_CLAIM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM public.participant_completion_attempts attempt
  WHERE attempt.document_id = p_document_id
    AND attempt.idempotency_key = trim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.actor_user_id <> p_actor_user_id
       OR v_attempt.participant_reference_id <> p_participant_reference_id THEN
      RAISE EXCEPTION 'COMPLETION_CLAIM_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
    IF v_attempt.status = 'committed' OR v_attempt.claim_expires_at > CURRENT_TIMESTAMP THEN
      RETURN jsonb_build_object(
        'attemptId', v_attempt.id,
        'status', v_attempt.status,
        'documentVersionId', v_attempt.document_version_id,
        'evidenceId', v_attempt.signature_evidence_id,
        'responseId', v_attempt.participation_response_id,
        'correlationId', v_attempt.correlation_id,
        'idempotent', true
      );
    END IF;
    UPDATE public.participant_completion_attempts
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE id = v_attempt.id;
    v_reuse_attempt := true;
  END IF;

  SELECT document.* INTO v_document
  FROM public.documentos document
  WHERE document.id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPLETION_DOCUMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF lower(COALESCE(v_document.estado, '')) = ANY(
       ARRAY['completado','cancelado','rechazado','vencido','expirado','eliminado','papelera']
     ) OR (
       v_document.tiene_vencimiento = true
       AND v_document.fecha_vencimiento IS NOT NULL
       AND v_document.fecha_vencimiento <= CURRENT_TIMESTAMP
     ) THEN
    RAISE EXCEPTION 'COMPLETION_DOCUMENT_TERMINAL' USING ERRCODE = '55000';
  END IF;

  SELECT reference.* INTO v_reference
  FROM public.document_participant_references reference
  WHERE reference.id = p_participant_reference_id
    AND reference.document_id = p_document_id
    AND reference.active = true
  FOR UPDATE;
  IF NOT FOUND
     OR v_reference.workspace_id IS DISTINCT FROM v_document.workspace_id
     OR NOT (
       v_reference.participant_user_id = p_actor_user_id
       OR v_reference.participant_email_normalized = v_actor_email
     ) THEN
    RAISE EXCEPTION 'COMPLETION_PARTICIPANT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT item.participant INTO v_participant
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(v_document.participantes) = 'array'
      THEN v_document.participantes ELSE '[]'::JSONB END
  ) AS item(participant)
  WHERE item.participant ->> 'participant_ref_id' = p_participant_reference_id::TEXT
  LIMIT 1;
  IF v_participant IS NULL
     OR COALESCE((v_participant ->> 'visible')::BOOLEAN, true) = false
     OR lower(COALESCE(v_participant ->> 'current_access', 'active')) = ANY(
       ARRAY['false','0','no','revoked','suspended','removed','hidden']
     )
     OR lower(COALESCE(v_participant ->> 'sub_estado', v_participant ->> 'estado', '')) = ANY(
       ARRAY['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado']
     ) THEN
    RAISE EXCEPTION 'COMPLETION_PARTICIPANT_NOT_ELIGIBLE' USING ERRCODE = '55000';
  END IF;

  SELECT version.id INTO v_version_id
  FROM public.document_versions version
  WHERE version.document_id = p_document_id
  ORDER BY version.version_number DESC
  LIMIT 1;

  IF p_in_person_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.in_person_signing_sessions session
    WHERE session.id = p_in_person_session_id
      AND session.document_id = p_document_id
      AND session.workspace_id IS NOT DISTINCT FROM v_document.workspace_id
      AND session.participant_reference_id = p_participant_reference_id
      AND session.status = 'started'
      AND session.revoked_at IS NULL
      AND session.expires_at > CURRENT_TIMESTAMP
      AND 'sign' = ANY(session.allowed_actions)
  ) THEN
    RAISE EXCEPTION 'COMPLETION_KIOSK_SESSION_INVALID' USING ERRCODE = '42501';
  END IF;

  UPDATE public.participant_completion_attempts attempt
  SET status = 'expired', updated_at = CURRENT_TIMESTAMP
  WHERE attempt.document_id = p_document_id
    AND attempt.participant_reference_id = p_participant_reference_id
    AND attempt.status = 'claimed'
    AND attempt.claim_expires_at <= CURRENT_TIMESTAMP;

  IF EXISTS (
    SELECT 1 FROM public.participant_completion_attempts attempt
    WHERE attempt.document_id = p_document_id
      AND attempt.participant_reference_id = p_participant_reference_id
      AND attempt.status = 'claimed'
  ) THEN
    RAISE EXCEPTION 'COMPLETION_ALREADY_CLAIMED' USING ERRCODE = '55000';
  END IF;

  IF v_reuse_attempt THEN
    UPDATE public.participant_completion_attempts
    SET workspace_id = v_document.workspace_id,
        document_version_id = v_version_id,
        in_person_session_id = p_in_person_session_id,
        action_type = v_action,
        signature_method = NULLIF(v_method, ''),
        status = 'claimed',
        signature_evidence_id = NULL,
        participation_response_id = NULL,
        correlation_id = COALESCE(p_correlation_id, gen_random_uuid()),
        claim_expires_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
        claimed_at = CURRENT_TIMESTAMP,
        committed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  ELSE
    INSERT INTO public.participant_completion_attempts (
      workspace_id, document_id, document_version_id, participant_reference_id,
      actor_user_id, in_person_session_id, action_type, signature_method,
      idempotency_key, correlation_id
    ) VALUES (
      v_document.workspace_id, p_document_id, v_version_id, p_participant_reference_id,
      p_actor_user_id, p_in_person_session_id, v_action, NULLIF(v_method, ''),
      trim(p_idempotency_key), COALESCE(p_correlation_id, gen_random_uuid())
    )
    RETURNING * INTO v_attempt;
  END IF;

  INSERT INTO public.document_operational_events (
    workspace_id, document_id, participant_reference_id, actor_user_id,
    event_type, event_key, correlation_id, source, payload
  ) VALUES (
    v_document.workspace_id, p_document_id, p_participant_reference_id, p_actor_user_id,
    'participant.completion_claimed', 'completion:' || v_attempt.id::TEXT || ':claimed',
    v_attempt.correlation_id, 'api',
    jsonb_build_object('attempt_id', v_attempt.id, 'action_type', v_action)
  ) ON CONFLICT (document_id, event_key) DO NOTHING;

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', v_attempt.status,
    'documentVersionId', v_attempt.document_version_id,
    'correlationId', v_attempt.correlation_id,
    'idempotent', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_participant_completion(
  p_attempt_id UUID,
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_idempotency_key TEXT,
  p_signature_evidence_id UUID,
  p_response JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.participant_completion_attempts%ROWTYPE;
  v_document public.documentos%ROWTYPE;
  v_reference public.document_participant_references%ROWTYPE;
  v_evidence public.signature_evidence%ROWTYPE;
  v_participant JSONB;
  v_participants JSONB;
  v_response_id UUID;
  v_existing_response_id UUID;
  v_latest_version_id UUID;
  v_completed_at TIMESTAMPTZ := CURRENT_TIMESTAMP;
  v_actor_email TEXT := lower(trim(COALESCE(p_actor_email, '')));
  v_sub_state TEXT;
  v_all_completed BOOLEAN := false;
  v_document_state TEXT;
  v_profile_id UUID;
BEGIN
  SELECT attempt.* INTO v_attempt
  FROM public.participant_completion_attempts attempt
  WHERE attempt.id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPLETION_ATTEMPT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.actor_user_id <> p_actor_user_id
     OR v_attempt.idempotency_key <> trim(COALESCE(p_idempotency_key, '')) THEN
    RAISE EXCEPTION 'COMPLETION_ATTEMPT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_attempt.status = 'committed' THEN
    SELECT document.estado INTO v_document_state
    FROM public.documentos document WHERE document.id = v_attempt.document_id;
    RETURN jsonb_build_object(
      'attemptId', v_attempt.id,
      'status', 'committed',
      'responseId', v_attempt.participation_response_id,
      'evidenceId', v_attempt.signature_evidence_id,
      'documentState', v_document_state,
      'routingRequired', lower(COALESCE(v_document_state, '')) <> 'completado',
      'idempotent', true
    );
  END IF;
  IF v_attempt.status <> 'claimed' OR v_attempt.claim_expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'COMPLETION_CLAIM_EXPIRED' USING ERRCODE = '55000';
  END IF;

  SELECT document.* INTO v_document
  FROM public.documentos document
  WHERE document.id = v_attempt.document_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPLETION_DOCUMENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_document.workspace_id IS DISTINCT FROM v_attempt.workspace_id
     OR lower(COALESCE(v_document.estado, '')) = ANY(
       ARRAY['completado','cancelado','rechazado','vencido','expirado','eliminado','papelera']
     ) OR (
       v_document.tiene_vencimiento = true
       AND v_document.fecha_vencimiento IS NOT NULL
       AND v_document.fecha_vencimiento <= CURRENT_TIMESTAMP
     ) THEN
    RAISE EXCEPTION 'COMPLETION_DOCUMENT_NOT_ELIGIBLE' USING ERRCODE = '55000';
  END IF;

  SELECT reference.* INTO v_reference
  FROM public.document_participant_references reference
  WHERE reference.id = v_attempt.participant_reference_id
    AND reference.document_id = v_attempt.document_id
    AND reference.active = true
  FOR UPDATE;
  IF NOT FOUND OR NOT (
    v_reference.participant_user_id = p_actor_user_id
    OR v_reference.participant_email_normalized = v_actor_email
  ) THEN
    RAISE EXCEPTION 'COMPLETION_PARTICIPANT_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;

  SELECT profile.id INTO v_profile_id
  FROM public.user_profiles profile
  WHERE profile.id = p_actor_user_id;

  SELECT version.id INTO v_latest_version_id
  FROM public.document_versions version
  WHERE version.document_id = v_attempt.document_id
  ORDER BY version.version_number DESC
  LIMIT 1;
  IF v_latest_version_id IS DISTINCT FROM v_attempt.document_version_id THEN
    RAISE EXCEPTION 'COMPLETION_DOCUMENT_VERSION_MISMATCH' USING ERRCODE = '55000';
  END IF;

  SELECT item.participant INTO v_participant
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(v_document.participantes) = 'array'
      THEN v_document.participantes ELSE '[]'::JSONB END
  ) AS item(participant)
  WHERE item.participant ->> 'participant_ref_id' = v_attempt.participant_reference_id::TEXT
  LIMIT 1;
  IF v_participant IS NULL
     OR COALESCE((v_participant ->> 'visible')::BOOLEAN, true) = false
     OR lower(COALESCE(v_participant ->> 'current_access', 'active')) = ANY(
       ARRAY['false','0','no','revoked','suspended','removed','hidden']
     )
     OR lower(COALESCE(v_participant ->> 'sub_estado', v_participant ->> 'estado', '')) = ANY(
       ARRAY['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado']
     ) THEN
    RAISE EXCEPTION 'COMPLETION_PARTICIPANT_NOT_ELIGIBLE' USING ERRCODE = '55000';
  END IF;

  IF v_attempt.action_type = 'signature' THEN
    IF p_signature_evidence_id IS NULL THEN
      RAISE EXCEPTION 'COMPLETION_EVIDENCE_REQUIRED' USING ERRCODE = '23502';
    END IF;
    SELECT evidence.* INTO v_evidence
    FROM public.signature_evidence evidence
    WHERE evidence.id = p_signature_evidence_id
      AND evidence.document_id = v_attempt.document_id
      AND evidence.captured_by = p_actor_user_id
      AND evidence.evidence_role = 'FINAL_SIGNATURE'
      AND evidence.is_voided = false
      AND evidence.document_version_id IS NOT DISTINCT FROM v_attempt.document_version_id
      AND (
        (v_attempt.signature_method = 'autografa' AND evidence.evidence_type = 'autograph_signature')
        OR (v_attempt.signature_method = 'clicksign' AND evidence.evidence_type = 'click_sign')
        OR (v_attempt.signature_method = 'efirma' AND evidence.evidence_type = 'efirma_sat')
      )
      AND (
        evidence.participant_record_id::TEXT = COALESCE(v_reference.participant_json_id, '')
        OR evidence.participant_record_id = v_reference.participant_user_id
        OR evidence.participant_record_id = p_actor_user_id
      )
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMPLETION_EVIDENCE_SCOPE_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF p_signature_evidence_id IS NOT NULL THEN
    RAISE EXCEPTION 'COMPLETION_APPROVAL_EVIDENCE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT response.id INTO v_existing_response_id
  FROM public.participation_responses response
  WHERE response.documento_id = v_attempt.document_id
    AND (
      response.participant_reference_id = v_attempt.participant_reference_id
      OR response.participante_id = p_actor_user_id
      OR lower(trim(response.participante_email)) = v_actor_email
    )
  ORDER BY response.created_at
  LIMIT 1
  FOR UPDATE;

  IF v_existing_response_id IS NULL THEN
    INSERT INTO public.participation_responses (
      documento_id, participante_email, participante_nombre, participante_id,
      participant_record_id, participant_reference_id, document_version_id,
      signature_evidence_id, completion_attempt_id, operational_committed_at,
      tipo_participacion, terminos_aceptados, terminos_aceptados_at,
      consent_text_version, consent_text_sha256, consent_accepted, consent_accepted_at,
      campos_completados, firma_data, firma_completada, firma_completada_at,
      signature_method, signature_stamp_style, signature_hash, signature_ip,
      signature_metadata, aprobacion_completada, aprobacion_completada_at, observaciones
    ) VALUES (
      v_attempt.document_id, v_actor_email, p_response ->> 'participante_nombre', v_profile_id,
      NULLIF(p_response ->> 'participant_record_id', '')::UUID,
      v_attempt.participant_reference_id, v_attempt.document_version_id,
      p_signature_evidence_id, v_attempt.id, v_completed_at,
      COALESCE(NULLIF(p_response ->> 'tipo_participacion', ''), 'firmante'),
      COALESCE((p_response ->> 'terminos_aceptados')::BOOLEAN, true),
      COALESCE(NULLIF(p_response ->> 'terminos_aceptados_at', '')::TIMESTAMPTZ, v_completed_at),
      p_response ->> 'consent_text_version', p_response ->> 'consent_text_sha256',
      COALESCE((p_response ->> 'consent_accepted')::BOOLEAN, false),
      NULLIF(p_response ->> 'consent_accepted_at', '')::TIMESTAMPTZ,
      COALESCE(p_response -> 'campos_completados', '[]'::JSONB), p_response ->> 'firma_data',
      v_attempt.action_type = 'signature', CASE WHEN v_attempt.action_type = 'signature' THEN v_completed_at END,
      NULLIF(p_response ->> 'signature_method', ''), NULLIF(p_response ->> 'signature_stamp_style', ''),
      NULLIF(p_response ->> 'signature_hash', ''), NULLIF(p_response ->> 'signature_ip', ''),
      COALESCE(p_response -> 'signature_metadata', '{}'::JSONB),
      v_attempt.action_type = 'approval', CASE WHEN v_attempt.action_type = 'approval' THEN v_completed_at END,
      NULLIF(p_response ->> 'observaciones', '')
    ) RETURNING id INTO v_response_id;
  ELSE
    UPDATE public.participation_responses response
    SET participante_nombre = COALESCE(p_response ->> 'participante_nombre', response.participante_nombre),
        participante_id = v_profile_id,
        participant_record_id = COALESCE(NULLIF(p_response ->> 'participant_record_id', '')::UUID, response.participant_record_id),
        participant_reference_id = v_attempt.participant_reference_id,
        document_version_id = v_attempt.document_version_id,
        signature_evidence_id = p_signature_evidence_id,
        completion_attempt_id = v_attempt.id,
        operational_committed_at = v_completed_at,
        tipo_participacion = COALESCE(NULLIF(p_response ->> 'tipo_participacion', ''), response.tipo_participacion),
        terminos_aceptados = true,
        terminos_aceptados_at = COALESCE(NULLIF(p_response ->> 'terminos_aceptados_at', '')::TIMESTAMPTZ, v_completed_at),
        consent_text_version = COALESCE(p_response ->> 'consent_text_version', response.consent_text_version),
        consent_text_sha256 = COALESCE(p_response ->> 'consent_text_sha256', response.consent_text_sha256),
        consent_accepted = COALESCE((p_response ->> 'consent_accepted')::BOOLEAN, response.consent_accepted),
        consent_accepted_at = COALESCE(NULLIF(p_response ->> 'consent_accepted_at', '')::TIMESTAMPTZ, response.consent_accepted_at),
        campos_completados = COALESCE(p_response -> 'campos_completados', response.campos_completados),
        firma_data = CASE WHEN v_attempt.action_type = 'signature' THEN p_response ->> 'firma_data' ELSE response.firma_data END,
        firma_completada = response.firma_completada OR v_attempt.action_type = 'signature',
        firma_completada_at = CASE WHEN v_attempt.action_type = 'signature' THEN v_completed_at ELSE response.firma_completada_at END,
        signature_method = COALESCE(NULLIF(p_response ->> 'signature_method', ''), response.signature_method),
        signature_stamp_style = COALESCE(NULLIF(p_response ->> 'signature_stamp_style', ''), response.signature_stamp_style),
        signature_hash = COALESCE(NULLIF(p_response ->> 'signature_hash', ''), response.signature_hash),
        signature_ip = COALESCE(NULLIF(p_response ->> 'signature_ip', ''), response.signature_ip),
        signature_metadata = COALESCE(p_response -> 'signature_metadata', response.signature_metadata),
        aprobacion_completada = response.aprobacion_completada OR v_attempt.action_type = 'approval',
        aprobacion_completada_at = CASE WHEN v_attempt.action_type = 'approval' THEN v_completed_at ELSE response.aprobacion_completada_at END,
        observaciones = COALESCE(NULLIF(p_response ->> 'observaciones', ''), response.observaciones)
    WHERE response.id = v_existing_response_id
    RETURNING id INTO v_response_id;
  END IF;

  v_sub_state := CASE WHEN v_attempt.action_type = 'signature' THEN 'firmo' ELSE 'aprobo' END;
  SELECT jsonb_agg(
    CASE WHEN participant ->> 'participant_ref_id' = v_attempt.participant_reference_id::TEXT
      THEN jsonb_set(
        jsonb_set(participant, '{sub_estado}', to_jsonb(v_sub_state), true),
        '{estado}', to_jsonb('firmado'::TEXT), true
      )
      ELSE participant END
    ORDER BY participant_order
  ) INTO v_participants
  FROM jsonb_array_elements(v_document.participantes)
    WITH ORDINALITY AS item(participant, participant_order);

  SELECT COALESCE(bool_and(
    lower(COALESCE(participant ->> 'sub_estado', participant ->> 'estado', '')) = ANY(
      ARRAY['firmo','firmado','aprobo','aprobado','rechazo','rechazado','cancelo','cancelado']
    )
  ), false) INTO v_all_completed
  FROM jsonb_array_elements(v_participants) AS item(participant);
  v_document_state := CASE WHEN v_all_completed THEN 'completado' ELSE 'en_proceso' END;

  UPDATE public.participant_completion_attempts
  SET status = 'committed', signature_evidence_id = p_signature_evidence_id,
      participation_response_id = v_response_id, committed_at = v_completed_at,
      updated_at = v_completed_at
  WHERE id = v_attempt.id;

  UPDATE public.documentos
  SET participantes = v_participants,
      estado = v_document_state,
      fecha_completado = CASE WHEN v_all_completed THEN COALESCE(fecha_completado, v_completed_at) ELSE fecha_completado END
  WHERE id = v_attempt.document_id;

  IF v_attempt.in_person_session_id IS NOT NULL THEN
    UPDATE public.in_person_signing_sessions session
    SET status = 'completed', completed_at = v_completed_at,
        revoked_at = v_completed_at, updated_at = v_completed_at
    WHERE session.id = v_attempt.in_person_session_id
      AND session.document_id = v_attempt.document_id
      AND session.participant_reference_id = v_attempt.participant_reference_id
      AND session.status = 'started'
      AND session.revoked_at IS NULL;
    IF NOT FOUND THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.in_person_signing_sessions session
        WHERE session.id = v_attempt.in_person_session_id
          AND session.document_id = v_attempt.document_id
          AND session.participant_reference_id = v_attempt.participant_reference_id
          AND session.status = 'completed'
          AND session.completed_at IS NOT NULL
          AND session.revoked_at IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'COMPLETION_KIOSK_COMMIT_CONFLICT' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.document_operational_events (
    workspace_id, document_id, participant_reference_id, actor_user_id,
    event_type, event_key, correlation_id, source, payload
  ) VALUES (
    v_attempt.workspace_id, v_attempt.document_id, v_attempt.participant_reference_id,
    p_actor_user_id, 'participant.completion_committed',
    'completion:' || v_attempt.id::TEXT || ':committed', v_attempt.correlation_id, 'database',
    jsonb_build_object(
      'attempt_id', v_attempt.id,
      'action_type', v_attempt.action_type,
      'signature_evidence_id', p_signature_evidence_id,
      'document_version_id', v_attempt.document_version_id,
      'document_state', v_document_state
    )
  ) ON CONFLICT (document_id, event_key) DO NOTHING;

  IF NOT v_all_completed THEN
    INSERT INTO public.document_operational_events (
      workspace_id, document_id, participant_reference_id, actor_user_id,
      event_type, event_key, correlation_id, source, payload
    ) VALUES (
      v_attempt.workspace_id, v_attempt.document_id, v_attempt.participant_reference_id,
      p_actor_user_id, 'workflow.advance_requested',
      'completion:' || v_attempt.id::TEXT || ':advance-requested',
      v_attempt.correlation_id, 'database',
      jsonb_build_object('attempt_id', v_attempt.id)
    ) ON CONFLICT (document_id, event_key) DO NOTHING;
  END IF;

  INSERT INTO public.document_activity_log (
    documento_id, actor_id, actor_nombre, actor_email, action, category, details
  ) VALUES (
    v_attempt.document_id, v_profile_id, p_response ->> 'participante_nombre', v_actor_email,
    CASE WHEN v_attempt.action_type = 'signature' THEN 'firma_completada' ELSE 'aprobacion_completada' END,
    'firma',
    jsonb_build_object(
      'completion_attempt_id', v_attempt.id,
      'participant_reference_id', v_attempt.participant_reference_id,
      'signature_evidence_id', p_signature_evidence_id,
      'signature_method', v_attempt.signature_method,
      'signature_hash', NULLIF(p_response ->> 'signature_hash', '')
    )
  );

  RETURN jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', 'committed',
    'responseId', v_response_id,
    'evidenceId', p_signature_evidence_id,
    'documentState', v_document_state,
    'routingRequired', NOT v_all_completed,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_participant_completion(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_participant_completion(
  UUID, UUID, TEXT, TEXT, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_participant_completion(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_participant_completion(
  UUID, UUID, TEXT, TEXT, UUID, JSONB
) TO service_role;
