-- WP-CRYPTO-03: backend-only provider configuration and health audit records.
-- This migration intentionally stores references and operational metadata only.
-- Private keys, AppRole secret IDs and provider tokens must never be persisted here.

CREATE TABLE IF NOT EXISTS public.crypto_provider_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('KEY_MANAGEMENT')),
  provider_name TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('DEVELOPMENT', 'STAGING', 'PRODUCTION')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  configuration_reference TEXT,
  secret_reference TEXT,
  health_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (health_status IN ('NOT_CONFIGURED', 'OPERATIONAL', 'DEGRADED', 'INVALID')),
  last_health_check_at TIMESTAMPTZ,
  certificate_expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_type, environment)
);

CREATE TABLE IF NOT EXISTS public.crypto_provider_health_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  provider_configuration_id UUID NOT NULL REFERENCES public.crypto_provider_configurations(id) ON DELETE RESTRICT,
  provider_name TEXT NOT NULL,
  key_id TEXT,
  key_version TEXT,
  algorithm TEXT NOT NULL,
  protection_level TEXT NOT NULL CHECK (protection_level IN ('software', 'hardware', 'unknown')),
  result TEXT NOT NULL CHECK (result IN ('SUCCESS', 'FAILED')),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cryptographic_keys
  ADD COLUMN IF NOT EXISTS protection_level TEXT,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.cryptographic_keys
  DROP CONSTRAINT IF EXISTS cryptographic_keys_protection_level_check;
ALTER TABLE public.cryptographic_keys
  ADD CONSTRAINT cryptographic_keys_protection_level_check
  CHECK (protection_level IS NULL OR protection_level IN ('software', 'hardware', 'unknown')) NOT VALID;
ALTER TABLE public.cryptographic_keys
  VALIDATE CONSTRAINT cryptographic_keys_protection_level_check;

CREATE INDEX IF NOT EXISTS idx_crypto_provider_configurations_tenant
  ON public.crypto_provider_configurations(tenant_id, provider_type, environment);
CREATE INDEX IF NOT EXISTS idx_crypto_provider_health_checks_tenant_checked
  ON public.crypto_provider_health_checks(tenant_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_provider_health_checks_configuration
  ON public.crypto_provider_health_checks(provider_configuration_id, checked_at DESC);

ALTER TABLE public.crypto_provider_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_provider_health_checks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crypto_provider_configurations FROM anon, authenticated;
REVOKE ALL ON public.crypto_provider_health_checks FROM anon, authenticated;

COMMENT ON TABLE public.crypto_provider_configurations IS
  'Backend-only references to cryptographic providers. Never stores private keys or provider secrets.';
COMMENT ON TABLE public.crypto_provider_health_checks IS
  'Non-document synthetic health-check audit trail for cryptographic providers.';
COMMENT ON COLUMN public.cryptographic_keys.protection_level IS
  'Logical protection level such as software or hardware; never proof of production suitability.';

;
