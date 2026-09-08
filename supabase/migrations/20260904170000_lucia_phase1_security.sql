-- LucIA Phase 1: document ACL, capability hashes, distributed limits and safe telemetry.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Public capabilities are looked up by digest. Raw legacy columns remain only
-- for compatibility with existing capture clients and are never used by LucIA.
ALTER TABLE public.enrollment_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE public.mobile_upload_sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE public.form_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;

UPDATE public.enrollment_tokens
SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
WHERE token IS NOT NULL AND token_hash IS NULL;
UPDATE public.mobile_upload_sessions
SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
WHERE token IS NOT NULL AND token_hash IS NULL;
UPDATE public.form_tokens
SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
WHERE token IS NOT NULL AND token_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS enrollment_tokens_token_hash_idx ON public.enrollment_tokens(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS mobile_upload_sessions_token_hash_idx ON public.mobile_upload_sessions(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS form_tokens_token_hash_idx ON public.form_tokens(token_hash);

CREATE OR REPLACE FUNCTION public.sync_public_capability_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.token IS NOT NULL THEN
    NEW.token_hash := encode(extensions.digest(NEW.token, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_tokens_sync_hash ON public.enrollment_tokens;
CREATE TRIGGER enrollment_tokens_sync_hash BEFORE INSERT OR UPDATE OF token ON public.enrollment_tokens
FOR EACH ROW EXECUTE FUNCTION public.sync_public_capability_hash();
DROP TRIGGER IF EXISTS mobile_upload_sessions_sync_hash ON public.mobile_upload_sessions;
CREATE TRIGGER mobile_upload_sessions_sync_hash BEFORE INSERT OR UPDATE OF token ON public.mobile_upload_sessions
FOR EACH ROW EXECUTE FUNCTION public.sync_public_capability_hash();
DROP TRIGGER IF EXISTS form_tokens_sync_hash ON public.form_tokens;
CREATE TRIGGER form_tokens_sync_hash BEFORE INSERT OR UPDATE OF token ON public.form_tokens
FOR EACH ROW EXECUTE FUNCTION public.sync_public_capability_hash();

-- The completion RPC keeps its historical argument name for API compatibility,
-- but the value is now a SHA-256 digest and raw capabilities are never queried.
CREATE OR REPLACE FUNCTION public.complete_identity_enrollment(
  p_token text,
  p_result jsonb
)
RETURNS TABLE(enrollment_result_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token public.enrollment_tokens%ROWTYPE;
  v_result_id uuid;
  v_completed_at timestamptz := now();
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'IDENTITY_ENROLLMENT_SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_token
  FROM public.enrollment_tokens
  WHERE token_hash = p_token
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
    v_token.id, v_token.user_id, p_token, v_token.session_id,
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

-- Backfill a digest beside participant portal capabilities inside JSONB.
UPDATE public.documentos d
SET participantes = (
  SELECT jsonb_agg(
    CASE
      WHEN participant ? 'portal_token' AND length(participant ->> 'portal_token') > 0
      THEN participant || jsonb_build_object(
        'portal_token_hash', encode(extensions.digest(participant ->> 'portal_token', 'sha256'), 'hex'),
        'portal_token_expires_at', COALESCE(
          participant ->> 'portal_token_expires_at',
          (now() + interval '30 days')::text
        )
      )
      ELSE participant
    END
  )
  FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) participant
)
WHERE jsonb_typeof(d.participantes) = 'array' AND jsonb_array_length(d.participantes) > 0;

-- Workspace membership is necessary, but only ownership, manager role or an
-- active participant grant authorizes a specific document.
CREATE OR REPLACE FUNCTION public.can_access_documento(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documentos d
    WHERE d.id = p_document_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.document_user_visibility visibility
        WHERE visibility.document_id = d.id
          AND visibility.user_id = auth.uid()
          AND (visibility.hidden_at IS NOT NULL OR (visibility.trashed_at IS NOT NULL AND visibility.restored_at IS NULL))
      )
      AND (
        d.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members manager
          WHERE manager.workspace_id = d.workspace_id
            AND manager.user_id = auth.uid()
            AND manager.status = 'active'
            AND lower(manager.role::text) IN ('owner', 'admin', 'workspace_admin')
            AND (manager.access_expires_at IS NULL OR manager.access_expires_at > now())
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) participant
          WHERE lower(COALESCE(participant ->> 'current_access', 'true')) NOT IN ('false', '0', 'no')
            AND participant ->> 'portal_token_invalidated_at' IS NULL
            AND (
              public.try_uuid(participant ->> 'id') = auth.uid()
              OR public.try_uuid(participant ->> 'user_id') = auth.uid()
              OR lower(COALESCE(participant ->> 'email', '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_documento(p_documento_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.can_access_documento(p_documento_id); $$;

REVOKE ALL ON FUNCTION public.can_access_documento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_documento(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_documento(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_documento(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "participants_can_select_documentos" ON public.documentos;
CREATE POLICY "participants_can_select_documentos" ON public.documentos
FOR SELECT TO authenticated USING (public.can_access_documento(id));

DROP POLICY IF EXISTS "ai_chunks_workspace_member_read" ON public.ai_document_chunks;
DROP POLICY IF EXISTS "ai_chunks_service_role_all" ON public.ai_document_chunks;
CREATE POLICY "ai_chunks_document_acl_read" ON public.ai_document_chunks
FOR SELECT TO authenticated USING (
  public.can_access_documento(document_id)
  AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ai_document_chunks.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND (wm.access_expires_at IS NULL OR wm.access_expires_at > now())
  )
);

DROP POLICY IF EXISTS "ai_chunks_workspace_member_insert" ON public.ai_document_chunks;
CREATE POLICY "ai_chunks_document_manager_insert" ON public.ai_document_chunks
FOR INSERT TO authenticated WITH CHECK (
  public.can_access_documento(document_id)
  AND EXISTS (
    SELECT 1 FROM public.documentos d
    LEFT JOIN public.workspace_members wm
      ON wm.workspace_id = d.workspace_id AND wm.user_id = auth.uid()
    WHERE d.id = ai_document_chunks.document_id
      AND (d.owner_id = auth.uid() OR (wm.status = 'active' AND lower(wm.role::text) IN ('owner','admin','workspace_admin')))
  )
);
CREATE POLICY "ai_chunks_service_role_all" ON public.ai_document_chunks
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP FUNCTION IF EXISTS public.match_document_chunks(vector(1536), UUID, UUID, FLOAT, INT);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, UUID, UUID, FLOAT, INT);
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector(1536),
  p_workspace_id UUID,
  p_document_id UUID,
  p_allowed_document_ids UUID[],
  match_threshold FLOAT DEFAULT 0.70,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID, document_id UUID, workspace_id UUID, content TEXT,
  page_number INTEGER, chunk_index INTEGER, metadata JSONB, similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(array_length(p_allowed_document_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = auth.uid()
      AND wm.status = 'active' AND (wm.access_expires_at IS NULL OR wm.access_expires_at > now())
  ) THEN
    RETURN;
  END IF;
  IF p_document_id IS NOT NULL AND NOT (p_document_id = ANY(p_allowed_document_ids)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.document_id, c.workspace_id, c.content, c.page_number,
    c.chunk_index, c.metadata, 1 - (c.embedding <=> query_embedding)
  FROM public.ai_document_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND c.document_id = ANY(p_allowed_document_ids)
    AND (p_document_id IS NULL OR c.document_id = p_document_id)
    AND public.can_access_documento(c.document_id)
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 20);
END;
$$;

REVOKE ALL ON FUNCTION public.match_document_chunks(vector(1536), UUID, UUID, UUID[], FLOAT, INT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector(1536), UUID, UUID, UUID[], FLOAT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_document_chunks_count(p_document_id UUID, p_workspace_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL
      OR NOT public.can_access_documento(p_document_id)
      OR NOT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = auth.uid()
          AND wm.status = 'active'
          AND (wm.access_expires_at IS NULL OR wm.access_expires_at > now())
      )
    THEN 0
    ELSE (
      SELECT COUNT(*)::INTEGER FROM public.ai_document_chunks
      WHERE document_id = p_document_id AND workspace_id = p_workspace_id
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.get_document_chunks_count(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_document_chunks_count(UUID, UUID) TO authenticated;

-- Distributed fixed-window limiter. Only trusted server code can consume it.
CREATE TABLE IF NOT EXISTS public.ai_rate_limit_buckets (
  key_hash CHAR(64) PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.ai_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_rate_limit_buckets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_ai_rate_limit(
  p_key_hash TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count INTEGER;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' OR p_key_hash !~ '^[a-f0-9]{64}$'
    OR p_limit < 1 OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RETURN false;
  END IF;
  INSERT INTO public.ai_rate_limit_buckets(key_hash, window_started_at, request_count, expires_at)
  VALUES (p_key_hash, now(), 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE WHEN ai_rate_limit_buckets.expires_at <= now() THEN now() ELSE ai_rate_limit_buckets.window_started_at END,
    request_count = CASE WHEN ai_rate_limit_buckets.expires_at <= now() THEN 1 ELSE ai_rate_limit_buckets.request_count + 1 END,
    expires_at = CASE WHEN ai_rate_limit_buckets.expires_at <= now() THEN now() + make_interval(secs => p_window_seconds) ELSE ai_rate_limit_buckets.expires_at END
  RETURNING request_count INTO v_count;
  RETURN v_count <= p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

ALTER TABLE public.ai_query_logs
  ALTER COLUMN workspace_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS source_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS document_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS chunk_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(14,8),
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS has_evidence BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS token_grant_id UUID;

DROP POLICY IF EXISTS "ai_logs_service_role_all" ON public.ai_query_logs;
CREATE POLICY "ai_logs_service_role_all" ON public.ai_query_logs
FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.lucia_messages
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS intent TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS source_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS document_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS chunk_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(14,8),
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS has_evidence BOOLEAN;

COMMENT ON TABLE public.ai_rate_limit_buckets IS 'Distributed server-only rate limits for AI routes; keys are SHA-256 digests.';
COMMENT ON COLUMN public.ai_query_logs.token_grant_id IS 'Ephemeral grant identifier. Raw public capability tokens are forbidden.';
