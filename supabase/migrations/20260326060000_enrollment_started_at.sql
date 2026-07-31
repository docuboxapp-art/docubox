-- ============================================================
-- Agrega columna started_at a enrollment_tokens
-- Registra el momento exacto en que el usuario inicia el flujo
-- de enrolamiento (al hacer clic en "Comenzar" en la pantalla 1).
-- created_at = cuando se generó el token (desde la webapp)
-- started_at = cuando el usuario abrió el enlace y comenzó
-- completed_at = cuando el usuario finalizó el proceso
-- ============================================================

ALTER TABLE public.enrollment_tokens
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Índice para consultas por fecha de inicio
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_started_at
ON public.enrollment_tokens(started_at DESC);
