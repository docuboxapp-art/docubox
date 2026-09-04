-- Documento lifecycle: papelera, retención, Legal Hold y visibilidad individual.
-- Esta migración no elimina documentos ni evidencias existentes.

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT,
  ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trashed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restore_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_status TEXT,
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_hold_status TEXT,
  ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS legal_hold_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_hold_created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_hold_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legal_hold_released_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_hold_release_reason TEXT,
  ADD COLUMN IF NOT EXISTS purge_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_failure_reason TEXT;

UPDATE public.documentos
SET
  lifecycle_status = COALESCE(
    lifecycle_status,
    CASE WHEN deleted_at IS NOT NULL THEN 'TRASHED' ELSE 'ACTIVE' END
  ),
  trashed_at = COALESCE(trashed_at, deleted_at),
  restore_until = CASE
    WHEN deleted_at IS NOT NULL THEN COALESCE(restore_until, deleted_at + INTERVAL '30 days')
    ELSE restore_until
  END,
  retention_status = COALESCE(retention_status, 'NONE'),
  legal_hold_status = COALESCE(
    legal_hold_status,
    CASE WHEN legal_hold THEN 'ACTIVE' ELSE 'NONE' END
  );

ALTER TABLE public.documentos
  ALTER COLUMN lifecycle_status SET DEFAULT 'ACTIVE',
  ALTER COLUMN lifecycle_status SET NOT NULL,
  ALTER COLUMN retention_status SET DEFAULT 'NONE',
  ALTER COLUMN retention_status SET NOT NULL,
  ALTER COLUMN legal_hold_status SET DEFAULT 'NONE',
  ALTER COLUMN legal_hold_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documentos_lifecycle_status_check'
  ) THEN
    ALTER TABLE public.documentos
      ADD CONSTRAINT documentos_lifecycle_status_check
      CHECK (lifecycle_status IN ('ACTIVE', 'ARCHIVED', 'TRASHED', 'PURGE_ELIGIBLE', 'PURGE_SCHEDULED', 'PURGING', 'PURGED', 'PURGE_FAILED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documentos_retention_status_check'
  ) THEN
    ALTER TABLE public.documentos
      ADD CONSTRAINT documentos_retention_status_check
      CHECK (retention_status IN ('NONE', 'ACTIVE', 'EXPIRED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documentos_legal_hold_status_check'
  ) THEN
    ALTER TABLE public.documentos
      ADD CONSTRAINT documentos_legal_hold_status_check
      CHECK (legal_hold_status IN ('NONE', 'ACTIVE', 'RELEASED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documentos_trash_recovery
  ON public.documentos (restore_until)
  WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documentos_legal_hold_status
  ON public.documentos (legal_hold_status)
  WHERE legal_hold_status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.document_user_visibility (
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  trashed_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  restore_until TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_document_user_visibility_user
  ON public.document_user_visibility (user_id, trashed_at DESC);

ALTER TABLE public.document_user_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_user_visibility FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_user_visibility TO authenticated;

DROP POLICY IF EXISTS document_user_visibility_self ON public.document_user_visibility;
CREATE POLICY document_user_visibility_self
  ON public.document_user_visibility
  FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.document_user_visibility IS
  'Visibilidad personal de participantes. No altera ni elimina el documento global.';
COMMENT ON COLUMN public.documentos.restore_until IS
  'Fin del periodo estándar de recuperación de 30 días en Papelera.';
COMMENT ON COLUMN public.documentos.legal_hold_status IS
  'NONE, ACTIVE o RELEASED. ACTIVE prevalece sobre cualquier acción de trash o purge.';

CREATE TABLE IF NOT EXISTS public.document_lifecycle_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  document_id UUID NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'denied', 'failed')),
  request_id TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_lifecycle_audit_document
  ON public.document_lifecycle_audit_events (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_lifecycle_audit_workspace
  ON public.document_lifecycle_audit_events (workspace_id, created_at DESC);

ALTER TABLE public.document_lifecycle_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_lifecycle_audit_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_document_lifecycle_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'document_lifecycle_audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS document_lifecycle_audit_events_immutable
  ON public.document_lifecycle_audit_events;
CREATE TRIGGER document_lifecycle_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.document_lifecycle_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_document_lifecycle_audit_mutation();
