-- Migration: Enrollment tokens for biometric QR onboarding
-- Timestamp: 20260323210000

-- Table: enrollment_tokens
CREATE TABLE IF NOT EXISTS public.enrollment_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    -- Validated data from mobile onboarding
    nombre TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    curp TEXT,
    rfc TEXT,
    fecha_nacimiento TEXT,
    sexo TEXT,
    tipo_identificacion TEXT,
    selfie_url TEXT,
    id_anverso_url TEXT,
    id_reverso_url TEXT,
    raw_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_token ON public.enrollment_tokens(token);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_session_id ON public.enrollment_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_status ON public.enrollment_tokens(status);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_expires_at ON public.enrollment_tokens(expires_at);

ALTER TABLE public.enrollment_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_enrollment_tokens" ON public.enrollment_tokens;
CREATE POLICY "public_insert_enrollment_tokens"
ON public.enrollment_tokens
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_enrollment_tokens" ON public.enrollment_tokens;
CREATE POLICY "public_select_enrollment_tokens"
ON public.enrollment_tokens
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "public_update_enrollment_tokens" ON public.enrollment_tokens;
CREATE POLICY "public_update_enrollment_tokens"
ON public.enrollment_tokens
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);
