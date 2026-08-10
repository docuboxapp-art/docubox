-- Expedientes Digitales: orchestration, evidence and hermetic closure.
-- Document binaries remain in private storage; this schema stores references and immutable evidence.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.case_file_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  case_type text NOT NULL,
  case_subtype text,
  requirements_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  forms_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  identity_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  milestones_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  closure_rules_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.case_file_templates(id) ON DELETE SET NULL,
  folio text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  case_type text NOT NULL,
  case_subtype text,
  subject_name text,
  subject_reference text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','integrating','in_review','observed','ready_to_sign','signing','signed','ready_to_close','sealed','reopened','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  sensitivity_level text NOT NULL DEFAULT 'confidential' CHECK (sensitivity_level IN ('standard','confidential','highly_confidential')),
  responsible_area text,
  owner_user_id uuid REFERENCES auth.users(id),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  tags text[] NOT NULL DEFAULT '{}',
  opened_at timestamptz,
  target_close_at timestamptz,
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  closure_status text NOT NULL DEFAULT 'pending' CHECK (closure_status IN ('pending','eligible','validating','sealed','failed','reopened')),
  root_hash text,
  manifest_id uuid,
  closure_certificate_id uuid,
  sealed_snapshot jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, folio)
);

CREATE TABLE IF NOT EXISTS public.case_file_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id), name text NOT NULL, legal_name text, participant_type text NOT NULL,
  role text NOT NULL, rfc text, curp text, email text, phone text,
  access_method text NOT NULL DEFAULT 'secure_link_otp', status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.case_file_participants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, channel text NOT NULL DEFAULT 'email', recipient text NOT NULL,
  requires_otp boolean NOT NULL DEFAULT true, otp_verified_at timestamptz, expires_at timestamptz NOT NULL,
  opened_at timestamptz, submitted_at timestamptz, revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'attachment',
  sort_order integer NOT NULL DEFAULT 0, is_required boolean NOT NULL DEFAULT true,
  allowed_mime_types text[] NOT NULL DEFAULT ARRAY['application/pdf','image/jpeg','image/png'], max_size_bytes bigint NOT NULL DEFAULT 15728640,
  validity_days integer, requires_ocr boolean NOT NULL DEFAULT false, requires_manual_review boolean NOT NULL DEFAULT true,
  requires_signature boolean NOT NULL DEFAULT false, requires_comparison boolean NOT NULL DEFAULT false,
  requires_identity boolean NOT NULL DEFAULT false, reviewer_user_id uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending', settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES public.case_file_requirements(id) ON DELETE SET NULL,
  source_document_id uuid, signature_request_id uuid, document_type text, document_name text NOT NULL,
  category text NOT NULL DEFAULT 'attachment', is_required boolean NOT NULL DEFAULT false, is_signed_document boolean NOT NULL DEFAULT false,
  storage_path text NOT NULL, file_name text NOT NULL, mime_type text NOT NULL, file_size bigint NOT NULL,
  sha256_hash text NOT NULL, status text NOT NULL DEFAULT 'uploaded', current_version integer NOT NULL DEFAULT 1,
  uploaded_by uuid, uploaded_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz,
  rejection_reason text, correction_action text, expires_at timestamptz, ocr_status text NOT NULL DEFAULT 'pending',
  extracted_data_json jsonb NOT NULL DEFAULT '{}'::jsonb, validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.case_file_documents(id) ON DELETE CASCADE,
  version integer NOT NULL, storage_path text NOT NULL, file_name text NOT NULL, mime_type text NOT NULL,
  file_size bigint NOT NULL, sha256_hash text NOT NULL, uploaded_by uuid, reason text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(document_id, version)
);

CREATE TABLE IF NOT EXISTS public.case_file_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  form_template_id uuid REFERENCES public.form_templates(id) ON DELETE RESTRICT,
  participant_id uuid REFERENCES public.case_file_participants(id) ON DELETE SET NULL,
  title text NOT NULL, status text NOT NULL DEFAULT 'not_started', is_required boolean NOT NULL DEFAULT true,
  requires_signature boolean NOT NULL DEFAULT false, locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  case_form_id uuid NOT NULL REFERENCES public.case_file_forms(id) ON DELETE CASCADE,
  form_response_id uuid REFERENCES public.form_responses(id) ON DELETE RESTRICT,
  generated_pdf_id uuid REFERENCES public.generated_pdfs(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, sha256_hash text, status text NOT NULL DEFAULT 'started',
  submitted_at timestamptz, locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_identity_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.case_file_participants(id) ON DELETE SET NULL,
  method text NOT NULL, status text NOT NULL DEFAULT 'pending', result jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_storage_path text, evidence_hash text, reviewed_by uuid REFERENCES auth.users(id), verified_at timestamptz,
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL DEFAULT '', sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', responsible_user_id uuid REFERENCES auth.users(id), responsible_label text,
  due_date timestamptz, completed_at timestamptz, completion_condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  related_objects jsonb NOT NULL DEFAULT '{}'::jsonb, blocked_reason text, automation_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  milestone_id uuid REFERENCES public.case_file_milestones(id) ON DELETE SET NULL,
  title text NOT NULL, assignee_user_id uuid REFERENCES auth.users(id), status text NOT NULL DEFAULT 'pending', due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.case_file_documents(id) ON DELETE CASCADE,
  form_submission_id uuid REFERENCES public.case_file_form_submissions(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES auth.users(id), decision text NOT NULL, internal_comment text, participant_comment text,
  comparison_result jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.case_file_documents(id) ON DELETE CASCADE,
  form_submission_id uuid REFERENCES public.case_file_form_submissions(id) ON DELETE CASCADE,
  reason_code text NOT NULL, message text NOT NULL, correction_action text NOT NULL,
  responsible_participant_id uuid REFERENCES public.case_file_participants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open', due_at timestamptz, resolved_at timestamptz,
  created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.case_file_documents(id) ON DELETE SET NULL,
  signature_request_id uuid, signer_participant_id uuid REFERENCES public.case_file_participants(id) ON DELETE SET NULL,
  signature_type text NOT NULL, flow_type text NOT NULL DEFAULT 'parallel', signing_order integer,
  status text NOT NULL DEFAULT 'pending', evidence jsonb NOT NULL DEFAULT '{}'::jsonb, signed_document_hash text,
  sent_at timestamptz, viewed_at timestamptz, signed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  actor_user_id uuid, actor_label text NOT NULL, action text NOT NULL, affected_object_type text NOT NULL,
  affected_object_id text, result text NOT NULL DEFAULT 'success', ip inet, user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, previous_hash text, event_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_closure_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL UNIQUE REFERENCES public.case_files(id) ON DELETE RESTRICT,
  manifest_version text NOT NULL DEFAULT '1.0', manifest_json jsonb NOT NULL, storage_path text,
  root_hash text NOT NULL, hash_algorithm text NOT NULL DEFAULT 'SHA-256', system_version text NOT NULL,
  verification_url text, created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_closure_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL UNIQUE REFERENCES public.case_files(id) ON DELETE RESTRICT,
  manifest_id uuid NOT NULL REFERENCES public.case_file_closure_manifests(id) ON DELETE RESTRICT,
  certificate_number text NOT NULL UNIQUE, pdf_path text NOT NULL, root_hash text NOT NULL,
  hash_algorithm text NOT NULL DEFAULT 'SHA-256', closed_by uuid REFERENCES auth.users(id), closed_at timestamptz NOT NULL,
  qr_url text NOT NULL, verification_url text NOT NULL, tsa_token_path text, nom151_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_file_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  case_file_id uuid NOT NULL REFERENCES public.case_files(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, scope text[] NOT NULL DEFAULT ARRAY['status'], expires_at timestamptz NOT NULL,
  revoked_at timestamptz, created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_files_workspace_status ON public.case_files(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_documents_case_status ON public.case_file_documents(case_file_id, status);
CREATE INDEX IF NOT EXISTS idx_case_audit_chain ON public.case_file_audit_events(case_file_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_case_observations_open ON public.case_file_observations(case_file_id, status);

CREATE OR REPLACE FUNCTION public.next_case_file_folio(target_workspace uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_number integer;
BEGIN
  SELECT COALESCE(MAX((regexp_match(folio, '([0-9]+)$'))[1]::integer), 0) + 1 INTO next_number
  FROM public.case_files WHERE workspace_id = target_workspace AND folio LIKE 'EXP-' || EXTRACT(YEAR FROM now())::text || '-%';
  RETURN 'EXP-' || EXTRACT(YEAR FROM now())::text || '-' || lpad(next_number::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_sealed_case_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_status text;
BEGIN
  IF TG_TABLE_NAME = 'case_files' THEN
    IF OLD.status = 'sealed' AND NEW.status <> 'reopened' THEN
      RAISE EXCEPTION 'A sealed case file is immutable';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO case_status FROM public.case_files WHERE id = COALESCE(NEW.case_file_id, OLD.case_file_id);
  IF case_status = 'sealed' THEN RAISE EXCEPTION 'A sealed case file is immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_sealed_case_files ON public.case_files;
CREATE TRIGGER guard_sealed_case_files BEFORE UPDATE OR DELETE ON public.case_files FOR EACH ROW EXECUTE FUNCTION public.prevent_sealed_case_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['case_file_participants','case_file_requirements','case_file_documents','case_file_forms','case_file_form_submissions','case_file_identity_checks','case_file_milestones','case_file_tasks','case_file_reviews','case_file_observations','case_file_signatures']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_sealed_mutation ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER guard_sealed_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_sealed_case_mutation()', table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.reject_case_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Case audit events are immutable'; END; $$;
DROP TRIGGER IF EXISTS immutable_case_audit_events ON public.case_file_audit_events;
CREATE TRIGGER immutable_case_audit_events BEFORE UPDATE OR DELETE ON public.case_file_audit_events FOR EACH ROW EXECUTE FUNCTION public.reject_case_audit_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'case_file_templates','case_files','case_file_participants','case_file_invitations','case_file_requirements',
    'case_file_documents','case_file_document_versions','case_file_forms','case_file_form_submissions',
    'case_file_identity_checks','case_file_milestones','case_file_tasks','case_file_reviews',
    'case_file_observations','case_file_signatures','case_file_audit_events','case_file_closure_manifests',
    'case_file_closure_certificates','case_file_shares'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS case_workspace_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY case_workspace_isolation ON public.%I FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))',
      table_name
    );
  END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('case-files', 'case-files', false, 52428800, ARRAY['application/pdf','image/jpeg','image/png','application/json'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS case_file_private_storage ON storage.objects;
CREATE POLICY case_file_private_storage ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'case-files' AND (storage.foldername(name))[1] IN (SELECT workspace_id::text FROM public.workspace_members WHERE user_id = auth.uid()))
WITH CHECK (bucket_id = 'case-files' AND (storage.foldername(name))[1] IN (SELECT workspace_id::text FROM public.workspace_members WHERE user_id = auth.uid()));

COMMENT ON TABLE public.case_file_closure_manifests IS 'Immutable technical snapshot used to calculate the root hash of a sealed case file.';
COMMENT ON TABLE public.case_file_audit_events IS 'Append-only hash-chained audit evidence. Application inserts must include previous_hash and event_hash.';
