-- Log table for mobile ID capture consultations
CREATE TABLE IF NOT EXISTS public.id_capture_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT NOT NULL,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  document_id UUID,
  has_enrollment BOOLEAN DEFAULT false,
  nubarium_similitud NUMERIC,
  nubarium_aprobado BOOLEAN,
  identity_match BOOLEAN,
  identity_mismatch_reason TEXT,
  raw_nubarium_response JSONB,
  captured_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_id_capture_logs_session_token ON public.id_capture_logs(session_token);
CREATE INDEX IF NOT EXISTS idx_id_capture_logs_user_id ON public.id_capture_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_id_capture_logs_created_at ON public.id_capture_logs(created_at);

ALTER TABLE public.id_capture_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_manage_id_capture_logs" ON public.id_capture_logs;
CREATE POLICY "service_role_manage_id_capture_logs"
ON public.id_capture_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_own_id_capture_logs" ON public.id_capture_logs;
CREATE POLICY "authenticated_read_own_id_capture_logs"
ON public.id_capture_logs
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
