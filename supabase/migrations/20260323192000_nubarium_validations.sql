-- Migration: Nubarium validations tables (CURP and serial number)
-- Timestamp: 20260323192000

-- Table: curp_validations
CREATE TABLE IF NOT EXISTS public.curp_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    curp TEXT NOT NULL,
    nombre TEXT,
    apellido_paterno TEXT,
    apellido_materno TEXT,
    sexo TEXT,
    fecha_nacimiento TEXT,
    pais_nacimiento TEXT,
    estado_nacimiento TEXT,
    estatus_curp TEXT,
    doc_probatorio INTEGER,
    codigo_validacion TEXT,
    codigo_mensaje TEXT,
    raw_response JSONB,
    validated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_curp_validations_curp ON public.curp_validations(curp);
CREATE INDEX IF NOT EXISTS idx_curp_validations_created_at ON public.curp_validations(created_at);

ALTER TABLE public.curp_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_curp_validations" ON public.curp_validations;
CREATE POLICY "public_insert_curp_validations"
ON public.curp_validations
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_curp_validations" ON public.curp_validations;
CREATE POLICY "public_select_curp_validations"
ON public.curp_validations
FOR SELECT
TO public
USING (true);

-- Table: serial_validations
CREATE TABLE IF NOT EXISTS public.serial_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc TEXT NOT NULL,
    serial TEXT NOT NULL,
    estado TEXT,
    tipo TEXT,
    fecha_inicio TEXT,
    fecha_fin TEXT,
    clave_mensaje INTEGER,
    codigo_validacion TEXT,
    raw_response JSONB,
    validated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_serial_validations_rfc ON public.serial_validations(rfc);
CREATE INDEX IF NOT EXISTS idx_serial_validations_serial ON public.serial_validations(serial);
CREATE INDEX IF NOT EXISTS idx_serial_validations_created_at ON public.serial_validations(created_at);

ALTER TABLE public.serial_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_insert_serial_validations" ON public.serial_validations;
CREATE POLICY "public_insert_serial_validations"
ON public.serial_validations
FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "public_select_serial_validations" ON public.serial_validations;
CREATE POLICY "public_select_serial_validations"
ON public.serial_validations
FOR SELECT
TO public
USING (true);
