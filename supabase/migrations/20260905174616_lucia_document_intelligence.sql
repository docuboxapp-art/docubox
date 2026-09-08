-- LucIA Document Intelligence: version-aware, evidence-backed read models.
-- Operational document writes remain outside this migration.

ALTER TABLE public.ai_document_chunks
  ADD COLUMN IF NOT EXISTS document_version_id UUID NULL,
  ADD COLUMN IF NOT EXISTS document_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS content_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS extraction_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_document_chunks_document_version_id_fkey'
  ) THEN
    ALTER TABLE public.ai_document_chunks
      ADD CONSTRAINT ai_document_chunks_document_version_id_fkey
      FOREIGN KEY (document_version_id) REFERENCES public.document_versions(id) ON DELETE CASCADE;
  END IF;
END;
$$;

ALTER TABLE public.ai_document_chunks
  DROP CONSTRAINT IF EXISTS ai_document_chunks_document_hash_format,
  ADD CONSTRAINT ai_document_chunks_document_hash_format
    CHECK (document_hash IS NULL OR document_hash ~ '^[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS ai_document_chunks_content_hash_format,
  ADD CONSTRAINT ai_document_chunks_content_hash_format
    CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_version
  ON public.ai_document_chunks(workspace_id, document_id, document_version_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_hash
  ON public.ai_document_chunks(document_id, document_hash);

CREATE TABLE IF NOT EXISTS public.ai_document_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  document_hash TEXT NULL CHECK (document_hash IS NULL OR document_hash ~ '^[0-9a-f]{64}$'),
  detected_document_type TEXT NULL,
  detected_document_category TEXT NULL,
  title_suggestion TEXT NULL,
  short_summary TEXT NULL,
  executive_summary TEXT NULL,
  language TEXT NULL,
  confidence NUMERIC(5,4) NULL CHECK (confidence BETWEEN 0 AND 1),
  quality_score NUMERIC(5,2) NULL CHECK (quality_score BETWEEN 0 AND 100),
  risk_score NUMERIC(5,2) NULL CHECK (risk_score BETWEEN 0 AND 100),
  completeness_score NUMERIC(5,2) NULL CHECK (completeness_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','ready','partial','failed','stale')),
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','processing','ready','partial','failed','not_indexed')),
  source_chunk_ids UUID[] NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(evidence) = 'array'),
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(warnings) = 'array'),
  created_by UUID NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_document_profiles_document_version
  ON public.ai_document_profiles(document_id, COALESCE(document_version_id, '00000000-0000-0000-0000-000000000000'::UUID));
CREATE INDEX IF NOT EXISTS idx_ai_document_profiles_workspace_status
  ON public.ai_document_profiles(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_document_extracted_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL CHECK (length(field_key) BETWEEN 1 AND 120),
  field_label TEXT NULL,
  field_value TEXT NULL,
  normalized_value TEXT NULL,
  value_type TEXT NULL CHECK (value_type IS NULL OR value_type IN
    ('text','date','money','number','person','company','rfc','curp','email','phone','address','boolean')),
  confidence NUMERIC(5,4) NULL CHECK (confidence BETWEEN 0 AND 1),
  page_number INTEGER NULL CHECK (page_number IS NULL OR page_number > 0),
  chunk_id UUID NULL REFERENCES public.ai_document_chunks(id) ON DELETE SET NULL,
  evidence_text TEXT NULL,
  extraction_method TEXT NULL,
  status TEXT NOT NULL DEFAULT 'extracted'
    CHECK (status IN ('extracted','verified','rejected','superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_document_fields_document
  ON public.ai_document_extracted_fields(workspace_id, document_id, document_version_id, field_key);

CREATE TABLE IF NOT EXISTS public.ai_document_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  normalized_value TEXT NULL,
  confidence NUMERIC(5,4) NULL CHECK (confidence BETWEEN 0 AND 1),
  page_number INTEGER NULL CHECK (page_number IS NULL OR page_number > 0),
  chunk_id UUID NULL REFERENCES public.ai_document_chunks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_document_entities_document
  ON public.ai_document_entities(workspace_id, document_id, document_version_id, entity_type);

CREATE TABLE IF NOT EXISTS public.ai_document_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  obligation_type TEXT NULL CHECK (obligation_type IS NULL OR obligation_type IN
    ('payment','delivery','signature','notice','renewal','confidentiality','compliance','documentary','other')),
  obligated_party TEXT NULL,
  beneficiary_party TEXT NULL,
  description TEXT NOT NULL,
  due_date DATE NULL,
  recurrence_rule TEXT NULL,
  priority TEXT NULL CHECK (priority IS NULL OR priority IN ('low','medium','high','critical')),
  confidence NUMERIC(5,4) NULL CHECK (confidence BETWEEN 0 AND 1),
  page_number INTEGER NULL CHECK (page_number IS NULL OR page_number > 0),
  chunk_id UUID NULL REFERENCES public.ai_document_chunks(id) ON DELETE SET NULL,
  evidence_text TEXT NULL,
  suggested_task JSONB NULL CHECK (suggested_task IS NULL OR jsonb_typeof(suggested_task) = 'object'),
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected','verified','dismissed','superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_document_obligations_document
  ON public.ai_document_obligations(workspace_id, document_id, document_version_id, due_date);

CREATE TABLE IF NOT EXISTS public.ai_document_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  classification_type TEXT NOT NULL CHECK (classification_type IN
    ('document_type','category','folder_suggestion','tag_suggestion','sensitivity','retention_category','signature_flow_suggestion','compliance_category')),
  classification_value TEXT NOT NULL,
  confidence NUMERIC(5,4) NULL CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(evidence) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_document_classifications_document
  ON public.ai_document_classifications(workspace_id, document_id, document_version_id, classification_type);

CREATE TABLE IF NOT EXISTS public.ai_document_completeness_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL CHECK (length(check_key) BETWEEN 1 AND 120),
  check_label TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','warning','failed','not_applicable')),
  severity TEXT NULL CHECK (severity IS NULL OR severity IN ('low','medium','high','critical')),
  description TEXT NULL,
  recommendation TEXT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(evidence) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_document_completeness_document
  ON public.ai_document_completeness_checks(workspace_id, document_id, document_version_id, status);

CREATE TABLE IF NOT EXISTS public.ai_document_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NULL REFERENCES public.document_versions(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN
    ('extract_text','chunk_document','embed_document','classify_document','extract_fields','build_profile','detect_obligations','completeness_check','compare_versions')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 10),
  created_by UUID NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_document_jobs_queue
  ON public.ai_document_processing_jobs(status, created_at)
  WHERE status IN ('queued','processing');
CREATE INDEX IF NOT EXISTS idx_ai_document_jobs_document
  ON public.ai_document_processing_jobs(workspace_id, document_id, document_version_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_ai_document_profile_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_document_profile_updated_at ON public.ai_document_profiles;
CREATE TRIGGER trg_ai_document_profile_updated_at
  BEFORE UPDATE ON public.ai_document_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_document_profile_updated_at();

CREATE OR REPLACE FUNCTION public.can_read_document_intelligence(
  p_workspace_id UUID,
  p_document_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.user_id = auth.uid()
        AND wm.status = 'active'
        AND (wm.access_expires_at IS NULL OR wm.access_expires_at > CURRENT_TIMESTAMP)
    )
    AND public.can_access_documento(p_document_id);
$$;

REVOKE ALL ON FUNCTION public.can_read_document_intelligence(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_document_intelligence(UUID, UUID) TO authenticated;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ai_document_profiles',
    'ai_document_extracted_fields',
    'ai_document_entities',
    'ai_document_obligations',
    'ai_document_classifications',
    'ai_document_completeness_checks',
    'ai_document_processing_jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authorized_read', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_read_document_intelligence(workspace_id, document_id))',
      v_table || '_authorized_read',
      v_table
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_ai_document_profile_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_ai_document_profile_updated_at() TO service_role;

COMMENT ON TABLE public.ai_document_profiles IS
  'Ficha orientativa de inteligencia documental; no constituye dictamen legal o fiscal.';
COMMENT ON COLUMN public.ai_document_obligations.suggested_task IS
  'Propuesta informativa. Nunca crea ni modifica tareas operativas.';
