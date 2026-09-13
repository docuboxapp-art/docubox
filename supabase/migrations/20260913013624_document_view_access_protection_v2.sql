-- End-to-end document view access protection.
-- The access code is accepted only by service-role RPCs and is persisted as a
-- bcrypt cost-12 hash by the existing pgcrypto trigger.

ALTER TABLE public.document_security_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS view_access_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS view_access_configured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS view_access_configured_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS view_access_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.document_security_settings settings
SET tenant_id = COALESCE(document.workspace_id, document.owner_id)
FROM public.documentos document
WHERE settings.documento_id = document.id::TEXT
  AND settings.tenant_id IS NULL;

REVOKE ALL ON TABLE public.document_security_settings FROM anon;
REVOKE SELECT, INSERT, UPDATE ON TABLE public.document_security_settings FROM authenticated;
GRANT SELECT (
  id, documento_id, owner_id, vencimiento_enabled, fecha_vencimiento,
  recordatorio_frecuencia, codigo_acceso_enabled, proteccion_adicional_enabled,
  impedir_impresion, evitar_copia_texto, impedir_modificacion, impedir_extraccion,
  evitar_montaje, legal_hold_enabled, created_at, updated_at,
  proteccion_participacion_enabled
) ON public.document_security_settings TO authenticated;
GRANT INSERT (
  documento_id, owner_id, vencimiento_enabled, fecha_vencimiento,
  recordatorio_frecuencia, proteccion_adicional_enabled, impedir_impresion,
  evitar_copia_texto, impedir_modificacion, impedir_extraccion, evitar_montaje,
  legal_hold_enabled, proteccion_participacion_enabled
) ON public.document_security_settings TO authenticated;
GRANT UPDATE (
  vencimiento_enabled, fecha_vencimiento, recordatorio_frecuencia,
  proteccion_adicional_enabled, impedir_impresion, evitar_copia_texto,
  impedir_modificacion, impedir_extraccion, evitar_montaje, legal_hold_enabled,
  proteccion_participacion_enabled
) ON public.document_security_settings TO authenticated;

-- Retire both historical plaintext-capable document columns. The canonical
-- secret lives only in document_security_settings.codigo_acceso_hash.
UPDATE public.documentos
SET codigo_acceso = NULL, codigo_acceso_hash = NULL
WHERE codigo_acceso IS NOT NULL OR codigo_acceso_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.clear_legacy_document_access_secrets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.codigo_acceso := NULL;
  NEW.codigo_acceso_hash := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_legacy_document_access_secrets ON public.documentos;
CREATE TRIGGER trg_clear_legacy_document_access_secrets
BEFORE INSERT OR UPDATE OF codigo_acceso, codigo_acceso_hash
ON public.documentos
FOR EACH ROW EXECUTE FUNCTION public.clear_legacy_document_access_secrets();

CREATE TABLE IF NOT EXISTS public.document_view_access_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id TEXT NOT NULL,
  protection_revision INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_view_access_sessions_lookup
  ON public.document_view_access_sessions
    (tenant_id, document_id, user_id, auth_session_id, token_hash, protection_revision)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_document_view_access_sessions_expiry
  ON public.document_view_access_sessions (expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.document_view_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_view_access_sessions FROM anon, authenticated;

ALTER TABLE public.document_access_code_attempts
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS auth_session_id TEXT,
  ADD COLUMN IF NOT EXISTS user_agent_hash TEXT,
  ADD COLUMN IF NOT EXISTS result_code TEXT;

UPDATE public.document_access_code_attempts attempt
SET tenant_id = COALESCE(document.workspace_id, document.owner_id)
FROM public.documentos document
WHERE attempt.documento_id = document.id
  AND attempt.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_document_access_attempts_progressive
  ON public.document_access_code_attempts
    (tenant_id, documento_id, user_id, auth_session_id, ip_hash, created_at DESC)
  WHERE succeeded = false;

CREATE OR REPLACE FUNCTION public.configure_document_view_access(
  p_document_id UUID,
  p_tenant_id UUID,
  p_document_owner_id UUID,
  p_actor_id UUID,
  p_actor_email TEXT,
  p_code TEXT,
  p_request_id TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_previous_enabled BOOLEAN := false;
  v_revision INTEGER := 1;
  v_workspace_id UUID;
BEGIN
  IF p_code IS NULL OR char_length(p_code) < 8 OR char_length(p_code) > 128 THEN
    RAISE EXCEPTION 'ACCESS_CODE_INVALID';
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.documentos
  WHERE id = p_document_id
    AND owner_id = p_document_owner_id
    AND COALESCE(workspace_id, owner_id) = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_FORBIDDEN'; END IF;

  SELECT codigo_acceso_enabled, view_access_revision
    INTO v_previous_enabled, v_revision
  FROM public.document_security_settings
  WHERE documento_id = p_document_id::TEXT
  FOR UPDATE;

  IF FOUND THEN
    v_revision := COALESCE(v_revision, 1) + 1;
    UPDATE public.document_security_settings
    SET tenant_id = p_tenant_id,
        owner_id = p_document_owner_id,
        codigo_acceso_enabled = true,
        codigo_acceso = p_code,
        view_access_revision = v_revision,
        view_access_configured_at = COALESCE(view_access_configured_at, now()),
        view_access_configured_by = COALESCE(view_access_configured_by, p_actor_id),
        view_access_updated_by = p_actor_id
    WHERE documento_id = p_document_id::TEXT;
  ELSE
    v_revision := 1;
    INSERT INTO public.document_security_settings (
      documento_id, owner_id, tenant_id, codigo_acceso_enabled, codigo_acceso,
      view_access_revision, view_access_configured_at, view_access_configured_by,
      view_access_updated_by
    ) VALUES (
      p_document_id::TEXT, p_document_owner_id, p_tenant_id, true, p_code,
      v_revision, now(), p_actor_id, p_actor_id
    );
  END IF;

  UPDATE public.document_view_access_sessions
  SET revoked_at = now(), revoked_reason = 'PROTECTION_RECONFIGURED'
  WHERE document_id = p_document_id AND revoked_at IS NULL;

  UPDATE public.documentos SET tiene_codigo_acceso = true WHERE id = p_document_id;

  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, result,
    request_id, ip_address, user_agent, new_state, metadata
  ) VALUES (
    v_workspace_id, p_document_id, p_actor_id, p_actor_email,
    CASE WHEN v_previous_enabled THEN 'VIEW_ACCESS_CODE_CHANGED'
         ELSE 'VIEW_ACCESS_PROTECTION_ENABLED' END,
    'success', p_request_id, p_ip_address, p_user_agent,
    jsonb_build_object('enabled', true, 'revision', v_revision),
    jsonb_build_object('tenant_id', p_tenant_id)
  );

  RETURN jsonb_build_object('ok', true, 'enabled', true, 'revision', v_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_document_view_access(
  p_document_id UUID,
  p_tenant_id UUID,
  p_actor_id UUID,
  p_actor_email TEXT,
  p_request_id TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision INTEGER;
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.documentos
  WHERE id = p_document_id
    AND COALESCE(workspace_id, owner_id) = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_FORBIDDEN'; END IF;

  UPDATE public.document_security_settings
  SET codigo_acceso_enabled = false,
      codigo_acceso = NULL,
      codigo_acceso_hash = NULL,
      view_access_revision = view_access_revision + 1,
      view_access_updated_by = p_actor_id
  WHERE documento_id = p_document_id::TEXT
  RETURNING view_access_revision INTO v_revision;

  UPDATE public.document_view_access_sessions
  SET revoked_at = now(), revoked_reason = 'PROTECTION_DISABLED'
  WHERE document_id = p_document_id AND revoked_at IS NULL;

  UPDATE public.documentos SET tiene_codigo_acceso = false WHERE id = p_document_id;

  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, result,
    request_id, ip_address, user_agent, new_state, metadata
  ) VALUES (
    v_workspace_id, p_document_id, p_actor_id, p_actor_email,
    'VIEW_ACCESS_PROTECTION_DISABLED', 'success', p_request_id, p_ip_address,
    p_user_agent, jsonb_build_object('enabled', false, 'revision', COALESCE(v_revision, 1)),
    jsonb_build_object('tenant_id', p_tenant_id)
  );

  RETURN jsonb_build_object('ok', true, 'enabled', false, 'revision', COALESCE(v_revision, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_document_view_access(
  p_document_id UUID,
  p_tenant_id UUID,
  p_user_id UUID,
  p_user_email TEXT,
  p_auth_session_id TEXT,
  p_ip_hash TEXT,
  p_user_agent_hash TEXT,
  p_code TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_request_id TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash TEXT;
  v_revision INTEGER;
  v_failed_count INTEGER;
  v_latest_failure TIMESTAMPTZ;
  v_lock_seconds INTEGER := 0;
  v_valid BOOLEAN;
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.documentos
  WHERE id = p_document_id
    AND COALESCE(workspace_id, owner_id) = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCESS_FORBIDDEN');
  END IF;

  SELECT codigo_acceso_hash, view_access_revision
    INTO v_hash, v_revision
  FROM public.document_security_settings
  WHERE documento_id = p_document_id::TEXT
    AND tenant_id = p_tenant_id
    AND codigo_acceso_enabled = true
  FOR UPDATE;

  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCESS_PROTECTION_DISABLED');
  END IF;

  SELECT count(*), max(created_at)
    INTO v_failed_count, v_latest_failure
  FROM public.document_access_code_attempts
  WHERE tenant_id = p_tenant_id
    AND documento_id = p_document_id
    AND user_id = p_user_id
    AND auth_session_id = p_auth_session_id
    AND ip_hash = p_ip_hash
    AND succeeded = false
    AND created_at >= now() - interval '24 hours';

  v_lock_seconds := CASE
    WHEN v_failed_count >= 15 THEN 3600
    WHEN v_failed_count >= 10 THEN 1800
    WHEN v_failed_count >= 5 THEN 600
    ELSE 0
  END;
  IF v_lock_seconds > 0 AND v_latest_failure + make_interval(secs => v_lock_seconds) > now() THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'ACCESS_CODE_LOCKED',
      'retry_after_seconds', CEIL(EXTRACT(EPOCH FROM (v_latest_failure + make_interval(secs => v_lock_seconds) - now())))
    );
  END IF;

  v_valid := extensions.crypt(p_code, v_hash) = v_hash;
  INSERT INTO public.document_access_code_attempts (
    documento_id, tenant_id, user_id, auth_session_id, ip_hash,
    user_agent_hash, succeeded, result_code
  ) VALUES (
    p_document_id, p_tenant_id, p_user_id, p_auth_session_id, p_ip_hash,
    p_user_agent_hash, v_valid, CASE WHEN v_valid THEN 'ACCESS_GRANTED' ELSE 'ACCESS_CODE_INVALID' END
  );

  IF NOT v_valid THEN
    v_failed_count := v_failed_count + 1;
    v_lock_seconds := CASE
      WHEN v_failed_count >= 15 THEN 3600
      WHEN v_failed_count >= 10 THEN 1800
      WHEN v_failed_count >= 5 THEN 600
      ELSE 0
    END;
    INSERT INTO public.document_lifecycle_audit_events (
      workspace_id, document_id, actor_id, actor_email, action, result,
      request_id, ip_address, user_agent, reason, metadata
    ) VALUES (
      v_workspace_id, p_document_id, p_user_id, p_user_email,
      CASE WHEN v_lock_seconds > 0 THEN 'VIEW_ACCESS_TEMPORARILY_LOCKED' ELSE 'VIEW_ACCESS_FAILED' END,
      'denied', p_request_id, p_ip_address, p_user_agent,
      CASE WHEN v_lock_seconds > 0 THEN 'ACCESS_CODE_LOCKED' ELSE 'ACCESS_CODE_INVALID' END,
      jsonb_build_object('tenant_id', p_tenant_id, 'failed_attempts', v_failed_count,
                         'retry_after_seconds', v_lock_seconds)
    );
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE WHEN v_lock_seconds > 0 THEN 'ACCESS_CODE_LOCKED' ELSE 'ACCESS_CODE_INVALID' END,
      'retry_after_seconds', v_lock_seconds
    );
  END IF;

  INSERT INTO public.document_view_access_sessions (
    tenant_id, document_id, user_id, auth_session_id, protection_revision,
    token_hash, ip_hash, user_agent_hash, expires_at
  ) VALUES (
    p_tenant_id, p_document_id, p_user_id, p_auth_session_id, v_revision,
    p_token_hash, p_ip_hash, p_user_agent_hash, p_expires_at
  );

  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, result,
    request_id, ip_address, user_agent, new_state, metadata
  ) VALUES (
    v_workspace_id, p_document_id, p_user_id, p_user_email,
    'VIEW_ACCESS_GRANTED', 'success', p_request_id, p_ip_address, p_user_agent,
    jsonb_build_object('expires_at', p_expires_at, 'revision', v_revision),
    jsonb_build_object('tenant_id', p_tenant_id, 'session_context', p_auth_session_id)
  );

  RETURN jsonb_build_object('ok', true, 'code', 'ACCESS_GRANTED', 'revision', v_revision);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_document_access_code(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.configure_document_view_access(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INET, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_document_view_access(UUID, UUID, UUID, TEXT, TEXT, INET, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlock_document_view_access(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, INET, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_document_view_access(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INET, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_document_view_access(UUID, UUID, UUID, TEXT, TEXT, INET, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_document_view_access(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, INET, TEXT) TO service_role;

COMMENT ON TABLE public.document_view_access_sessions IS
  'Server-side, opaque, revocable unlock grants bound to tenant, document, user, auth session and protection revision.';
COMMENT ON COLUMN public.document_security_settings.codigo_acceso_hash IS
  'One-way password hash. The source access code is never persisted.';
