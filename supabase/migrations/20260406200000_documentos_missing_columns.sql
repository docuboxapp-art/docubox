-- =============================================================================
-- MIGRACIÓN: documentos_missing_columns
-- Agrega columnas faltantes a la tabla documentos que usa /mis-documentos
-- =============================================================================

-- Columna para papelera (soft delete)
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Columna para favoritos
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false;

-- Columna para URL pública/firmada del archivo en storage
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS file_url TEXT DEFAULT NULL;

-- Columnas de escaneo de seguridad
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS scan_status TEXT DEFAULT NULL;

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS scan_threat TEXT DEFAULT NULL;

-- Índice para búsquedas de documentos no eliminados
CREATE INDEX IF NOT EXISTS idx_documentos_deleted_at
  ON public.documentos (deleted_at)
  WHERE deleted_at IS NULL;

-- Índice para favoritos
CREATE INDEX IF NOT EXISTS idx_documentos_is_favorite
  ON public.documentos (owner_id, is_favorite)
  WHERE is_favorite = true;
