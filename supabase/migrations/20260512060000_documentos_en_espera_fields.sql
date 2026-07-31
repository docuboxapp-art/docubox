-- Add en_espera motivo and descripcion fields to documentos table
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS en_espera_motivo text,
  ADD COLUMN IF NOT EXISTS en_espera_descripcion text;
