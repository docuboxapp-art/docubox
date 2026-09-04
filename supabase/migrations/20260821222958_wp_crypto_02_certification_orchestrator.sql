-- WP-CRYPTO-02: durable execution, retry checkpoints and a version-scoped lease.
-- Additive migration. It preserves every historical certification and its source.

ALTER TABLE public.document_certifications
  ADD COLUMN IF NOT EXISTS execution_attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS execution_trace_id UUID,
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_checkpoint TEXT,
  ADD COLUMN IF NOT EXISTS last_checkpoint_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_detail JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.document_certifications
  DROP CONSTRAINT IF EXISTS document_certifications_execution_status_check;
ALTER TABLE public.document_certifications
  ADD CONSTRAINT document_certifications_execution_status_check
  CHECK (execution_status IN (
    'created', 'queued', 'processing', 'retrying', 'manual_review', 'completed', 'failed'
  )) NOT VALID;
ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_execution_status_check;

ALTER TABLE public.document_certifications
  DROP CONSTRAINT IF EXISTS document_certifications_execution_attempt_check;
ALTER TABLE public.document_certifications
  ADD CONSTRAINT document_certifications_execution_attempt_check
  CHECK (execution_attempt >= 0) NOT VALID;
ALTER TABLE public.document_certifications
  VALIDATE CONSTRAINT document_certifications_execution_attempt_check;

CREATE TABLE IF NOT EXISTS public.certification_execution_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  certification_id UUID NOT NULL REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  trace_id UUID NOT NULL,
  checkpoint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('started', 'completed', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  recovery_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (certification_id, attempt, checkpoint)
);

CREATE INDEX IF NOT EXISTS idx_document_certifications_active_lease
  ON public.document_certifications(document_version_id, lease_expires_at)
  WHERE lease_owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_certification_execution_checkpoints_run
  ON public.certification_execution_checkpoints(certification_id, attempt DESC, created_at DESC);

ALTER TABLE public.certification_execution_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.certification_execution_checkpoints FROM anon, authenticated;

-- Client code uses the service role and a compare-and-swap update on
-- execution_attempt. Exactly one caller can claim a version for each attempt.
COMMENT ON COLUMN public.document_certifications.execution_attempt IS
  'Monotonic execution attempt used for optimistic concurrency control.';
COMMENT ON COLUMN public.document_certifications.execution_trace_id IS
  'Trace identifier for one orchestrator execution; never contains secrets.';
COMMENT ON COLUMN public.document_certifications.lease_owner IS
  'Ephemeral backend-only lease owner. A concurrent request must not advance the same version.';
COMMENT ON COLUMN public.document_certifications.last_checkpoint IS
  'Last durable workflow checkpoint; retries are linked to it for recovery and audit.';
COMMENT ON TABLE public.certification_execution_checkpoints IS
  'Immutable operational checkpoints. Not legal evidence and not exposed through the Data API.';

;
