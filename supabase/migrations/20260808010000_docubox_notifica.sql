-- Docubox Notifica: certified electronic notifications with verifiable evidence.
-- Channel messages are notices only; the canonical document remains in Docubox.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.notification_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS public.certified_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE RESTRICT,
  folio text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL DEFAULT '',
  category text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','available','notice_sent','delivered','authenticated','accessed','acknowledged','in_progress','responded','accepted','rejected','completed','expired','cancelled')),
  evidence_level text NOT NULL DEFAULT 'E1' CHECK (evidence_level IN ('E0','E1','E2','E3','E4','E5','E6')),
  document_snapshot jsonb NOT NULL,
  document_hash_sha256 text NOT NULL CHECK (document_hash_sha256 ~ '^[0-9a-fA-F]{64}$'),
  channels text[] NOT NULL DEFAULT ARRAY['email'],
  require_otp boolean NOT NULL DEFAULT true,
  response_mode text NOT NULL DEFAULT 'acknowledge' CHECK (response_mode IN ('acknowledge','respond','accept_or_reject')),
  allowed_actions text[] NOT NULL DEFAULT ARRAY['acknowledge'],
  due_at timestamptz,
  published_at timestamptz,
  completed_at timestamptz,
  last_event_label text NOT NULL DEFAULT 'Notificacion creada',
  verification_code text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, folio),
  UNIQUE(verification_code)
);

CREATE TABLE IF NOT EXISTS public.notification_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.certified_notifications(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'Destinatario',
  authentication_method text NOT NULL DEFAULT 'email_otp' CHECK (authentication_method IN ('secure_link','email_otp','mfa','docubox_account','identity_policy')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','notified','authenticated','accessed','acknowledged','responded','completed','expired','revoked')),
  authenticated_at timestamptz,
  accessed_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_delivery_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.certified_notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  destination text NOT NULL,
  provider text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','delivered','failed','bounced','read','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.certified_notifications(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.notification_recipients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  first_used_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.certified_notifications(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL,
  event_type text NOT NULL,
  label text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text NOT NULL,
  ip_address inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text,
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id, sequence_no),
  UNIQUE(notification_id, event_hash)
);

CREATE TABLE IF NOT EXISTS public.notification_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.certified_notifications(id) ON DELETE RESTRICT,
  recipient_id uuid NOT NULL REFERENCES public.notification_recipients(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('acknowledge','respond','accept','reject','complete')),
  response_text text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_hash_sha256 text NOT NULL,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.certified_notifications(id) ON DELETE RESTRICT,
  certificate_type text NOT NULL CHECK (certificate_type IN ('availability','notice','access','acknowledgement','response','final')),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','certified','failed','revoked')),
  storage_path text,
  sha256_hash text,
  verification_code text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsa_reference text,
  nom151_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id, certificate_type, version),
  UNIQUE(verification_code)
);

CREATE INDEX IF NOT EXISTS idx_certified_notifications_workspace_status ON public.certified_notifications(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_notification ON public.notification_recipients(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_channels_status ON public.notification_delivery_channels(notification_id, status);
CREATE INDEX IF NOT EXISTS idx_notification_access_token_hash ON public.notification_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_notification_evidence_chain ON public.notification_evidence_events(notification_id, sequence_no);

CREATE OR REPLACE FUNCTION public.guard_notified_document_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.source_document_id IS DISTINCT FROM OLD.source_document_id OR
    NEW.document_snapshot IS DISTINCT FROM OLD.document_snapshot OR
    NEW.document_hash_sha256 IS DISTINCT FROM OLD.document_hash_sha256
  ) THEN
    RAISE EXCEPTION 'The notified document snapshot is immutable';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_notified_document_snapshot ON public.certified_notifications;
CREATE TRIGGER guard_notified_document_snapshot BEFORE UPDATE ON public.certified_notifications FOR EACH ROW EXECUTE FUNCTION public.guard_notified_document_snapshot();

CREATE OR REPLACE FUNCTION public.reject_notification_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Notification evidence events are append-only'; END; $$;
DROP TRIGGER IF EXISTS immutable_notification_evidence_events ON public.notification_evidence_events;
CREATE TRIGGER immutable_notification_evidence_events BEFORE UPDATE OR DELETE ON public.notification_evidence_events FOR EACH ROW EXECUTE FUNCTION public.reject_notification_evidence_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['certified_notifications','notification_recipients','notification_delivery_channels','notification_access_tokens','notification_evidence_events','notification_responses','notification_certificates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS notification_workspace_isolation ON public.%I', table_name);
    EXECUTE format('CREATE POLICY notification_workspace_isolation ON public.%I FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))', table_name);
  END LOOP;
END $$;

ALTER TABLE public.notification_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_categories_read ON public.notification_categories;
CREATE POLICY notification_categories_read ON public.notification_categories FOR SELECT TO authenticated USING (workspace_id IS NULL OR workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS notification_categories_manage ON public.notification_categories;
CREATE POLICY notification_categories_manage ON public.notification_categories FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

INSERT INTO public.notification_categories (workspace_id, name, slug, sort_order)
VALUES
  (NULL, 'Cobranza', 'cobranza', 10),
  (NULL, 'Requerimiento de pago', 'requerimiento-pago', 20),
  (NULL, 'Aviso de incumplimiento', 'aviso-incumplimiento', 30),
  (NULL, 'Requerimiento de subsanacion', 'requerimiento-subsanacion', 40),
  (NULL, 'Terminacion', 'terminacion', 50),
  (NULL, 'No renovacion', 'no-renovacion', 60),
  (NULL, 'Comunicacion contractual', 'comunicacion-contractual', 70),
  (NULL, 'Requerimiento extrajudicial', 'requerimiento-extrajudicial', 80)
ON CONFLICT (workspace_id, slug) DO NOTHING;

COMMENT ON TABLE public.certified_notifications IS 'Canonical notification record. Channel messages only announce secure availability.';
COMMENT ON TABLE public.notification_access_tokens IS 'Only SHA-256 hashes of CSPRNG access tokens are persisted.';
COMMENT ON TABLE public.notification_evidence_events IS 'Append-only, per-notification hash chain for verifiable evidence.';
