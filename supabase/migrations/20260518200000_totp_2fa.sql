-- ============================================================
-- TOTP 2FA Module: user_totp_settings + auth_security_events
-- ============================================================

-- 1. user_totp_settings table
CREATE TABLE IF NOT EXISTS public.user_totp_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  is_enabled boolean DEFAULT false,
  confirmed_at timestamptz,
  last_used_at timestamptz,
  failed_attempts integer DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_totp_settings_user_id ON public.user_totp_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_totp_settings_enabled ON public.user_totp_settings(user_id, is_enabled);

-- 2. auth_security_events table
CREATE TABLE IF NOT EXISTS public.auth_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_security_events_user_id ON public.auth_security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_security_events_event_type ON public.auth_security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_security_events_created_at ON public.auth_security_events(created_at DESC);

-- 3. updated_at trigger function (reuse or create)
CREATE OR REPLACE FUNCTION public.update_totp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS totp_settings_updated_at ON public.user_totp_settings;
CREATE TRIGGER totp_settings_updated_at
  BEFORE UPDATE ON public.user_totp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_totp_updated_at();

-- 4. Enable RLS
ALTER TABLE public.user_totp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_security_events ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for user_totp_settings
DROP POLICY IF EXISTS "users_manage_own_totp_settings" ON public.user_totp_settings;
CREATE POLICY "users_manage_own_totp_settings"
  ON public.user_totp_settings
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can manage all (for API routes using service key)
DROP POLICY IF EXISTS "service_role_manage_totp_settings" ON public.user_totp_settings;
CREATE POLICY "service_role_manage_totp_settings"
  ON public.user_totp_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 6. RLS Policies for auth_security_events
DROP POLICY IF EXISTS "users_view_own_security_events" ON public.auth_security_events;
CREATE POLICY "users_view_own_security_events"
  ON public.auth_security_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "service_role_manage_security_events" ON public.auth_security_events;
CREATE POLICY "service_role_manage_security_events"
  ON public.auth_security_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
