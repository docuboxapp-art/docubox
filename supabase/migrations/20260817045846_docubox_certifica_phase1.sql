CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Docubox Certifica extends the existing cryptographic engine. It does not
-- replace document_certifications, timestamp_records, or public verification.
CREATE TABLE IF NOT EXISTS public.certification_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  human_folio TEXT NOT NULL UNIQUE,
  public_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'upload' CHECK (source_type IN ('upload','document','contract','expedient','batch')),
  source_document_id UUID REFERENCES public.documentos(id) ON DELETE RESTRICT,
  source_reference_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  service_key TEXT NOT NULL DEFAULT 'integrity' CHECK (service_key IN ('integrity','certified_time','nom151','evidence_pro')),
  purpose_key TEXT CHECK (purpose_key IN ('prove_integrity','prove_existence','nom151_conservation','validate_signatures','complete_evidence')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','analyzing','ready','awaiting_approval','reserved','submitted_to_psc','processing',
    'issued','validated','issued_with_warnings','provider_error','requires_review','rejected',
    'cancelled','stored','retention_due','retention_closed'
  )),
  provider_mode TEXT NOT NULL DEFAULT 'sandbox' CHECK (provider_mode IN ('sandbox','production')),
  provider_id UUID,
  existing_document_certification_id UUID REFERENCES public.document_certifications(id) ON DELETE SET NULL,
  original_sha256 CHAR(64),
  final_sha256 CHAR(64),
  original_storage_path TEXT,
  original_filename TEXT,
  original_mime_type TEXT,
  original_size_bytes BIGINT CHECK (original_size_bytes IS NULL OR original_size_bytes >= 0),
  file_classification TEXT CHECK (file_classification IN (
    'electronically_signed','scanned_with_visible_signature','unsigned','previously_certified',
    'modified_after_signature','unsupported_or_corrupt'
  )),
  malware_status TEXT NOT NULL DEFAULT 'pending' CHECK (malware_status IN ('pending','clean','infected','unavailable','failed')),
  declared_date DATE,
  certified_existence_at TIMESTAMPTZ,
  signature_dates JSONB NOT NULL DEFAULT '[]'::JSONB,
  analysis_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  selected_addons JSONB NOT NULL DEFAULT '[]'::JSONB,
  retention_years INTEGER NOT NULL DEFAULT 5 CHECK (retention_years BETWEEN 1 AND 20),
  retention_ends_at TIMESTAMPTZ,
  quoted_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (quoted_amount >= 0),
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  error_code TEXT,
  error_detail TEXT,
  submitted_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.certification_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('original','attachment','provider_evidence','generated_report','manifest','technical_package')),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  immutable_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','unavailable','failed')),
  storage_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, storage_bucket, storage_path),
  UNIQUE (certification_id, category, sha256)
);

CREATE TABLE IF NOT EXISTS public.certification_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  signature_type TEXT NOT NULL,
  subformat TEXT,
  signer_name TEXT,
  signer_identifier TEXT,
  issuer TEXT,
  serial_number TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  declared_signed_at TIMESTAMPTZ,
  timestamped_at TIMESTAMPTZ,
  validation_status TEXT NOT NULL CHECK (validation_status IN (
    'valid','valid_with_warnings','invalid','indeterminate','expired_at_validation',
    'revoked','untrusted_chain','document_modified','unsupported'
  )),
  cryptographic_integrity BOOLEAN,
  modifications_after_signing BOOLEAN,
  algorithms JSONB NOT NULL DEFAULT '{}'::JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  validation_source TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  metadata_key TEXT NOT NULL,
  metadata_value JSONB NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('extracted','user_declared','externally_verified','certified_in_manifest')),
  included_in_manifest BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (certification_id, metadata_key)
);

CREATE TABLE IF NOT EXISTS public.certification_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  accepted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  text_version TEXT NOT NULL,
  declaration_text TEXT NOT NULL,
  declaration_sha256 CHAR(64) NOT NULL CHECK (declaration_sha256 ~ '^[a-f0-9]{64}$'),
  session_id TEXT,
  ip_hash_sha256 CHAR(64),
  user_agent_hash_sha256 CHAR(64),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (certification_id)
);

CREATE TABLE IF NOT EXISTS public.psc_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('sandbox','psc')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  capabilities JSONB NOT NULL DEFAULT '[]'::JSONB,
  endpoint_reference TEXT,
  secret_reference TEXT,
  health_status TEXT NOT NULL DEFAULT 'not_configured' CHECK (health_status IN ('not_configured','healthy','degraded','unavailable')),
  last_health_check_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.certification_cases
  DROP CONSTRAINT IF EXISTS certification_cases_provider_id_fkey;
ALTER TABLE public.certification_cases
  ADD CONSTRAINT certification_cases_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.psc_providers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.certification_provider_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  provider_id UUID NOT NULL REFERENCES public.psc_providers(id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('timestamp','nom151','validate','download_evidence','health_check')),
  provider_operation_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','processing','succeeded','failed','reconciliating','reversed')),
  request_sha256 CHAR(64),
  response_sha256 CHAR(64),
  request_redacted JSONB NOT NULL DEFAULT '{}'::JSONB,
  response_redacted JSONB NOT NULL DEFAULT '{}'::JSONB,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at TIMESTAMPTZ,
  error_code TEXT,
  error_detail TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.certification_evidences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  provider_transaction_id UUID REFERENCES public.certification_provider_transactions(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('docubox_integrity','rfc3161','nom151','signature_report','visual_certificate','manifest','audit_extract','technical_package')),
  issuer_type TEXT NOT NULL CHECK (issuer_type IN ('docubox','psc','external')),
  status TEXT NOT NULL CHECK (status IN ('sandbox','pending','valid','valid_with_warnings','invalid','revoked')),
  folio TEXT,
  issued_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  file_id UUID REFERENCES public.certification_files(id) ON DELETE RESTRICT,
  sha256 CHAR(64),
  validation_result JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL UNIQUE REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL DEFAULT '1.0',
  canonical_json JSONB NOT NULL,
  canonical_sha256 CHAR(64) NOT NULL CHECK (canonical_sha256 ~ '^[a-f0-9]{64}$'),
  audit_root_hash CHAR(64),
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_custody_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL UNIQUE REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','due','closed','legal_hold')),
  retention_years INTEGER NOT NULL CHECK (retention_years BETWEEN 1 AND 20),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMPTZ NOT NULL,
  next_integrity_check_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closure_reason TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_integrity_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  expected_sha256 CHAR(64) NOT NULL,
  calculated_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('match','mismatch','unavailable')),
  checked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS public.certification_public_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  public_token_hash CHAR(64) NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  visibility TEXT NOT NULL DEFAULT 'status' CHECK (visibility IN ('status','technical_summary')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.certification_verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID REFERENCES public.certification_cases(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('public_id','folio','hash','file','evidence','package','api')),
  overall_status TEXT NOT NULL CHECK (overall_status IN ('valid','valid_with_warnings','not_matching','not_verifiable','not_found')),
  calculated_sha256 CHAR(64),
  validator_version TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  ip_hash_sha256 CHAR(64),
  user_agent_hash_sha256 CHAR(64),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  service_key TEXT NOT NULL CHECK (service_key IN ('integrity','certified_time','nom151','evidence_pro')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','analyzing','ready','processing','completed','completed_with_errors','cancelled')),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  estimated_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.certification_batches(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  certification_id UUID REFERENCES public.certification_cases(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  sha256 CHAR(64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','analyzing','ready','processing','succeeded','failed','duplicate','cancelled')),
  error_code TEXT,
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  requires_psc BOOLEAN NOT NULL DEFAULT false,
  includes JSONB NOT NULL DEFAULT '[]'::JSONB,
  base_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.certification_credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','captured','released','reconciliating')),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.certification_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  certification_id UUID REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  reservation_id UUID REFERENCES public.certification_credit_reservations(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('reserve','capture','release','adjustment')),
  amount NUMERIC(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  idempotency_key TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.certification_case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id UUID NOT NULL REFERENCES public.certification_cases(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  sequence_number BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  result TEXT NOT NULL CHECK (result IN ('success','failed','pending','denied')),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  previous_event_hash CHAR(64),
  event_hash CHAR(64) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (certification_id, sequence_number),
  UNIQUE (certification_id, event_hash)
);

CREATE TABLE IF NOT EXISTS public.certification_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  endpoint_url TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  secret_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','disabled')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_certification_cases_workspace_status ON public.certification_cases(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_cases_workspace_hash ON public.certification_cases(workspace_id, original_sha256);
CREATE INDEX IF NOT EXISTS idx_certification_cases_provider ON public.certification_cases(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_certification_files_case ON public.certification_files(certification_id, category);
CREATE INDEX IF NOT EXISTS idx_certification_files_hash ON public.certification_files(workspace_id, sha256);
CREATE INDEX IF NOT EXISTS idx_certification_signatures_case ON public.certification_signatures(certification_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_certification_provider_transactions_retry ON public.certification_provider_transactions(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_certification_evidences_case ON public.certification_evidences(certification_id, evidence_type);
CREATE INDEX IF NOT EXISTS idx_certification_verification_runs_case ON public.certification_verification_runs(certification_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_batch_items_batch ON public.certification_batch_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_certification_events_case ON public.certification_case_events(certification_id, sequence_number);

INSERT INTO public.psc_providers (provider_key, display_name, provider_type, environment, enabled, capabilities, health_status, metadata)
VALUES ('docubox-sandbox', 'Docubox Sandbox (demostracion)', 'sandbox', 'sandbox', true, '["timestamp","nom151","validate"]'::JSONB, 'healthy', '{"legal_validity":false,"watermark":"NO VALIDO / DEMOSTRACION"}'::JSONB)
ON CONFLICT (provider_key) DO UPDATE SET display_name = EXCLUDED.display_name, capabilities = EXCLUDED.capabilities, metadata = EXCLUDED.metadata;

INSERT INTO public.certification_products (product_key, display_name, description, requires_psc, includes, base_price)
VALUES
  ('integrity', 'Integridad Docubox', 'Hash, folio, manifiesto, constancia visual y QR de verificacion.', false, '["sha256","folio","manifest","docubox_seal","visual_certificate","qr"]'::JSONB, 0),
  ('certified_time', 'Tiempo Certificado', 'Integridad Docubox y sello digital de tiempo emitido por un PSC.', true, '["integrity","rfc3161","native_evidence"]'::JSONB, 89),
  ('nom151', 'NOM-151', 'Constancia de conservacion emitida por PSC, expediente probatorio y custodia estandar.', true, '["integrity","rfc3161","nom151","technical_package","custody"]'::JSONB, 149),
  ('evidence_pro', 'Evidencia Pro', 'NOM-151, analisis de firmas, manifiesto ampliado, cadena de evidencia y custodia extendida.', true, '["nom151","signature_analysis","certified_metadata","evidence_chain","extended_custody","public_verification"]'::JSONB, 249)
ON CONFLICT (product_key) DO UPDATE SET display_name = EXCLUDED.display_name, description = EXCLUDED.description, requires_psc = EXCLUDED.requires_psc, includes = EXCLUDED.includes, base_price = EXCLUDED.base_price;

INSERT INTO public.organization_permissions (permission_key, name, description, category)
VALUES
  ('certifications.view', 'Ver certificaciones', 'Consulta certificaciones y documentos conservados.', 'Certificaciones'),
  ('certifications.create', 'Crear certificaciones', 'Prepara y analiza nuevas certificaciones.', 'Certificaciones'),
  ('certifications.submit', 'Enviar a certificacion', 'Confirma operaciones con costo y envia al PSC.', 'Certificaciones'),
  ('certifications.approve', 'Aprobar certificaciones', 'Autoriza operaciones bajo doble control.', 'Certificaciones'),
  ('certifications.download_original', 'Descargar originales', 'Descarga documentos originales bajo custodia.', 'Certificaciones'),
  ('certifications.download_evidence', 'Descargar evidencia', 'Descarga evidencia PSC y expedientes tecnicos.', 'Certificaciones'),
  ('certifications.share', 'Compartir verificaciones', 'Emite enlaces publicos temporales.', 'Certificaciones'),
  ('certifications.manage_batches', 'Gestionar lotes', 'Crea y procesa certificaciones masivas.', 'Certificaciones'),
  ('certifications.manage_api', 'Gestionar API', 'Administra API y webhooks del modulo.', 'Certificaciones'),
  ('certifications.manage_providers', 'Gestionar proveedores', 'Configura proveedores PSC.', 'Certificaciones'),
  ('certifications.view_billing', 'Ver consumo', 'Consulta folios, reservas y consumo.', 'Certificaciones'),
  ('certifications.audit', 'Auditar certificaciones', 'Consulta la bitacora tecnica y probatoria.', 'Certificaciones')
ON CONFLICT (permission_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category;

INSERT INTO public.organization_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.organization_roles role
CROSS JOIN public.organization_permissions permission
WHERE role.is_system = true
  AND role.system_key IN ('owner','admin')
  AND permission.permission_key LIKE 'certifications.%'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.certification_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_certification_original()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.original_sha256 IS NOT NULL AND (
    NEW.original_sha256 IS DISTINCT FROM OLD.original_sha256 OR
    NEW.original_storage_path IS DISTINCT FROM OLD.original_storage_path OR
    NEW.original_size_bytes IS DISTINCT FROM OLD.original_size_bytes OR
    NEW.original_filename IS DISTINCT FROM OLD.original_filename
  ) THEN
    RAISE EXCEPTION 'certification_original_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_certifica_immutable_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'certification_evidence_is_immutable';
END;
$$;

DROP TRIGGER IF EXISTS certification_cases_touch_updated_at ON public.certification_cases;
CREATE TRIGGER certification_cases_touch_updated_at BEFORE UPDATE ON public.certification_cases FOR EACH ROW EXECUTE FUNCTION public.certification_touch_updated_at();
DROP TRIGGER IF EXISTS certification_cases_protect_original ON public.certification_cases;
CREATE TRIGGER certification_cases_protect_original BEFORE UPDATE ON public.certification_cases FOR EACH ROW EXECUTE FUNCTION public.protect_certification_original();
DROP TRIGGER IF EXISTS certification_files_immutable ON public.certification_files;
CREATE TRIGGER certification_files_immutable BEFORE UPDATE OR DELETE ON public.certification_files FOR EACH ROW EXECUTE FUNCTION public.reject_certifica_immutable_mutation();
DROP TRIGGER IF EXISTS certification_evidences_immutable ON public.certification_evidences;
CREATE TRIGGER certification_evidences_immutable BEFORE UPDATE OR DELETE ON public.certification_evidences FOR EACH ROW EXECUTE FUNCTION public.reject_certifica_immutable_mutation();
DROP TRIGGER IF EXISTS certification_manifests_immutable ON public.certification_manifests;
CREATE TRIGGER certification_manifests_immutable BEFORE UPDATE OR DELETE ON public.certification_manifests FOR EACH ROW EXECUTE FUNCTION public.reject_certifica_immutable_mutation();
DROP TRIGGER IF EXISTS certification_case_events_immutable ON public.certification_case_events;
CREATE TRIGGER certification_case_events_immutable BEFORE UPDATE OR DELETE ON public.certification_case_events FOR EACH ROW EXECUTE FUNCTION public.reject_certifica_immutable_mutation();

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'certification_cases','certification_files','certification_signatures','certification_metadata',
    'certification_declarations','psc_providers','certification_provider_transactions',
    'certification_evidences','certification_manifests','certification_custody_policies',
    'certification_integrity_checks','certification_public_links','certification_verification_runs',
    'certification_batches','certification_batch_items','certification_products',
    'certification_credit_reservations','certification_ledger_entries','certification_case_events',
    'certification_webhooks'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE POLICY certification_cases_select ON public.certification_cases FOR SELECT TO authenticated
USING (public.has_organization_permission(workspace_id, 'certifications.view'));
CREATE POLICY certification_cases_insert ON public.certification_cases FOR INSERT TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()) AND public.has_organization_permission(workspace_id, 'certifications.create'));
CREATE POLICY certification_cases_update ON public.certification_cases FOR UPDATE TO authenticated
USING (public.has_organization_permission(workspace_id, 'certifications.create'))
WITH CHECK (public.has_organization_permission(workspace_id, 'certifications.create'));

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'certification_files','certification_signatures','certification_metadata','certification_declarations',
    'certification_provider_transactions','certification_evidences','certification_manifests',
    'certification_custody_policies','certification_integrity_checks','certification_batches',
    'certification_batch_items','certification_credit_reservations','certification_ledger_entries',
    'certification_case_events','certification_webhooks'
  ] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, ''certifications.view''))', table_name || '_select', table_name);
  END LOOP;
END $$;

CREATE POLICY certification_products_select ON public.certification_products FOR SELECT TO authenticated USING (active = true);
CREATE POLICY certification_public_links_select ON public.certification_public_links FOR SELECT TO authenticated
USING (public.has_organization_permission(workspace_id, 'certifications.view'));
CREATE POLICY certification_verification_runs_select ON public.certification_verification_runs FOR SELECT TO authenticated
USING (workspace_id IS NOT NULL AND public.has_organization_permission(workspace_id, 'certifications.view'));

GRANT SELECT, INSERT, UPDATE ON public.certification_cases TO authenticated;
GRANT SELECT ON public.certification_files, public.certification_signatures, public.certification_metadata,
  public.certification_declarations, public.certification_provider_transactions, public.certification_evidences,
  public.certification_manifests, public.certification_custody_policies, public.certification_integrity_checks,
  public.certification_public_links, public.certification_verification_runs, public.certification_batches,
  public.certification_batch_items, public.certification_products, public.certification_credit_reservations,
  public.certification_ledger_entries, public.certification_case_events, public.certification_webhooks TO authenticated;
GRANT ALL ON public.certification_cases, public.certification_files, public.certification_signatures,
  public.certification_metadata, public.certification_declarations, public.psc_providers,
  public.certification_provider_transactions, public.certification_evidences, public.certification_manifests,
  public.certification_custody_policies, public.certification_integrity_checks, public.certification_public_links,
  public.certification_verification_runs, public.certification_batches, public.certification_batch_items,
  public.certification_products, public.certification_credit_reservations, public.certification_ledger_entries,
  public.certification_case_events, public.certification_webhooks TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('certification-originals', 'certification-originals', false, 104857600),
  ('certification-provider-evidence', 'certification-provider-evidence', false, 104857600),
  ('certification-generated-reports', 'certification-generated-reports', false, 104857600),
  ('certification-temporary-uploads', 'certification-temporary-uploads', false, 104857600)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY certifica_originals_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'certification-originals'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  AND public.has_organization_permission(((storage.foldername(name))[1])::UUID, 'certifications.download_original')
);
CREATE POLICY certifica_temporary_uploads_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'certification-temporary-uploads'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  AND public.has_organization_permission(((storage.foldername(name))[1])::UUID, 'certifications.create')
);
CREATE POLICY certifica_temporary_uploads_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'certification-temporary-uploads'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  AND public.has_organization_permission(((storage.foldername(name))[1])::UUID, 'certifications.create')
);
CREATE POLICY certifica_temporary_uploads_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'certification-temporary-uploads'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  AND public.has_organization_permission(((storage.foldername(name))[1])::UUID, 'certifications.create')
);
CREATE POLICY certifica_evidence_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('certification-provider-evidence','certification-generated-reports')
  AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  AND public.has_organization_permission(((storage.foldername(name))[1])::UUID, 'certifications.download_evidence')
);

COMMENT ON TABLE public.certification_cases IS 'Workflow and commercial container for Docubox Certifica; cryptographic outputs continue in document_certifications.';
COMMENT ON COLUMN public.certification_cases.provider_mode IS 'sandbox must remain visibly NO VALIDO / DEMOSTRACION; production requires an accredited PSC adapter.';
COMMENT ON COLUMN public.psc_providers.secret_reference IS 'Reference to a server-side secret only. Never stores PSC credentials.';

;
