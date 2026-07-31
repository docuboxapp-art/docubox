-- Add participantes and campos_solicitados columns to documentos table
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS participantes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS campos_solicitados jsonb DEFAULT '[]'::jsonb;
