-- Backend-only delivery ledger for DOCUMENT_COMPLETED notifications.
-- The unique idempotency key prevents repeated certification requests from
-- producing duplicate email side effects.

CREATE TABLE IF NOT EXISTS public.document_email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  document_certification_id UUID NOT NULL
    REFERENCES public.document_certifications(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL DEFAULT 'DOCUMENT_COMPLETED'
    CHECK (event_type = 'DOCUMENT_COMPLETED'),
  recipient_email TEXT NOT NULL,
  recipient_email_sha256 TEXT NOT NULL CHECK (recipient_email_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'failed', 'bounced')),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  error_code TEXT,
  error_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_email_deliveries_document_idx
  ON public.document_email_deliveries(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_email_deliveries_status_idx
  ON public.document_email_deliveries(status, queued_at)
  WHERE status IN ('queued', 'processing', 'failed');

ALTER TABLE public.document_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_email_deliveries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.document_email_deliveries FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.document_email_deliveries TO service_role;

COMMENT ON TABLE public.document_email_deliveries IS
  'Backend-only idempotency and delivery ledger for document lifecycle emails.';
COMMENT ON COLUMN public.document_email_deliveries.recipient_email IS
  'Operational recipient address. Never exposed through browser-side APIs.';
COMMENT ON COLUMN public.document_email_deliveries.idempotency_key IS
  'Stable event/certification/recipient key, also forwarded to the email provider.';
