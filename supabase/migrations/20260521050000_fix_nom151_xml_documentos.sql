-- =============================================================================
-- MIGRACIÓN: Fix NOM-151 y XML Evidence para usar tabla documentos
-- El sistema de evidencia fue construido sobre public.documents (vacía),
-- pero la app usa public.documentos. Esta migración corrige el mapeo.
-- =============================================================================

-- 1. Agregar columnas XML Evidence a documentos (si no existen)
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS xml_evidencia_path    TEXT,
  ADD COLUMN IF NOT EXISTS xml_hash_sha256       TEXT,
  ADD COLUMN IF NOT EXISTS xml_generated_at      TIMESTAMPTZ;

-- 2. Agregar columnas para el PDF sellado (seal-pdf) a documentos
ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS sealed_pdf_path       TEXT,
  ADD COLUMN IF NOT EXISTS sealed_pdf_hash       TEXT,
  ADD COLUMN IF NOT EXISTS sealed_at             TIMESTAMPTZ;

-- 3. Crear tabla nom151_constancias_doc que referencia documentos.id
--    (la tabla nom151_constancias original referencia documents.id que está vacía)
CREATE TABLE IF NOT EXISTS public.nom151_constancias_doc (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    documento_id                UUID NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
    pdf_sha256_local            TEXT NOT NULL DEFAULT '',
    nubarium_codigo_validacion  TEXT NOT NULL DEFAULT '',
    nubarium_hash               TEXT NOT NULL DEFAULT '',
    nubarium_estatus            TEXT NOT NULL DEFAULT '',
    nubarium_clave_mensaje      INTEGER,
    constancia_path             TEXT NOT NULL DEFAULT '',
    constancia_sha256           TEXT NOT NULL DEFAULT '',
    constancia_size_bytes       BIGINT,
    -- Payload enviado y recibido de Nubarium (para el PDF de info)
    nubarium_request_payload    JSONB,
    nubarium_response_payload   JSONB,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','processing','issued','failed')),
    error_detail                JSONB,
    retry_count                 INTEGER NOT NULL DEFAULT 0,
    requested_by                UUID REFERENCES auth.users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nom151_doc_documento_id  ON public.nom151_constancias_doc(documento_id);
CREATE INDEX IF NOT EXISTS idx_nom151_doc_status        ON public.nom151_constancias_doc(status);
CREATE INDEX IF NOT EXISTS idx_nom151_doc_codigo        ON public.nom151_constancias_doc(nubarium_codigo_validacion);

ALTER TABLE public.nom151_constancias_doc ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nom151_doc_service_write" ON public.nom151_constancias_doc;
CREATE POLICY "nom151_doc_service_write" ON public.nom151_constancias_doc
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "nom151_doc_owner_read" ON public.nom151_constancias_doc;
CREATE POLICY "nom151_doc_owner_read" ON public.nom151_constancias_doc
    FOR SELECT USING (
        documento_id IN (
            SELECT id FROM public.documentos WHERE owner_id = auth.uid()
        )
    );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_nom151_doc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_nom151_doc_updated_at ON public.nom151_constancias_doc;
CREATE TRIGGER set_nom151_doc_updated_at
    BEFORE UPDATE ON public.nom151_constancias_doc
    FOR EACH ROW EXECUTE FUNCTION public.update_nom151_doc_updated_at();

-- 4. Índices en documentos para las nuevas columnas
CREATE INDEX IF NOT EXISTS idx_documentos_xml_path ON public.documentos(xml_evidencia_path)
  WHERE xml_evidencia_path IS NOT NULL;
