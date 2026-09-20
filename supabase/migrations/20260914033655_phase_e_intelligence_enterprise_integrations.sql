-- Phase E: additive foundations for contractual intelligence, enterprise SSO,
-- governed public API access and server-side bulk campaign inputs.

ALTER TABLE public.ai_document_processing_jobs
  ADD COLUMN IF NOT EXISTS run_key TEXT,
  ADD COLUMN IF NOT EXISTS configuration_hash TEXT,
  ADD COLUMN IF NOT EXISTS requested_by_event_id UUID REFERENCES public.document_operational_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.ai_document_processing_jobs
  DROP CONSTRAINT IF EXISTS ai_document_processing_jobs_job_type_check;
ALTER TABLE public.ai_document_processing_jobs
  ADD CONSTRAINT ai_document_processing_jobs_job_type_check CHECK (job_type IN (
    'extract_text','chunk_document','embed_document','classify_document','extract_fields',
    'build_profile','detect_obligations','completeness_check','compare_versions',
    'contractual_analysis'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_document_processing_run_key
  ON public.ai_document_processing_jobs(workspace_id, run_key)
  WHERE run_key IS NOT NULL;

ALTER TABLE public.ai_document_extracted_fields
  ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES public.ai_document_processing_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.ai_document_obligations
  ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES public.ai_document_processing_jobs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.ai_document_fact_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE CASCADE,
  analysis_run_id UUID REFERENCES public.ai_document_processing_jobs(id) ON DELETE SET NULL,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('field','obligation','risk','classification')),
  fact_id UUID NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('reviewed','confirmed','rejected','corrected')),
  extracted_value JSONB NOT NULL,
  reviewed_value JSONB,
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 2000),
  reviewed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_document_fact_reviews_document
  ON public.ai_document_fact_reviews(workspace_id, document_id, document_version_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_document_fact_reviews_fact
  ON public.ai_document_fact_reviews(fact_type, fact_id, reviewed_at DESC);

ALTER TABLE public.ai_document_fact_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_document_fact_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_document_fact_reviews_authorized_read ON public.ai_document_fact_reviews;
CREATE POLICY ai_document_fact_reviews_authorized_read
  ON public.ai_document_fact_reviews FOR SELECT TO authenticated
  USING (public.can_read_document_intelligence(workspace_id, document_id));
REVOKE ALL ON TABLE public.ai_document_fact_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ai_document_fact_reviews TO authenticated;
GRANT ALL ON TABLE public.ai_document_fact_reviews TO service_role;

ALTER TABLE public.bulk_signature_campaigns
  ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES public.documentos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS validation_summary JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE public.bulk_campaign_items
  ADD COLUMN IF NOT EXISTS source_row_hash TEXT,
  ADD COLUMN IF NOT EXISTS participant_name TEXT,
  ADD COLUMN IF NOT EXISTS participant_email TEXT,
  ADD COLUMN IF NOT EXISTS participant_phone TEXT,
  ADD COLUMN IF NOT EXISTS validation_errors JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bulk_campaign_source_row_hash
  ON public.bulk_campaign_items(campaign_id, source_row_hash)
  WHERE source_row_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_bulk_campaign_with_recipients(
  p_workspace_id UUID,
  p_creator_id UUID,
  p_idempotency_key TEXT,
  p_campaign JSONB,
  p_recipients JSONB
)
RETURNS public.bulk_signature_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created_campaign public.bulk_signature_campaigns;
  recipient_count INTEGER;
  desired_status TEXT;
BEGIN
  IF jsonb_typeof(p_campaign) <> 'object' OR jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'bulk_campaign_payload_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = p_workspace_id
      AND member.user_id = p_creator_id
      AND COALESCE(member.status::TEXT, 'active') = 'active'
  ) THEN
    RAISE EXCEPTION 'bulk_campaign_workspace_access_denied' USING ERRCODE = '42501';
  END IF;
  recipient_count := jsonb_array_length(p_recipients);
  IF recipient_count < 1 OR recipient_count > 10000 THEN
    RAISE EXCEPTION 'bulk_campaign_recipient_count_invalid' USING ERRCODE = '22023';
  END IF;
  desired_status := CASE
    WHEN NULLIF(p_campaign ->> 'scheduled_at', '') IS NOT NULL THEN 'scheduled'
    WHEN COALESCE((p_campaign ->> 'launch')::BOOLEAN, FALSE) THEN 'ready'
    ELSE 'draft'
  END;

  INSERT INTO public.bulk_signature_campaigns (
    workspace_id, name, description, campaign_type, source_type, status,
    owner_user_id, template_id, source_document_id, priority, internal_reference,
    timezone, expires_at, scheduled_at, signature_policy, identity_policy,
    notification_policy, source_configuration, validation_summary, total_items,
    pending_items, participant_count, idempotency_key, created_by, updated_by
  ) VALUES (
    p_workspace_id,
    trim(p_campaign ->> 'name'),
    NULLIF(trim(p_campaign ->> 'description'), ''),
    p_campaign ->> 'campaign_type',
    COALESCE(NULLIF(p_campaign ->> 'source_type', ''), p_campaign ->> 'campaign_type'),
    desired_status,
    p_creator_id,
    NULLIF(p_campaign ->> 'template_id', '')::UUID,
    NULLIF(p_campaign ->> 'source_document_id', '')::UUID,
    COALESCE(NULLIF(p_campaign ->> 'priority', ''), 'normal'),
    NULLIF(trim(p_campaign ->> 'internal_reference'), ''),
    COALESCE(NULLIF(p_campaign ->> 'timezone', ''), 'UTC'),
    NULLIF(p_campaign ->> 'expires_at', '')::TIMESTAMPTZ,
    NULLIF(p_campaign ->> 'scheduled_at', '')::TIMESTAMPTZ,
    COALESCE(p_campaign -> 'signature_policy', '{}'::JSONB),
    COALESCE(p_campaign -> 'identity_policy', '{}'::JSONB),
    COALESCE(p_campaign -> 'notification_policy', '{}'::JSONB),
    COALESCE(p_campaign -> 'source_configuration', '{}'::JSONB),
    jsonb_build_object('total', recipient_count, 'valid', recipient_count, 'invalid', 0),
    recipient_count, recipient_count, recipient_count, p_idempotency_key,
    p_creator_id, p_creator_id
  )
  RETURNING * INTO created_campaign;

  INSERT INTO public.bulk_campaign_items (
    workspace_id, campaign_id, source_row_id, source_row_hash, source_payload,
    participant_name, participant_email, participant_phone, status, progress
  )
  SELECT
    p_workspace_id,
    created_campaign.id,
    row ->> 'source_row_id',
    row ->> 'source_row_hash',
    COALESCE(row -> 'payload', '{}'::JSONB),
    row ->> 'name',
    lower(row ->> 'email'),
    NULLIF(row ->> 'phone', ''),
    'ready',
    10
  FROM jsonb_array_elements(p_recipients) AS row;

  INSERT INTO public.bulk_campaign_imports (
    workspace_id, campaign_id, file_name, mime_type, status, validation_summary,
    total_rows, valid_rows, invalid_rows, created_by
  ) VALUES (
    p_workspace_id,
    created_campaign.id,
    COALESCE(NULLIF(p_campaign ->> 'source_name', ''), 'lista'),
    'text/csv',
    'valid',
    jsonb_build_object('total', recipient_count, 'valid', recipient_count, 'invalid', 0),
    recipient_count,
    recipient_count,
    0,
    p_creator_id
  );

  RETURN created_campaign;
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO created_campaign
    FROM public.bulk_signature_campaigns
    WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;
    IF created_campaign.id IS NULL THEN RAISE; END IF;
    RETURN created_campaign;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bulk_campaign_with_recipients(UUID, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bulk_campaign_with_recipients(UUID, UUID, TEXT, JSONB, JSONB)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.organization_sso_test_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.organization_integrations(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expected_provider_id TEXT NOT NULL,
  expected_domain TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  result TEXT CHECK (result IS NULL OR result IN ('succeeded','failed','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organization_sso_tests_workspace
  ON public.organization_sso_test_sessions(workspace_id, created_at DESC);
ALTER TABLE public.organization_sso_test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_sso_test_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_sso_test_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.organization_sso_test_sessions TO service_role;

CREATE TABLE IF NOT EXISTS public.public_api_idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.organization_api_credentials(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  response_status INTEGER,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (credential_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_public_api_idempotency_expiry
  ON public.public_api_idempotency_records(expires_at);
ALTER TABLE public.public_api_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_api_idempotency_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_api_idempotency_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.public_api_idempotency_records TO service_role;

CREATE OR REPLACE FUNCTION public.touch_phase_e_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_phase_e_updated_at() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_public_api_idempotency_updated_at ON public.public_api_idempotency_records;
CREATE TRIGGER trg_public_api_idempotency_updated_at
  BEFORE UPDATE ON public.public_api_idempotency_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_phase_e_updated_at();

INSERT INTO public.platform_feature_flags (
  flag_key,
  name,
  description,
  global_enabled,
  rollout_percentage,
  allowed_plans
)
VALUES
  ('lucia_contractual', 'LucIA contractual', 'Inteligencia contractual derivada para documentos completados.', FALSE, 0, '{}'),
  ('bulk_signature_runtime', 'Firmas masivas', 'Ejecucion server-side de campanas de firma masiva.', FALSE, 0, '{}'),
  ('organization_sso', 'SSO organizacional', 'Configuracion de acceso empresarial mediante el proveedor de identidad existente.', FALSE, 0, '{}'),
  ('public_api_v1', 'API publica v1', 'Acceso programatico versionado y limitado por scopes.', FALSE, 0, '{}'),
  ('workflow_builder', 'Workflow Builder', 'Definiciones visuales sobre el runtime organizacional canonico.', FALSE, 0, '{}')
ON CONFLICT (flag_key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = CURRENT_TIMESTAMP;

COMMENT ON TABLE public.ai_document_fact_reviews IS
  'Append-only human review history for LucIA-derived facts; never mutates the source document.';
COMMENT ON TABLE public.organization_sso_test_sessions IS
  'Single-use, short-lived SSO verification state. The bearer token is stored only as a hash.';
COMMENT ON TABLE public.public_api_idempotency_records IS
  'Credential-scoped idempotency ledger for the versioned public API.';
