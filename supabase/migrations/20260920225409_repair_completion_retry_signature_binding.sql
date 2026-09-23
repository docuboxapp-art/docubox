-- Keep an uncommitted idempotent attempt aligned with the signature method
-- actually selected by the participant. This is safe only before the attempt
-- owns evidence or a participation response.
CREATE OR REPLACE FUNCTION public.claim_participant_completion_auth003(
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

    IF v_attempt.status = 'claimed'
       AND v_attempt.claim_expires_at > CURRENT_TIMESTAMP
       AND v_attempt.action_type = v_action
       AND v_attempt.signature_method IS DISTINCT FROM NULLIF(v_method, '')
       AND v_attempt.signature_evidence_id IS NULL
       AND v_attempt.participation_response_id IS NULL THEN
      UPDATE public.participant_completion_attempts
      SET signature_method = NULLIF(v_method, ''),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_attempt.id
      RETURNING * INTO v_attempt;
    END IF;

    IF v_attempt.status = 'committed' OR v_attempt.claim_expires_at > CURRENT_TIMESTAMP THEN
      RETURN jsonb_build_object(
        'attemptId', v_attempt.id,
        'status', v_attempt.status,
        'documentVersionId', v_attempt.document_version_id,
        'evidenceId', v_attempt.signature_evidence_id,
        'responseId', v_attempt.participation_response_id,
        'correlationId', v_attempt.correlation_id,
        'signatureMethod', v_attempt.signature_method,
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
    'signatureMethod', v_attempt.signature_method,
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_participant_completion_auth003(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_participant_completion_auth003(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID
) TO service_role;
