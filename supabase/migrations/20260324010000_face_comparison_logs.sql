-- Migration: Face comparison logs + curp_validations enrollment_token column
-- Timestamp: 20260324010000

-- Add enrollment_token to curp_validations if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'curp_validations'
      AND column_name = 'enrollment_token'
  ) THEN
    ALTER TABLE public.curp_validations ADD COLUMN enrollment_token TEXT;
    CREATE INDEX IF NOT EXISTS idx_curp_validations_enrollment_token ON public.curp_validations(enrollment_token);
  END IF;
END $$;

-- Table: face_comparison_logs
CREATE TABLE IF NOT EXISTS public.face_comparison_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_token TEXT,
    estatus TEXT,
    mensaje TEXT,
    similitud NUMERIC(8,4),
    aprobado BOOLEAN,
    codigo_validacion TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_face_comparison_logs_enrollment_token ON public.face_comparison_logs(enrollment_token);
CREATE INDEX IF NOT EXISTS idx_face_comparison_logs_created_at ON public.face_comparison_logs(created_at);

ALTER TABLE public.face_comparison_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_face_comparison_logs" ON public.face_comparison_logs;
CREATE POLICY "public_insert_face_comparison_logs"
ON public.face_comparison_logs
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_face_comparison_logs" ON public.face_comparison_logs;
CREATE POLICY "public_select_face_comparison_logs"
ON public.face_comparison_logs
FOR SELECT
TO public
USING (true);
