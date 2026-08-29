-- Keep legal evidence append-only behavior while resolving pgcrypto explicitly.
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
  v_payload_hash := encode(extensions.digest(convert_to(v_payload_text, 'UTF8'), 'sha256'::text), 'hex');
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
    CASE WHEN p_actor_email IS NULL THEN NULL ELSE encode(extensions.digest(lower(trim(p_actor_email)), 'sha256'::text), 'hex') END,
    COALESCE(p_correlation_id, gen_random_uuid()), p_idempotency_key,
    COALESCE(NULLIF(p_source_system, ''), 'DOCUBOX'), p_source_record_id,
    lower(p_document_sha256), v_payload, v_payload_text, v_payload_hash,
    v_previous_hash, v_chain_material,
    encode(extensions.digest(convert_to(v_chain_material, 'UTF8'), 'sha256'::text), 'hex'), v_occurred_at
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
