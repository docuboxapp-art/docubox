-- =============================================================================
-- MIGRACIÓN: nom151_constancias
-- Módulo: Constancia de Conservación NOM-151-SCFI-2016
-- PSC: Nubarium (acreditado por Secretaría de Economía)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLA: nom151_constancias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nom151_constancias (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id                 UUID NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
    pdf_sha256_local            TEXT NOT NULL,
    nubarium_codigo_validacion  TEXT NOT NULL,
    nubarium_hash               TEXT NOT NULL,
    nubarium_estatus            TEXT NOT NULL,
    nubarium_clave_mensaje      INTEGER,
    constancia_path             TEXT NOT NULL,
    constancia_sha256           TEXT NOT NULL,
    constancia_size_bytes       BIGINT,
    status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','processing','issued','failed')),
    error_detail                JSONB,
    retry_count                 INTEGER NOT NULL DEFAULT 0,
    requested_by                UUID REFERENCES auth.users(id),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nom151_document_id       ON public.nom151_constancias(document_id);
CREATE INDEX IF NOT EXISTS idx_nom151_status            ON public.nom151_constancias(status);
CREATE INDEX IF NOT EXISTS idx_nom151_codigo_validacion ON public.nom151_constancias(nubarium_codigo_validacion);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.nom151_constancias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nom151_service_write" ON public.nom151_constancias;
CREATE POLICY "nom151_service_write" ON public.nom151_constancias
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "nom151_owner_read" ON public.nom151_constancias;
CREATE POLICY "nom151_owner_read" ON public.nom151_constancias
    FOR SELECT USING (
        document_id IN (
            SELECT id FROM public.documents WHERE owner_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- TRIGGER: updated_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_nom151_updated_at ON public.nom151_constancias;
CREATE TRIGGER set_nom151_updated_at
    BEFORE UPDATE ON public.nom151_constancias
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
