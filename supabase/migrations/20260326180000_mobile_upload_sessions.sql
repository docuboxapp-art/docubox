-- Mobile upload sessions for QR-based document upload from phone
CREATE TABLE IF NOT EXISTS public.mobile_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  file_name TEXT,
  file_type TEXT,
  file_size BIGINT,
  file_data TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mobile_upload_sessions_token ON public.mobile_upload_sessions(token);
CREATE INDEX IF NOT EXISTS idx_mobile_upload_sessions_user_id ON public.mobile_upload_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_upload_sessions_expires_at ON public.mobile_upload_sessions(expires_at);

ALTER TABLE public.mobile_upload_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_mobile_upload_sessions" ON public.mobile_upload_sessions;
CREATE POLICY "users_manage_own_mobile_upload_sessions"
ON public.mobile_upload_sessions
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "public_can_read_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
CREATE POLICY "public_can_read_mobile_upload_sessions_by_token"
ON public.mobile_upload_sessions
FOR SELECT
TO anon
USING (expires_at > now() AND status = 'pending');

DROP POLICY IF EXISTS "public_can_update_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
CREATE POLICY "public_can_update_mobile_upload_sessions_by_token"
ON public.mobile_upload_sessions
FOR UPDATE
TO anon
USING (expires_at > now() AND status = 'pending')
WITH CHECK (expires_at > now());

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_upload_sessions;
