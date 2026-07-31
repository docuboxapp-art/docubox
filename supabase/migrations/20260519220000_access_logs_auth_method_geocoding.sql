-- ============================================================
-- Agrega campos faltantes a access_logs:
--   - auth_method: tipo de autenticación (password, otp, biometric, totp)
--   - neighborhood, postcode, place_name: reverse geocoding (ya se calculaba pero no se guardaba)
--   - screen_resolution, language, platform, device_fingerprint: datos extra del dispositivo
-- ============================================================

ALTER TABLE public.access_logs
  ADD COLUMN IF NOT EXISTS auth_method TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS postcode TEXT,
  ADD COLUMN IF NOT EXISTS place_name TEXT,
  ADD COLUMN IF NOT EXISTS screen_resolution TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;

-- Índice para filtrar por método de autenticación
CREATE INDEX IF NOT EXISTS idx_access_logs_auth_method ON public.access_logs(auth_method);
