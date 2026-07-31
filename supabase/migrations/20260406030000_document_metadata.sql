-- =============================================================================
-- MIGRACIÓN: document_metadata
-- Plataforma: DOCUBOX — Módulo de Análisis de Metadatos PDF
-- =============================================================================
--
-- PROPÓSITO:
--   Almacena los metadatos extraídos automáticamente de cada PDF después del
--   pipeline de seguridad (MIME + sanitización + antivirus). Relación 1-a-1
--   con la tabla documents. Solo puede ser escrita por la Edge Function
--   (service_role); los usuarios solo pueden leer sus propios documentos.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLA: document_metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_metadata (

  -- Identificador único del registro de metadatos
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Referencia al documento analizado (relación 1-a-1, cascada en borrado)
  document_id         UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,

  -- Número total de páginas del PDF
  pdf_page_count      INTEGER,

  -- true = PDF con texto seleccionable (nativo), false = PDF escaneado (solo imágenes)
  pdf_is_native       BOOLEAN,

  -- true = el PDF contiene un formulario AcroForm con campos interactivos
  pdf_has_acroform    BOOLEAN,

  -- true = el PDF contiene al menos una firma digital previa
  pdf_has_prior_sigs  BOOLEAN,

  -- Autor del documento según los metadatos embebidos en el PDF
  pdf_author          TEXT,

  -- Software utilizado para crear el PDF (ej: "Microsoft Word", "Adobe Acrobat")
  pdf_creator_software TEXT,

  -- Fecha de creación embebida en los metadatos del PDF original
  pdf_created_at      TIMESTAMPTZ,

  -- Fecha de última modificación embebida en los metadatos del PDF original
  pdf_modified_at     TIMESTAMPTZ,

  -- Objeto JSON con todos los metadatos que no tienen columna propia
  pdf_metadata_raw    JSONB,

  -- Fecha y hora en que se ejecutó el análisis de metadatos
  analyzed_at         TIMESTAMPTZ DEFAULT NOW(),

  -- Versión del algoritmo de análisis para trazabilidad futura
  analysis_version    TEXT DEFAULT '1.0'
);

-- ---------------------------------------------------------------------------
-- COMENTARIOS EN COLUMNAS
-- ---------------------------------------------------------------------------
COMMENT ON TABLE  public.document_metadata IS 'Metadatos extraídos automáticamente de cada PDF tras el pipeline de seguridad. Relación 1-a-1 con documents.';
COMMENT ON COLUMN public.document_metadata.id                   IS 'Identificador único del registro de metadatos.';
COMMENT ON COLUMN public.document_metadata.document_id          IS 'FK al documento analizado. Relación 1-a-1 con documents.';
COMMENT ON COLUMN public.document_metadata.pdf_page_count       IS 'Número total de páginas del PDF.';
COMMENT ON COLUMN public.document_metadata.pdf_is_native        IS 'true = texto seleccionable (PDF nativo); false = solo imágenes (escaneado).';
COMMENT ON COLUMN public.document_metadata.pdf_has_acroform     IS 'true = el PDF contiene un formulario AcroForm con campos interactivos.';
COMMENT ON COLUMN public.document_metadata.pdf_has_prior_sigs   IS 'true = el PDF contiene al menos una firma digital previa (/Sig en AcroForm).';
COMMENT ON COLUMN public.document_metadata.pdf_author           IS 'Autor del documento según los metadatos embebidos en el PDF.';
COMMENT ON COLUMN public.document_metadata.pdf_creator_software IS 'Software utilizado para crear el PDF (ej: Microsoft Word, Adobe Acrobat).';
COMMENT ON COLUMN public.document_metadata.pdf_created_at       IS 'Fecha de creación embebida en los metadatos del PDF original.';
COMMENT ON COLUMN public.document_metadata.pdf_modified_at      IS 'Fecha de última modificación embebida en los metadatos del PDF original.';
COMMENT ON COLUMN public.document_metadata.pdf_metadata_raw     IS 'Objeto JSON con todos los metadatos que no tienen columna propia (título, asunto, palabras clave, productor, etc.).';
COMMENT ON COLUMN public.document_metadata.analyzed_at          IS 'Fecha y hora en que se ejecutó el análisis de metadatos. Se actualiza automáticamente en cada UPDATE.';
COMMENT ON COLUMN public.document_metadata.analysis_version     IS 'Versión del algoritmo de análisis para trazabilidad futura.';

-- ---------------------------------------------------------------------------
-- ÍNDICES
-- ---------------------------------------------------------------------------

-- Índice UNIQUE en document_id (relación 1-a-1 con documents)
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_metadata_document_id
  ON public.document_metadata (document_id);

-- Índice en analyzed_at para consultas de auditoría y reportes
CREATE INDEX IF NOT EXISTS idx_document_metadata_analyzed_at
  ON public.document_metadata (analyzed_at DESC);

-- ---------------------------------------------------------------------------
-- TRIGGER: actualizar analyzed_at en cada UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_update_document_metadata_analyzed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Actualiza analyzed_at al momento actual cuando se modifica el registro
  NEW.analyzed_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_metadata_analyzed_at ON public.document_metadata;

CREATE TRIGGER trg_document_metadata_analyzed_at
  BEFORE UPDATE ON public.document_metadata
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_document_metadata_analyzed_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_metadata ENABLE ROW LEVEL SECURITY;

-- Policy SELECT: el usuario solo puede leer metadatos de documentos que le pertenecen
DROP POLICY IF EXISTS "owner_can_read_metadata" ON public.document_metadata;
CREATE POLICY "owner_can_read_metadata"
  ON public.document_metadata
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.id = document_metadata.document_id
        AND d.owner_id = auth.uid()
    )
  );

-- Policy INSERT: solo service_role puede insertar (Edge Function usa service role key)
DROP POLICY IF EXISTS "service_role_can_insert_metadata" ON public.document_metadata;
CREATE POLICY "service_role_can_insert_metadata"
  ON public.document_metadata
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Policy UPDATE: solo service_role puede actualizar (Edge Function usa service role key)
DROP POLICY IF EXISTS "service_role_can_update_metadata" ON public.document_metadata;
CREATE POLICY "service_role_can_update_metadata"
  ON public.document_metadata
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
