-- =============================================================================
-- MIGRACIÓN: document_activity_log
-- Plataforma: DOCUBOX
-- Tabla para registrar todas las interacciones del usuario con un documento
-- en el visor: visualizaciones, cambios de estado, ediciones, recordatorios,
-- notas agregadas, mensajes de chat, etc.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.document_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id    UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_nombre    TEXT,
  actor_email     TEXT,
  action          TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  -- category: 'acceso' | 'ciclo_de_vida' | 'participantes' | 'notificacion' | 'edicion' | 'nota' | 'chat' | 'seguridad'
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_activity_log_documento_id
  ON public.document_activity_log (documento_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_activity_log_actor_id
  ON public.document_activity_log (actor_id);

CREATE INDEX IF NOT EXISTS idx_document_activity_log_action
  ON public.document_activity_log (action);

ALTER TABLE public.document_activity_log ENABLE ROW LEVEL SECURITY;

-- SELECT: propietario y participantes del documento pueden leer
DROP POLICY IF EXISTS "activity_log_select" ON public.document_activity_log;
CREATE POLICY "activity_log_select"
ON public.document_activity_log
FOR SELECT
TO authenticated
USING (
  public.can_read_documento(documento_id)
);

-- INSERT: cualquier usuario autenticado que tenga acceso al documento puede insertar
DROP POLICY IF EXISTS "activity_log_insert" ON public.document_activity_log;
CREATE POLICY "activity_log_insert"
ON public.document_activity_log
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_read_documento(documento_id)
);

-- Service role full access
DROP POLICY IF EXISTS "activity_log_service_role" ON public.document_activity_log;
CREATE POLICY "activity_log_service_role"
ON public.document_activity_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
