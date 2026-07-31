-- Security: User Sessions and Login Activity Log

-- Active Sessions Table
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT DEFAULT 'web',
  browser TEXT,
  os TEXT,
  ip_address TEXT,
  location TEXT,
  is_current BOOLEAN DEFAULT false,
  last_active_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_active ON public.user_sessions(last_active_at DESC);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_sessions" ON public.user_sessions;
CREATE POLICY "users_manage_own_sessions"
  ON public.user_sessions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Login Activity Log Table
CREATE TABLE IF NOT EXISTS public.login_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'login',
  device_name TEXT,
  device_type TEXT DEFAULT 'web',
  browser TEXT,
  os TEXT,
  ip_address TEXT,
  location TEXT,
  status TEXT DEFAULT 'success',
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_activity_user_id ON public.login_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_login_activity_created_at ON public.login_activity_log(created_at DESC);

ALTER TABLE public.login_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_login_activity" ON public.login_activity_log;
CREATE POLICY "users_view_own_login_activity"
  ON public.login_activity_log
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- MFA settings column on user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_method TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;
