-- ============================================================
-- DOCUBOX WebAuthn Module Migration
-- Tablas: webauthn_credentials, webauthn_qr_tokens, webauthn_audit
-- ============================================================

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0,
  aaguid TEXT,
  device_type TEXT CHECK (device_type IN (
    'face_id','touch_id','windows_hello_face',
    'windows_hello_fingerprint','windows_hello_pin',
    'android_biometric','pin_fallback'
  )),
  device_name TEXT NOT NULL DEFAULT 'Mi dispositivo',
  device_category TEXT CHECK (device_category IN (
    'mobile','desktop','tablet'
  )),
  os TEXT,
  browser TEXT,
  context TEXT CHECK (context IN (
    'browser_desktop','browser_mobile',
    'capacitor_ios','capacitor_android'
  )),
  registered_from TEXT CHECK (registered_from IN (
    'direct','qr'
  )),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

DO $$ BEGIN
  ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP POLICY IF EXISTS "select_own" ON webauthn_credentials;
CREATE POLICY "select_own" ON webauthn_credentials
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own" ON webauthn_credentials;
CREATE POLICY "delete_own" ON webauthn_credentials
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================

CREATE TABLE IF NOT EXISTS webauthn_qr_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending','completed','expired'
  )),
  device_name TEXT,
  used BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================

CREATE TABLE IF NOT EXISTS webauthn_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  credential_id TEXT,
  event_type TEXT CHECK (event_type IN (
    'register_desktop','register_mobile_qr',
    'login','stepup_sign','stepup_failed',
    'device_revoked','clone_detected'
  )),
  document_id UUID,
  device_name TEXT,
  device_type TEXT,
  device_category TEXT,
  context TEXT,
  registered_from TEXT,
  ip TEXT,
  user_agent TEXT,
  sign_count BIGINT,
  success BOOLEAN,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE webauthn_audit ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP POLICY IF EXISTS "select_own_audit" ON webauthn_audit;
CREATE POLICY "select_own_audit" ON webauthn_audit
  FOR SELECT USING (auth.uid() = user_id);
