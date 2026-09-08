-- Protección de visualización mediante código de acceso.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.document_security_settings
  ADD COLUMN IF NOT EXISTS codigo_acceso_hash TEXT,
  ADD COLUMN IF NOT EXISTS codigo_acceso_updated_at TIMESTAMPTZ;

-- Convierte los valores legados y elimina el texto plano de forma irreversible.
UPDATE public.document_security_settings
SET
  codigo_acceso_hash = extensions.crypt(codigo_acceso, extensions.gen_salt('bf', 12)),
  codigo_acceso = NULL,
  codigo_acceso_updated_at = now()
WHERE codigo_acceso IS NOT NULL
  AND codigo_acceso_hash IS NULL;

CREATE OR REPLACE FUNCTION public.hash_document_access_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.codigo_acceso IS NOT NULL THEN
    NEW.codigo_acceso_hash := extensions.crypt(NEW.codigo_acceso, extensions.gen_salt('bf', 12));
    NEW.codigo_acceso := NULL;
    NEW.codigo_acceso_updated_at := now();
  END IF;
  IF NEW.codigo_acceso_enabled = false THEN
    NEW.codigo_acceso_hash := NULL;
    NEW.codigo_acceso := NULL;
    NEW.codigo_acceso_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_document_access_code ON public.document_security_settings;
CREATE TRIGGER trg_hash_document_access_code
BEFORE INSERT OR UPDATE OF codigo_acceso, codigo_acceso_enabled
ON public.document_security_settings
FOR EACH ROW EXECUTE FUNCTION public.hash_document_access_code();

CREATE TABLE IF NOT EXISTS public.document_access_code_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_access_code_attempts_window
  ON public.document_access_code_attempts (documento_id, user_id, ip_hash, created_at DESC);

ALTER TABLE public.document_access_code_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_access_code_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.verify_document_access_code(
  p_documento_id UUID,
  p_user_id UUID,
  p_ip_hash TEXT,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hash TEXT;
  v_attempts INTEGER;
  v_valid BOOLEAN;
BEGIN
  SELECT codigo_acceso_hash
    INTO v_hash
  FROM public.document_security_settings
  WHERE documento_id = p_documento_id::text
    AND codigo_acceso_enabled = true;

  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'code', 'NOT_REQUIRED');
  END IF;

  SELECT count(*)
    INTO v_attempts
  FROM public.document_access_code_attempts
  WHERE documento_id = p_documento_id
    AND user_id = p_user_id
    AND ip_hash = p_ip_hash
    AND succeeded = false
    AND created_at >= now() - interval '15 minutes';

  IF v_attempts >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED', 'retry_after_seconds', 900);
  END IF;

  v_valid := extensions.crypt(p_code, v_hash) = v_hash;
  INSERT INTO public.document_access_code_attempts (documento_id, user_id, ip_hash, succeeded)
  VALUES (p_documento_id, p_user_id, p_ip_hash, v_valid);

  RETURN jsonb_build_object('ok', v_valid, 'code', CASE WHEN v_valid THEN 'VERIFIED' ELSE 'INVALID_CODE' END);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_document_access_code(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_document_access_code(UUID, UUID, TEXT, TEXT) TO service_role;
