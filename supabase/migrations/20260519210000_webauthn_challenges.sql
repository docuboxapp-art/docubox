-- ============================================================
-- DOCUBOX WebAuthn Challenges Table
-- Almacena challenges temporales para registro WebAuthn
-- (reemplaza Redis para entornos sin Redis disponible)
-- ============================================================

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index para búsqueda rápida por key
CREATE INDEX IF NOT EXISTS webauthn_challenges_key_idx ON webauthn_challenges(key);

-- Index para limpieza de expirados
CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_idx ON webauthn_challenges(expires_at);

-- RLS: solo service role puede acceder (no usuarios directos)
DO $$ BEGIN
  ALTER TABLE webauthn_challenges ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
