-- Docubox identity verification engine.
-- Biometrics and identity artifacts are references to private storage, never inline payloads.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.identity_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  policy_type text NOT NULL DEFAULT 'signature' CHECK (policy_type IN ('signature','kyc','kyb','enrollment','revalidation')),
  assurance_level text NOT NULL DEFAULT 'standard' CHECK (assurance_level IN ('basic','standard','enhanced','custom')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.identity_policies(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_hash text,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(policy_id, version)
);

CREATE TABLE IF NOT EXISTS public.identity_policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL REFERENCES public.identity_policy_versions(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject_type text NOT NULL DEFAULT 'individual' CHECK (subject_type IN ('individual','company','representative','beneficial_owner')),
  requirement_type text NOT NULL DEFAULT 'required' CHECK (requirement_type IN ('required','optional','conditional')),
  condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sides smallint NOT NULL DEFAULT 1 CHECK (sides IN (1,2)),
  max_files smallint NOT NULL DEFAULT 1,
  allowed_mime_types text[] NOT NULL DEFAULT ARRAY['application/pdf','image/jpeg','image/png'],
  max_size_bytes bigint NOT NULL DEFAULT 15728640,
  validity_days integer,
  requires_ocr boolean NOT NULL DEFAULT true,
  requires_authenticity boolean NOT NULL DEFAULT true,
  requires_expiration_check boolean NOT NULL DEFAULT true,
  requires_manual_review boolean NOT NULL DEFAULT false,
  extraction_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparison_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_policy_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL REFERENCES public.identity_policy_versions(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  execution_order integer NOT NULL DEFAULT 0,
  provider text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.participant_identity_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  participant_id uuid,
  document_id uuid,
  form_response_id uuid,
  case_file_id uuid REFERENCES public.case_files(id) ON DELETE CASCADE,
  identity_policy_id uuid NOT NULL REFERENCES public.identity_policies(id) ON DELETE RESTRICT,
  identity_policy_version_id uuid NOT NULL REFERENCES public.identity_policy_versions(id) ON DELETE RESTRICT,
  verification_moment text NOT NULL DEFAULT 'before_signing' CHECK (verification_moment IN ('before_access','before_review','before_signing')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','approved','manual_review','rejected','expired','cancelled')),
  verification_session_id uuid,
  assigned_by uuid REFERENCES auth.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(participant_id, document_id, identity_policy_version_id)
);

CREATE TABLE IF NOT EXISTS public.identity_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subject_type text NOT NULL DEFAULT 'individual' CHECK (subject_type IN ('individual','company','representative','beneficial_owner')),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  normalized_curp_hash text,
  normalized_rfc_hash text,
  document_number_hash text,
  verified_email_hash text,
  verified_phone_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','merged','deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subject_identity_id uuid NOT NULL REFERENCES public.identity_subjects(id) ON DELETE CASCADE,
  source_policy_version_id uuid REFERENCES public.identity_policy_versions(id) ON DELETE SET NULL,
  assurance_level text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','expiring','expired','revoked','blocked')),
  enrolled_at timestamptz,
  valid_until timestamptz,
  last_revalidated_at timestamptz,
  document_expires_at timestamptz,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_enrollment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.identity_enrollments(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  country_code text,
  issuer text,
  masked_number text,
  number_hash text,
  issued_at date,
  expires_at date,
  authenticity_status text,
  ocr_status text,
  storage_path text,
  artifact_hash text,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_biometric_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.identity_enrollments(id) ON DELETE CASCADE,
  reference_type text NOT NULL CHECK (reference_type IN ('face_template','protected_image','voice_reference')),
  provider text NOT NULL,
  provider_reference_id text,
  encrypted_storage_path text,
  artifact_hash text NOT NULL,
  key_version text,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_verification_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subject_identity_id uuid REFERENCES public.identity_subjects(id) ON DELETE SET NULL,
  participant_id uuid,
  document_id uuid,
  form_response_id uuid,
  case_file_id uuid REFERENCES public.case_files(id) ON DELETE SET NULL,
  identity_policy_id uuid NOT NULL REFERENCES public.identity_policies(id) ON DELETE RESTRICT,
  identity_policy_version_id uuid NOT NULL REFERENCES public.identity_policy_versions(id) ON DELETE RESTRICT,
  enrollment_id uuid REFERENCES public.identity_enrollments(id) ON DELETE SET NULL,
  reuse_mode text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','in_progress','approved','approved_with_warnings','manual_review','additional_information','rejected','expired','cancelled','technical_error')),
  decision text CHECK (decision IN ('automatic','manual','pending')),
  assurance_level text NOT NULL,
  risk_level text CHECK (risk_level IN ('low','medium','high','critical')),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  provider text,
  provider_session_id text,
  document_score numeric(6,3),
  face_match_score numeric(6,3),
  enrollment_match_score numeric(6,3),
  liveness_score numeric(6,3),
  device_risk_score numeric(6,3),
  manual_review_required boolean NOT NULL DEFAULT false,
  manual_review_reason text,
  report_id uuid,
  session_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'participant_identity_requirement_session_fk') THEN
    ALTER TABLE public.participant_identity_requirements
      ADD CONSTRAINT participant_identity_requirement_session_fk
      FOREIGN KEY (verification_session_id) REFERENCES public.identity_verification_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.identity_verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','passed','warning','failed','inconclusive','skipped','manual_review')),
  score numeric(6,3),
  confidence_band text,
  provider text,
  provider_check_id text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  safe_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  check_id uuid REFERENCES public.identity_verification_checks(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  reason_code text,
  correction_message text,
  device_fingerprint_hash text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, check_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public.identity_verification_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  check_id uuid REFERENCES public.identity_verification_checks(id) ON DELETE SET NULL,
  artifact_type text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  sha256_hash text NOT NULL,
  encryption_key_version text,
  retention_until timestamptz,
  download_restricted boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_reuse_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.identity_enrollments(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('full_verification','reuse','revalidate','step_up','manual_review','reject_previous')),
  rules_evaluated jsonb NOT NULL DEFAULT '[]'::jsonb,
  reasons text[] NOT NULL DEFAULT '{}',
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('privacy','biometric','geolocation','electronic_signature','video')),
  text_version text NOT NULL,
  text_hash text NOT NULL,
  accepted boolean NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_video_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  consent_id uuid REFERENCES public.identity_consents(id) ON DELETE SET NULL,
  prompt_text text NOT NULL,
  prompt_hash text NOT NULL,
  transcript text,
  video_storage_path text NOT NULL,
  video_hash text NOT NULL,
  document_hash text,
  face_match_status text,
  liveness_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_manual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','approved','rejected','additional_information','cancelled')),
  decision_reason text,
  safe_notes text,
  assigned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.identity_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  folio text NOT NULL,
  report_storage_path text NOT NULL,
  report_hash text NOT NULL,
  manifest_storage_path text,
  manifest_hash text,
  evidence_package_storage_path text,
  qr_validation_url text,
  timestamp_reference text,
  system_signature text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, folio)
);

CREATE TABLE IF NOT EXISTS public.identity_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.identity_verification_sessions(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id text,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identity_policies_workspace_status_idx ON public.identity_policies(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS identity_subjects_workspace_idx ON public.identity_subjects(workspace_id, status);
CREATE INDEX IF NOT EXISTS identity_enrollments_subject_idx ON public.identity_enrollments(subject_identity_id, status, valid_until);
CREATE INDEX IF NOT EXISTS identity_sessions_workspace_status_idx ON public.identity_verification_sessions(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_checks_session_idx ON public.identity_verification_checks(session_id, check_type);
CREATE INDEX IF NOT EXISTS identity_audit_session_idx ON public.identity_audit_events(session_id, created_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'identity_policies','identity_policy_versions','identity_policy_documents','identity_policy_checks','participant_identity_requirements',
    'identity_subjects','identity_enrollments','identity_enrollment_documents','identity_biometric_references',
    'identity_verification_sessions','identity_verification_checks','identity_verification_attempts',
    'identity_verification_artifacts','identity_reuse_decisions','identity_consents','identity_video_consents',
    'identity_manual_reviews','identity_reports','identity_audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS identity_workspace_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY identity_workspace_isolation ON public.%I FOR ALL TO authenticated USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())) WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))',
      table_name
    );
  END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('identity-evidence', 'identity-evidence', false, 52428800, ARRAY['application/pdf','application/json','image/jpeg','image/png','video/webm','video/mp4'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS identity_evidence_private_storage ON storage.objects;
CREATE POLICY identity_evidence_private_storage ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'identity-evidence' AND (storage.foldername(name))[1] IN (SELECT workspace_id::text FROM public.workspace_members WHERE user_id = auth.uid()))
WITH CHECK (bucket_id = 'identity-evidence' AND (storage.foldername(name))[1] IN (SELECT workspace_id::text FROM public.workspace_members WHERE user_id = auth.uid()));

COMMENT ON TABLE public.identity_biometric_references IS 'References to encrypted biometric material. Raw biometric payloads must never be stored in this table or application logs.';
COMMENT ON TABLE public.identity_policy_versions IS 'Published policy versions are immutable snapshots used to prove the exact rules executed for a verification.';
