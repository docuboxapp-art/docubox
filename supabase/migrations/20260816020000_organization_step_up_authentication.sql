-- Short-lived server-validated step-up sessions for critical organization actions.

CREATE TABLE IF NOT EXISTS public.organization_reauthentication_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL DEFAULT 'password' CHECK (method IN ('password', 'totp', 'webauthn')),
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  authenticated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > authenticated_at),
  CHECK (cardinality(scopes) > 0)
);

CREATE INDEX IF NOT EXISTS idx_org_reauth_lookup
  ON public.organization_reauthentication_sessions(workspace_id, user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.organization_reauthentication_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_org_reauthentication" ON public.organization_reauthentication_sessions;
CREATE POLICY "service_manage_org_reauthentication"
  ON public.organization_reauthentication_sessions
  FOR ALL TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

REVOKE ALL ON public.organization_reauthentication_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organization_reauthentication_sessions TO service_role;

COMMENT ON TABLE public.organization_reauthentication_sessions IS
  'Short-lived hashes proving recent step-up authentication. Raw tokens are returned once and never persisted.';

