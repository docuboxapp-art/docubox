-- Migration: Nubarium OCR logs table
-- Timestamp: 20260324000000

CREATE TABLE IF NOT EXISTS public.nubarium_ocr_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_token TEXT,
    tipo TEXT,
    sub_tipo TEXT,
    folio TEXT,
    clave_elector TEXT,
    curp TEXT,
    primer_apellido TEXT,
    segundo_apellido TEXT,
    nombres TEXT,
    edad TEXT,
    sexo TEXT,
    vigencia TEXT,
    emision TEXT,
    estado TEXT,
    municipio TEXT,
    localidad TEXT,
    seccion TEXT,
    calle TEXT,
    colonia TEXT,
    ciudad TEXT,
    codigo_validacion TEXT,
    codigo_barras TEXT,
    ocr TEXT,
    registro TEXT,
    vigente BOOLEAN,
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nubarium_ocr_logs_enrollment_token ON public.nubarium_ocr_logs(enrollment_token);
CREATE INDEX IF NOT EXISTS idx_nubarium_ocr_logs_curp ON public.nubarium_ocr_logs(curp);
CREATE INDEX IF NOT EXISTS idx_nubarium_ocr_logs_created_at ON public.nubarium_ocr_logs(created_at);

ALTER TABLE public.nubarium_ocr_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_nubarium_ocr_logs" ON public.nubarium_ocr_logs;
CREATE POLICY "public_insert_nubarium_ocr_logs"
ON public.nubarium_ocr_logs
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_nubarium_ocr_logs" ON public.nubarium_ocr_logs;
CREATE POLICY "public_select_nubarium_ocr_logs"
ON public.nubarium_ocr_logs
FOR SELECT
TO public
USING (true);
