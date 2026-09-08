-- Session lifetime is calculated from auth.sessions.created_at. Only explicit
-- human interaction may update last_user_activity_at through the guarded RPC.
CREATE TABLE IF NOT EXISTS public.docubox_session_activity (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_user_activity_at TIMESTAMPTZ NOT NULL,
  inactivity_expired_at TIMESTAMPTZ,
  absolute_expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_docubox_session_activity_user
  ON public.docubox_session_activity(user_id, last_user_activity_at DESC);

ALTER TABLE public.docubox_session_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.docubox_session_activity FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.docubox_session_activity TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_docubox_session_policy(
  p_record_user_activity BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  active BOOLEAN,
  reason TEXT,
  is_privileged BOOLEAN,
  inactivity_timeout_seconds INTEGER,
  session_started_at TIMESTAMPTZ,
  last_user_activity_at TIMESTAMPTZ,
  inactivity_expires_at TIMESTAMPTZ,
  absolute_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_session_claim TEXT := auth.jwt() ->> 'session_id';
  v_session_id UUID;
  v_session_started_at TIMESTAMPTZ;
  v_last_user_activity_at TIMESTAMPTZ;
  v_inactivity_expired_at TIMESTAMPTZ;
  v_absolute_expired_at TIMESTAMPTZ;
  v_is_privileged BOOLEAN := FALSE;
  v_inactivity_timeout_seconds INTEGER;
  v_expiry_logged_session_id UUID;
BEGIN
  IF v_user_id IS NULL OR v_session_claim IS NULL THEN
    RETURN QUERY SELECT FALSE, 'UNAUTHENTICATED', FALSE, 0, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  BEGIN
    v_session_id := v_session_claim::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT FALSE, 'INVALID_SESSION', FALSE, 0, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END;

  SELECT sessions.created_at
  INTO v_session_started_at
  FROM auth.sessions sessions
  WHERE sessions.id = v_session_id
    AND sessions.user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'SESSION_NOT_FOUND', FALSE, 0, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT COALESCE(users.is_super_admin, FALSE)
      OR EXISTS (
        SELECT 1
        FROM public.platform_staff staff
        WHERE staff.user_id = v_user_id
          AND staff.status = 'active'
          AND (staff.valid_until IS NULL OR staff.valid_until > CURRENT_TIMESTAMP)
      )
  INTO v_is_privileged
  FROM auth.users users
  WHERE users.id = v_user_id;

  v_is_privileged := COALESCE(v_is_privileged, FALSE);
  v_inactivity_timeout_seconds := CASE WHEN v_is_privileged THEN 600 ELSE 900 END;
  v_absolute_expired_at := v_session_started_at
    + CASE WHEN v_is_privileged THEN INTERVAL '4 hours' ELSE INTERVAL '8 hours' END;

  INSERT INTO public.docubox_session_activity (
    session_id,
    user_id,
    last_user_activity_at
  ) VALUES (
    v_session_id,
    v_user_id,
    v_session_started_at
  )
  ON CONFLICT (session_id) DO NOTHING;

  SELECT activity.last_user_activity_at
  INTO v_last_user_activity_at
  FROM public.docubox_session_activity activity
  WHERE activity.session_id = v_session_id
    AND activity.user_id = v_user_id
  FOR UPDATE;

  v_inactivity_expired_at := v_last_user_activity_at
    + make_interval(secs => v_inactivity_timeout_seconds);

  IF CURRENT_TIMESTAMP >= v_absolute_expired_at THEN
    UPDATE public.docubox_session_activity activity
    SET absolute_expired_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE activity.session_id = v_session_id
      AND activity.absolute_expired_at IS NULL
    RETURNING activity.session_id INTO v_expiry_logged_session_id;

    IF FOUND AND EXISTS (SELECT 1 FROM public.user_profiles profiles WHERE profiles.id = v_user_id) THEN
      INSERT INTO public.auth_security_events (
        user_id, event_type, description, metadata
      ) VALUES (
        v_user_id,
        'session_timeout_absolute',
        CASE WHEN v_is_privileged
          THEN 'Sesión administrativa cerrada automáticamente por límite absoluto (4 horas)'
          ELSE 'Sesión cerrada automáticamente por límite absoluto (8 horas)'
        END,
        jsonb_build_object('source', 'server_session_policy', 'session_id', v_session_id)
      );
    END IF;

    RETURN QUERY SELECT FALSE, 'ABSOLUTE_TIMEOUT', v_is_privileged,
      v_inactivity_timeout_seconds, v_session_started_at, v_last_user_activity_at,
      v_inactivity_expired_at, v_absolute_expired_at;
    RETURN;
  END IF;

  IF CURRENT_TIMESTAMP >= v_inactivity_expired_at THEN
    UPDATE public.docubox_session_activity activity
    SET inactivity_expired_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE activity.session_id = v_session_id
      AND activity.inactivity_expired_at IS NULL
    RETURNING activity.session_id INTO v_expiry_logged_session_id;

    IF FOUND AND EXISTS (SELECT 1 FROM public.user_profiles profiles WHERE profiles.id = v_user_id) THEN
      INSERT INTO public.auth_security_events (
        user_id, event_type, description, metadata
      ) VALUES (
        v_user_id,
        'session_timeout_inactivity',
        CASE WHEN v_is_privileged
          THEN 'Sesión administrativa cerrada automáticamente por inactividad (10 minutos)'
          ELSE 'Sesión cerrada automáticamente por inactividad (15 minutos)'
        END,
        jsonb_build_object('source', 'server_session_policy', 'session_id', v_session_id)
      );
    END IF;

    RETURN QUERY SELECT FALSE, 'INACTIVITY_TIMEOUT', v_is_privileged,
      v_inactivity_timeout_seconds, v_session_started_at, v_last_user_activity_at,
      v_inactivity_expired_at, v_absolute_expired_at;
    RETURN;
  END IF;

  IF p_record_user_activity THEN
    UPDATE public.docubox_session_activity activity
    SET last_user_activity_at = CURRENT_TIMESTAMP,
        inactivity_expired_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE activity.session_id = v_session_id;
    v_last_user_activity_at := CURRENT_TIMESTAMP;
    v_inactivity_expired_at := v_last_user_activity_at
      + make_interval(secs => v_inactivity_timeout_seconds);
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_is_privileged,
    v_inactivity_timeout_seconds, v_session_started_at, v_last_user_activity_at,
    v_inactivity_expired_at, v_absolute_expired_at;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_docubox_session_policy(BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_docubox_session_policy(BOOLEAN)
  TO authenticated, service_role;
