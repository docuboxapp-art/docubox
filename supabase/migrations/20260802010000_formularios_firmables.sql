-- Formularios Firmables: canonical schemas, response lifecycle, signatures and evidence.
-- Existing form_templates/schema remains compatible; form_schema and pdf_schema are
-- synchronized so the web renderer and PDF renderer share one source of truth.

ALTER TABLE public.form_templates
  ADD COLUMN IF NOT EXISTS form_schema JSONB NOT NULL DEFAULT '{"version":1,"sections":[],"fields":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS pdf_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allowed_signature_types TEXT[] NOT NULL DEFAULT ARRAY['click_sign']::text[],
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE public.form_templates
SET form_schema = jsonb_build_object(
      'version', 1,
      'sections', COALESCE(settings->'sections', '[]'::jsonb),
      'fields', COALESCE(schema, '[]'::jsonb)
    ),
    pdf_schema = COALESCE(settings->'pdfSchema', '{}'::jsonb),
    requires_signature = COALESCE((settings->>'requiresSignature')::boolean, false),
    allowed_signature_types = COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(settings->'allowedSignatureTypes')),
      ARRAY['click_sign']::text[]
    );

ALTER TABLE public.form_templates DROP CONSTRAINT IF EXISTS form_templates_status_check;
ALTER TABLE public.form_templates
  ADD CONSTRAINT form_templates_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'closed', 'archived'));

CREATE OR REPLACE FUNCTION public.sync_form_template_schemas()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.form_schema := jsonb_build_object(
    'version', 1,
    'sections', COALESCE(NEW.settings->'sections', '[]'::jsonb),
    'fields', COALESCE(NEW.schema, '[]'::jsonb)
  );
  NEW.pdf_schema := COALESCE(NEW.settings->'pdfSchema', '{}'::jsonb);
  NEW.requires_signature := COALESCE((NEW.settings->>'requiresSignature')::boolean, false);
  NEW.allowed_signature_types := COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(NEW.settings->'allowedSignatureTypes')),
    ARRAY['click_sign']::text[]
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_form_template_schemas ON public.form_templates;
CREATE TRIGGER trg_sync_form_template_schemas
  BEFORE INSERT OR UPDATE OF schema, settings ON public.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.sync_form_template_schemas();

CREATE TABLE IF NOT EXISTS public.form_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visibility_condition JSONB,
  show_in_pdf BOOLEAN NOT NULL DEFAULT true,
  page_break_before BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.form_sections(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  pdf_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(form_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.form_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_field_id UUID REFERENCES public.form_fields(id) ON DELETE CASCADE,
  target_field_id UUID REFERENCES public.form_fields(id) ON DELETE CASCADE,
  target_section_id UUID REFERENCES public.form_sections(id) ON DELETE CASCADE,
  operator TEXT NOT NULL,
  expected_value JSONB,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.form_responses
  ADD COLUMN IF NOT EXISTS respondent_name TEXT,
  ADD COLUMN IF NOT EXISTS respondent_email TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'started',
  ADD COLUMN IF NOT EXISTS folio TEXT,
  ADD COLUMN IF NOT EXISTS form_schema_hash TEXT,
  ADD COLUMN IF NOT EXISTS draft_saved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generated_pdf_id UUID;

ALTER TABLE public.form_responses DROP CONSTRAINT IF EXISTS form_responses_status_check;
ALTER TABLE public.form_responses
  ADD CONSTRAINT form_responses_status_check
  CHECK (status IN ('started', 'in_progress', 'submitted', 'pdf_generated', 'signing', 'signed', 'rejected', 'cancelled'));

CREATE TABLE IF NOT EXISTS public.form_response_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES public.form_responses(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  answer JSONB,
  answer_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(response_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.form_pdf_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL UNIQUE REFERENCES public.form_templates(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pdf_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.generated_pdfs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_response_id UUID NOT NULL REFERENCES public.form_responses(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  unsigned_sha256_hash TEXT NOT NULL,
  signed_sha256_hash TEXT,
  qr_validation_url TEXT,
  encryption_key_ref TEXT,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'ready_to_sign', 'signed', 'invalidated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ
);

ALTER TABLE public.form_responses DROP CONSTRAINT IF EXISTS form_responses_generated_pdf_id_fkey;
ALTER TABLE public.form_responses
  ADD CONSTRAINT form_responses_generated_pdf_id_fkey
  FOREIGN KEY (generated_pdf_id) REFERENCES public.generated_pdfs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_pdf_id UUID NOT NULL REFERENCES public.generated_pdfs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_role TEXT,
  signature_type TEXT NOT NULL CHECK (signature_type IN ('efirma_sat', 'autografa_digital', 'click_sign')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'signed', 'rejected', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signature_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES public.form_templates(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL,
  allowed_signature_types TEXT[] NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  pdf_position JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_evidence BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.signature_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id UUID NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  document_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.form_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id UUID REFERENCES public.form_templates(id) ON DELETE SET NULL,
  response_id UUID REFERENCES public.form_responses(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  previous_event_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_sections_form ON public.form_sections(form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_form_fields_form ON public.form_fields(form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_form_conditions_form ON public.form_conditions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_answers_response ON public.form_response_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_generated_pdfs_workspace ON public.generated_pdfs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signature_requests_workspace ON public.signature_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_form_audit_workspace ON public.form_audit_logs(workspace_id, created_at DESC);

ALTER TABLE public.form_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_response_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_pdf_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'form_sections', 'form_fields', 'form_conditions', 'form_response_answers',
    'form_pdf_templates', 'generated_pdfs', 'signature_requests', 'signature_blocks',
    'signature_events', 'form_audit_logs'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation_all ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY workspace_isolation_all ON public.%I FOR ALL TO authenticated USING (workspace_id IN (SELECT public.get_user_workspace_ids())) WITH CHECK (workspace_id IN (SELECT public.get_user_workspace_ids()))',
      table_name
    );
  END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('form-artifacts', 'form-artifacts', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS form_artifacts_workspace_access ON storage.objects;
CREATE POLICY form_artifacts_workspace_access
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'form-artifacts'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_workspace_ids())
  )
  WITH CHECK (
    bucket_id = 'form-artifacts'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_workspace_ids())
  );

COMMENT ON TABLE public.generated_pdfs IS
  'PDFs are stored in the private form-artifacts bucket. encryption_key_ref may reference an external KMS key; raw keys are never persisted.';
COMMENT ON TABLE public.signature_events IS
  'Only signature evidence is persisted. e.firma .key files and passwords must remain in process memory and must never be inserted here.';
