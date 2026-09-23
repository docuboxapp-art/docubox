-- The browser encrypts the SAT private-key file before this row is written.
-- This table never contains a plaintext private key or its password.
CREATE TABLE public.encrypted_efirma_keys (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  certificate_der_base64 TEXT NOT NULL,
  certificate_fingerprint_sha256 TEXT NOT NULL,
  certificate_serial TEXT,
  certificate_rfc TEXT,
  certificate_subject TEXT,
  certificate_not_after TIMESTAMPTZ,
  encrypted_key_ciphertext TEXT NOT NULL,
  encrypted_key_iv TEXT NOT NULL,
  encrypted_key_salt TEXT NOT NULL,
  wrap_algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM',
  kdf_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA256',
  kdf_iterations INTEGER NOT NULL DEFAULT 600000,
  format_version SMALLINT NOT NULL DEFAULT 1,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT encrypted_efirma_keys_fingerprint_check
    CHECK (certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT encrypted_efirma_keys_ciphertext_size_check
    CHECK (octet_length(encrypted_key_ciphertext) BETWEEN 32 AND 800000),
  CONSTRAINT encrypted_efirma_keys_iv_check
    CHECK (octet_length(encrypted_key_iv) BETWEEN 12 AND 128),
  CONSTRAINT encrypted_efirma_keys_salt_check
    CHECK (octet_length(encrypted_key_salt) BETWEEN 16 AND 128),
  CONSTRAINT encrypted_efirma_keys_kdf_iterations_check
    CHECK (kdf_iterations BETWEEN 300000 AND 2000000),
  CONSTRAINT encrypted_efirma_keys_algorithms_check
    CHECK (
      wrap_algorithm = 'AES-256-GCM'
      AND kdf_algorithm = 'PBKDF2-SHA256'
      AND format_version = 1
    )
);

ALTER TABLE public.encrypted_efirma_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.encrypted_efirma_keys FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.encrypted_efirma_keys TO authenticated;

CREATE POLICY encrypted_efirma_keys_owner_select
  ON public.encrypted_efirma_keys
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY encrypted_efirma_keys_owner_insert
  ON public.encrypted_efirma_keys
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY encrypted_efirma_keys_owner_update
  ON public.encrypted_efirma_keys
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY encrypted_efirma_keys_owner_delete
  ON public.encrypted_efirma_keys
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.encrypted_efirma_keys IS
  'Zero-knowledge e.firma vault. Private-key files are encrypted in the browser; passwords and plaintext keys are never persisted.';
COMMENT ON COLUMN public.encrypted_efirma_keys.encrypted_key_ciphertext IS
  'AES-256-GCM ciphertext produced in the user browser.';

-- Short-lived server challenges bind a browser-generated signature to the
-- authenticated participant, document hash, location and signing instant.
CREATE TABLE public.efirma_signing_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  signed_payload TEXT NOT NULL,
  signed_payload_sha256 TEXT NOT NULL,
  session_evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  device_fingerprint JSONB NOT NULL DEFAULT '{}'::JSONB,
  participant_context JSONB NOT NULL DEFAULT '{}'::JSONB,
  client_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  used_at TIMESTAMPTZ,
  CONSTRAINT efirma_signing_challenges_payload_hash_check
    CHECK (signed_payload_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT efirma_signing_challenges_expiry_check
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes')
);

CREATE INDEX efirma_signing_challenges_user_document_idx
  ON public.efirma_signing_challenges(user_id, document_id, created_at DESC);
CREATE INDEX efirma_signing_challenges_expiry_idx
  ON public.efirma_signing_challenges(expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.efirma_signing_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.efirma_signing_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.efirma_signing_challenges TO service_role;

COMMENT ON TABLE public.efirma_signing_challenges IS
  'Single-use server challenges for client-side SAT e.firma operations. Not exposed to browser roles.';
