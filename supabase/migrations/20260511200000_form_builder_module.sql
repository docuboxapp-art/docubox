-- ============================================================
-- FORM BUILDER MODULE MIGRATION
-- Tables: form_templates, form_tokens, form_responses
-- ============================================================

-- form_templates
CREATE TABLE IF NOT EXISTS public.form_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id      UUID REFERENCES public.documentos(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published','archived')),
  schema           JSONB NOT NULL DEFAULT '[]',
  settings         JSONB NOT NULL DEFAULT '{}',
  pdf_base_path    TEXT,
  created_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- form_tokens
CREATE TABLE IF NOT EXISTS public.form_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      UUID NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  recipient_email  TEXT NOT NULL,
  recipient_name   TEXT,
  signer_role      TEXT,
  token            TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  attempts         INT NOT NULL DEFAULT 0,
  ip_issued        INET,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- form_responses
CREATE TABLE IF NOT EXISTS public.form_responses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id         UUID NOT NULL REFERENCES public.form_tokens(id),
  template_id      UUID NOT NULL REFERENCES public.form_templates(id),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id),
  document_id      UUID REFERENCES public.documentos(id),
  response_data    JSONB NOT NULL,
  signature_images JSONB,
  field_hashes     JSONB NOT NULL,
  pdf_output_path  TEXT,
  pdf_output_hash  TEXT,
  submitted_at     TIMESTAMPTZ DEFAULT now(),
  ip_address       INET,
  user_agent       TEXT,
  geolocation      JSONB,
  evidence_xml_hash TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_form_templates_workspace_id ON public.form_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_form_templates_created_by ON public.form_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_form_templates_status ON public.form_templates(status);
CREATE INDEX IF NOT EXISTS idx_form_tokens_template_id ON public.form_tokens(template_id);
CREATE INDEX IF NOT EXISTS idx_form_tokens_token ON public.form_tokens(token);
CREATE INDEX IF NOT EXISTS idx_form_responses_template_id ON public.form_responses(template_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_workspace_id ON public.form_responses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_token_id ON public.form_responses(token_id);

-- updated_at trigger function (reuse or create)
CREATE OR REPLACE FUNCTION public.update_form_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_templates_updated_at ON public.form_templates;
CREATE TRIGGER trg_form_templates_updated_at
  BEFORE UPDATE ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_form_templates_updated_at();

-- RLS
ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;

-- Helper function: get user's workspace_id
CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$$;

-- form_templates policies
DROP POLICY IF EXISTS "workspace_isolation_templates_select" ON public.form_templates;
CREATE POLICY "workspace_isolation_templates_select"
  ON public.form_templates FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_isolation_templates_insert" ON public.form_templates;
CREATE POLICY "workspace_isolation_templates_insert"
  ON public.form_templates FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_isolation_templates_update" ON public.form_templates;
CREATE POLICY "workspace_isolation_templates_update"
  ON public.form_templates FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_isolation_templates_delete" ON public.form_templates;
CREATE POLICY "workspace_isolation_templates_delete"
  ON public.form_templates FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

-- form_tokens: service_role only (Edge Functions use service_role)
DROP POLICY IF EXISTS "form_tokens_service_role" ON public.form_tokens;
CREATE POLICY "form_tokens_service_role"
  ON public.form_tokens FOR ALL TO authenticated
  USING (template_id IN (
    SELECT id FROM public.form_templates
    WHERE workspace_id IN (SELECT public.get_user_workspace_ids())
  ))
  WITH CHECK (template_id IN (
    SELECT id FROM public.form_templates
    WHERE workspace_id IN (SELECT public.get_user_workspace_ids())
  ));

-- form_responses policies
DROP POLICY IF EXISTS "workspace_isolation_responses_select" ON public.form_responses;
CREATE POLICY "workspace_isolation_responses_select"
  ON public.form_responses FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_isolation_responses_insert" ON public.form_responses;
CREATE POLICY "workspace_isolation_responses_insert"
  ON public.form_responses FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()));
