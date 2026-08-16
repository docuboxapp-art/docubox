-- Docubox Colabora: short-lived external access for document requests.

CREATE TABLE IF NOT EXISTS public.collaboration_request_external_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.collaboration_document_requests(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
  otp_hash TEXT CHECK (otp_hash IS NULL OR otp_hash ~ '^[0-9a-f]{64}$'),
  otp_expires_at TIMESTAMPTZ,
  otp_consumed_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collab_request_external_sessions_lookup
  ON public.collaboration_request_external_sessions(request_id, expires_at DESC)
  WHERE revoked_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'collaboration_request_files_external_session_fkey'
      AND conrelid = 'public.collaboration_request_files'::regclass
  ) THEN
    ALTER TABLE public.collaboration_request_files
      ADD CONSTRAINT collaboration_request_files_external_session_fkey
      FOREIGN KEY (uploaded_by_external_session_id)
      REFERENCES public.collaboration_request_external_sessions(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.collaboration_request_external_sessions ENABLE ROW LEVEL SECURITY;

-- External access is mediated by backend routes using the service role. Never expose
-- OTP hashes, session hashes, IP addresses or user agents through the anon client.
REVOKE ALL ON public.collaboration_request_external_sessions FROM anon, authenticated;
GRANT ALL ON public.collaboration_request_external_sessions TO service_role;

