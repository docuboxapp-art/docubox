-- Device Login History: track known devices per user and detect new ones

CREATE TABLE IF NOT EXISTS public.device_login_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_type TEXT,
  browser TEXT,
  browser_version TEXT,
  operating_system TEXT,
  os_version TEXT,
  user_agent TEXT,
  ip_address TEXT,
  city TEXT,
  country TEXT,
  is_trusted BOOLEAN DEFAULT false,
  first_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  login_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_device_login_history_user_id ON public.device_login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_device_login_history_fingerprint ON public.device_login_history(user_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_login_history_last_seen ON public.device_login_history(last_seen_at DESC);

ALTER TABLE public.device_login_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_device_history" ON public.device_login_history;
CREATE POLICY "users_manage_own_device_history"
  ON public.device_login_history
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can insert/update (for API routes using service key)
DROP POLICY IF EXISTS "service_role_manage_device_history" ON public.device_login_history;
CREATE POLICY "service_role_manage_device_history"
  ON public.device_login_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
