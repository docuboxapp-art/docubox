-- Add totp_purpose column to user_totp_settings
-- Purpose: 'm2fa' (autenticación doble factor) or 'firma' (aprobar/firmar documentos)

ALTER TABLE public.user_totp_settings
  ADD COLUMN IF NOT EXISTS totp_purpose text DEFAULT 'm2fa' CHECK (totp_purpose IN ('m2fa', 'firma'));
