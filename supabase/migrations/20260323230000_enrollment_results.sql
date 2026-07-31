-- Migration: Enrollment results, encrypted storage, and completion trigger
-- Timestamp: 20260323230000

-- 1. Add user_id foreign key to enrollment_tokens (links to user_profiles)
ALTER TABLE public.enrollment_tokens
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- 2. Add encrypted image columns to enrollment_tokens (AES-256 encrypted base64)
ALTER TABLE public.enrollment_tokens
ADD COLUMN IF NOT EXISTS anverso_encrypted TEXT,
ADD COLUMN IF NOT EXISTS reverso_encrypted TEXT,
ADD COLUMN IF NOT EXISTS selfie_encrypted TEXT,
ADD COLUMN IF NOT EXISTS face_encoding_encrypted TEXT,
ADD COLUMN IF NOT EXISTS encryption_iv TEXT,
ADD COLUMN IF NOT EXISTS face_match_score NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS document_metadata JSONB,
ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS processing_error TEXT;

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_user_id ON public.enrollment_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_processing_status ON public.enrollment_tokens(processing_status);

-- 3. enrollment_results table (final record after enrollment completes)
CREATE TABLE IF NOT EXISTS public.enrollment_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_token_id UUID NOT NULL REFERENCES public.enrollment_tokens(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    token TEXT NOT NULL,
    session_id TEXT NOT NULL,
    -- Personal data
    nombre TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    curp TEXT,
    rfc TEXT,
    fecha_nacimiento TEXT,
    sexo TEXT,
    tipo_identificacion TEXT,
    -- Encrypted biometric references (storage paths, AES-256 encrypted)
    anverso_storage_path TEXT,
    reverso_storage_path TEXT,
    selfie_storage_path TEXT,
    face_encoding_encrypted TEXT,
    encryption_iv TEXT,
    -- Validation results
    face_match_score NUMERIC(5,2),
    face_match_passed BOOLEAN DEFAULT false,
    document_metadata JSONB,
    -- Status
    status TEXT NOT NULL DEFAULT 'completed',
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enrollment_results_token ON public.enrollment_results(token);
CREATE INDEX IF NOT EXISTS idx_enrollment_results_user_id ON public.enrollment_results(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_results_session_id ON public.enrollment_results(session_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_results_curp ON public.enrollment_results(curp);
CREATE INDEX IF NOT EXISTS idx_enrollment_results_created_at ON public.enrollment_results(created_at);

ALTER TABLE public.enrollment_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_enrollment_results" ON public.enrollment_results;
CREATE POLICY "public_insert_enrollment_results"
ON public.enrollment_results
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_enrollment_results" ON public.enrollment_results;
CREATE POLICY "public_select_enrollment_results"
ON public.enrollment_results
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "public_update_enrollment_results" ON public.enrollment_results;
CREATE POLICY "public_update_enrollment_results"
ON public.enrollment_results
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- 4. Function: notify webapp when enrollment completes (via pg_notify)
CREATE OR REPLACE FUNCTION public.notify_enrollment_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only fire when status changes TO 'completed'
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
        PERFORM pg_notify(
            'enrollment_complete',
            json_build_object(
                'enrollment_result_id', NEW.id,
                'enrollment_token_id', NEW.enrollment_token_id,
                'token', NEW.token,
                'session_id', NEW.session_id,
                'user_id', NEW.user_id,
                'curp', NEW.curp,
                'nombre', NEW.nombre,
                'apellido_paterno', NEW.apellido_paterno,
                'tipo_identificacion', NEW.tipo_identificacion,
                'face_match_score', NEW.face_match_score,
                'face_match_passed', NEW.face_match_passed,
                'created_at', NEW.created_at
            )::text
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_enrollment_result_created ON public.enrollment_results;
CREATE TRIGGER on_enrollment_result_created
    AFTER INSERT OR UPDATE ON public.enrollment_results
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_enrollment_complete();

-- 5. Function: auto-update updated_at on enrollment_results
CREATE OR REPLACE FUNCTION public.update_enrollment_results_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enrollment_results_updated_at ON public.enrollment_results;
CREATE TRIGGER enrollment_results_updated_at
    BEFORE UPDATE ON public.enrollment_results
    FOR EACH ROW
    EXECUTE FUNCTION public.update_enrollment_results_updated_at();
