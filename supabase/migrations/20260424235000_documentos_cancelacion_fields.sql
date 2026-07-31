-- Add cancellation fields to documentos table
ALTER TABLE public.documentos
ADD COLUMN IF NOT EXISTS cancelacion_motivo TEXT,
ADD COLUMN IF NOT EXISTS cancelacion_descripcion TEXT,
ADD COLUMN IF NOT EXISTS cancelado_at TIMESTAMPTZ;
