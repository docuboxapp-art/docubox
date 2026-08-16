-- Keep QR enrollment tokens behind the backend boundary. All application
-- access to this table is performed with the service role after validating
-- either the authenticated user or the high-entropy one-time token.

ALTER TABLE public.webauthn_qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_qr_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.webauthn_qr_tokens FROM anon;
REVOKE ALL ON TABLE public.webauthn_qr_tokens FROM authenticated;

GRANT ALL ON TABLE public.webauthn_qr_tokens TO service_role;

COMMENT ON TABLE public.webauthn_qr_tokens IS
  'Backend-only WebAuthn mobile enrollment tokens. Direct Data API access is intentionally denied.';
