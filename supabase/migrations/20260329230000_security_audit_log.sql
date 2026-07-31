-- Security Audit Log Table
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  documento_id TEXT NOT NULL,
  documento_nombre TEXT,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_user_id
  ON public.security_audit_log(user_id);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_documento_id
  ON public.security_audit_log(documento_id);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_created_at
  ON public.security_audit_log(created_at DESC);

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_security_audit_log" ON public.security_audit_log;
CREATE POLICY "users_view_own_security_audit_log"
  ON public.security_audit_log
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
