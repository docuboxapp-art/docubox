-- =============================================================================
-- MIGRACIÓN: add_missing_documentos_columns
-- Agrega columnas faltantes a la tabla documentos:
-- - fecha_completado: fecha en que el documento fue completado/firmado
-- - folio_interno: folio interno del documento
-- =============================================================================

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS fecha_completado TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS folio_interno TEXT;

-- Índice para búsqueda por fecha_completado
CREATE INDEX IF NOT EXISTS idx_documentos_fecha_completado
  ON public.documentos (fecha_completado)
  WHERE fecha_completado IS NOT NULL;
