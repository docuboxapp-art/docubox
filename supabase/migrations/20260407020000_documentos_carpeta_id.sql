-- =============================================================================
-- MIGRACIÓN: documentos_carpeta_id
-- Agrega la columna carpeta_id a la tabla documentos para soportar
-- la organización de documentos en carpetas desde /mis-documentos
-- =============================================================================

-- Columna para vincular documento con carpeta
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS carpeta_id UUID REFERENCES public.carpetas(id) ON DELETE SET NULL;

-- Índice para búsquedas por carpeta
CREATE INDEX IF NOT EXISTS idx_documentos_carpeta_id
  ON public.documentos (carpeta_id);
