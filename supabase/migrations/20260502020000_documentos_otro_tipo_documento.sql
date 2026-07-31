-- Add otro_tipo_documento column to documentos table
-- Stores the custom document type when user selects "Otros"

ALTER TABLE public.documentos
ADD COLUMN IF NOT EXISTS otro_tipo_documento TEXT DEFAULT NULL;
