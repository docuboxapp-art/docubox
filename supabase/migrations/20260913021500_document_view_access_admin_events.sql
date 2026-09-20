-- Complete the administrative audit semantics for document view protection.
-- This keeps the existing hash/session model and only enriches state transitions.

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
  v_settings_exist BOOLEAN := false;
  v_revision INTEGER := 1;
  v_workspace_id UUID;
  v_revoked_count INTEGER := 0;
  v_action TEXT;
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
  v_settings_exist := FOUND;

  IF v_settings_exist THEN
    v_revision := COALESCE(v_revision, 1) + 1;
    UPDATE public.document_security_settings
    SET tenant_id = p_tenant_id,
        owner_id = p_document_owner_id,
        codigo_acceso_enabled = true,
        codigo_acceso = p_code,
        view_access_revision = v_revision,
        view_access_configured_at = CASE
          WHEN v_previous_enabled THEN COALESCE(view_access_configured_at, now())
          ELSE now()
        END,
        view_access_configured_by = CASE
          WHEN v_previous_enabled THEN COALESCE(view_access_configured_by, p_actor_id)
          ELSE p_actor_id
        END,
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
  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

  UPDATE public.documentos SET tiene_codigo_acceso = true WHERE id = p_document_id;

  v_action := CASE
    WHEN v_previous_enabled THEN 'VIEW_ACCESS_CODE_CHANGED'
    WHEN v_settings_exist THEN 'VIEW_ACCESS_PROTECTION_REENABLED'
    ELSE 'VIEW_ACCESS_PROTECTION_ENABLED'
  END;

  INSERT INTO public.document_lifecycle_audit_events (
    workspace_id, document_id, actor_id, actor_email, action, result,
    request_id, ip_address, user_agent, new_state, metadata
  ) VALUES (
    v_workspace_id, p_document_id, p_actor_id, p_actor_email, v_action,
    'success', p_request_id, p_ip_address, p_user_agent,
    jsonb_build_object('enabled', true, 'revision', v_revision),
    jsonb_build_object('tenant_id', p_tenant_id)
  );

  IF v_revoked_count > 0 THEN
    INSERT INTO public.document_lifecycle_audit_events (
      workspace_id, document_id, actor_id, actor_email, action, result, reason,
      request_id, ip_address, user_agent, metadata
    ) VALUES (
      v_workspace_id, p_document_id, p_actor_id, p_actor_email,
      'VIEW_ACCESS_UNLOCKS_INVALIDATED', 'success', 'PROTECTION_RECONFIGURED',
      p_request_id, p_ip_address, p_user_agent,
      jsonb_build_object('tenant_id', p_tenant_id, 'invalidated_count', v_revoked_count)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'enabled', true, 'revision', v_revision,
    'action', v_action, 'invalidated_unlocks', v_revoked_count);
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
  v_revoked_count INTEGER := 0;
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
  GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

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

  IF v_revoked_count > 0 THEN
    INSERT INTO public.document_lifecycle_audit_events (
      workspace_id, document_id, actor_id, actor_email, action, result, reason,
      request_id, ip_address, user_agent, metadata
    ) VALUES (
      v_workspace_id, p_document_id, p_actor_id, p_actor_email,
      'VIEW_ACCESS_UNLOCKS_INVALIDATED', 'success', 'PROTECTION_DISABLED',
      p_request_id, p_ip_address, p_user_agent,
      jsonb_build_object('tenant_id', p_tenant_id, 'invalidated_count', v_revoked_count)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'enabled', false, 'revision', COALESCE(v_revision, 1),
    'invalidated_unlocks', v_revoked_count);
END;
$$;

REVOKE ALL ON FUNCTION public.configure_document_view_access(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INET, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_document_view_access(UUID, UUID, UUID, TEXT, TEXT, INET, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_document_view_access(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INET, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_document_view_access(UUID, UUID, UUID, TEXT, TEXT, INET, TEXT)
  TO service_role;
