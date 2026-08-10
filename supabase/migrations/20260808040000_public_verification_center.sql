CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.public_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  workspace_id uuid,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  public_token_hash char(64) NOT NULL UNIQUE,
  verification_code_hash char(64) NOT NULL UNIQUE,
  visibility_level text NOT NULL DEFAULT 'status' CHECK (visibility_level IN ('status', 'document')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.document_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  workspace_id uuid,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN (
    'ORIGINAL_DOCUMENT','SIGNED_DOCUMENT','EVIDENCE_XML','NOM151_CONSTANCY',
    'NOM151_TOKEN','TIMESTAMP_TOKEN','CERTIFICATION_PDF','EVIDENCE_MANIFEST','EVIDENCE_PACKAGE'
  )),
  filename text,
  mime_type text,
  storage_path text,
  hash_algorithm text NOT NULL DEFAULT 'SHA-256' CHECK (hash_algorithm IN ('SHA-256')),
  file_hash char(64) NOT NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  encrypted boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, artifact_type, file_hash)
);

CREATE TABLE IF NOT EXISTS public.verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  public_verification_id uuid REFERENCES public.public_verifications(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documentos(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('TOKEN','FOLIO','CODE','DOCUMENT','HASH','NOM151','TIMESTAMP','XML','PACKAGE')),
  overall_status text NOT NULL,
  validator_version text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  ip_hash_sha256 char(64),
  user_agent_hash_sha256 char(64),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_run_id uuid NOT NULL REFERENCES public.verification_runs(id) ON DELETE CASCADE,
  engine text NOT NULL CHECK (engine IN ('DOCUMENT_INTEGRITY','PDF_PADES','XML_XMLDSIG','NOM151','RFC3161','EVIDENCE_CHAIN')),
  check_type text NOT NULL,
  status text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  technical_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  validator_version text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_verifications_document ON public.public_verifications(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_artifacts_hash ON public.document_artifacts(hash_algorithm, file_hash);
CREATE INDEX IF NOT EXISTS idx_document_artifacts_document ON public.document_artifacts(document_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_verification_runs_document ON public.verification_runs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verification_checks_run ON public.verification_checks(verification_run_id, checked_at);

ALTER TABLE public.public_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_verifications_owner_read ON public.public_verifications;
CREATE POLICY public_verifications_owner_read ON public.public_verifications FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.documentos d
  WHERE d.id = public_verifications.document_id AND d.owner_id = auth.uid()
));

DROP POLICY IF EXISTS document_artifacts_owner_read ON public.document_artifacts;
CREATE POLICY document_artifacts_owner_read ON public.document_artifacts FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.documentos d
  WHERE d.id = document_artifacts.document_id AND d.owner_id = auth.uid()
));

DROP POLICY IF EXISTS verification_runs_owner_read ON public.verification_runs;
CREATE POLICY verification_runs_owner_read ON public.verification_runs FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.documentos d
  WHERE d.id = verification_runs.document_id AND d.owner_id = auth.uid()
));

DROP POLICY IF EXISTS verification_checks_owner_read ON public.verification_checks;
CREATE POLICY verification_checks_owner_read ON public.verification_checks FOR SELECT
USING (EXISTS (
  SELECT 1
  FROM public.verification_runs vr
  JOIN public.documentos d ON d.id = vr.document_id
  WHERE vr.id = verification_checks.verification_run_id AND d.owner_id = auth.uid()
));

CREATE OR REPLACE FUNCTION public.issue_public_verification(
  p_document_id uuid,
  p_visibility_level text DEFAULT 'status'
)
RETURNS TABLE(public_token text, verification_code text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token text;
  v_code text;
  v_owner uuid;
  v_workspace uuid;
BEGIN
  SELECT owner_id, workspace_id INTO v_owner, v_workspace
  FROM public.documentos
  WHERE id = p_document_id AND estado = 'completado';

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Documento no disponible para publicacion';
  END IF;
  IF p_visibility_level NOT IN ('status', 'document') THEN
    RAISE EXCEPTION 'Nivel de visibilidad invalido';
  END IF;

  UPDATE public.public_verifications
  SET status = 'revoked', revoked_at = now()
  WHERE document_id = p_document_id AND status = 'active';

  v_token := rtrim(translate(encode(gen_random_bytes(18), 'base64'), '+/', '-_'), '=');
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 4) || '-' || substr(encode(gen_random_bytes(8), 'hex'), 1, 4) || '-' || substr(encode(gen_random_bytes(8), 'hex'), 1, 4));

  INSERT INTO public.public_verifications (
    workspace_id, document_id, public_token_hash, verification_code_hash,
    visibility_level, created_by
  ) VALUES (
    v_workspace, p_document_id, encode(digest(v_token, 'sha256'), 'hex'),
    encode(digest(v_code, 'sha256'), 'hex'), p_visibility_level, auth.uid()
  );

  RETURN QUERY SELECT v_token, v_code, NULL::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_public_verification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_public_verification(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.index_document_verification_artifacts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.estado <> 'completado' THEN RETURN NEW; END IF;

  IF NEW.file_hash_sha256 ~* '^[a-f0-9]{64}$' THEN
    INSERT INTO public.document_artifacts (workspace_id, document_id, artifact_type, filename, mime_type, storage_path, file_hash, size_bytes)
    VALUES (NEW.workspace_id, NEW.id, 'ORIGINAL_DOCUMENT', NEW.file_name, NEW.file_type, NEW.file_url, lower(NEW.file_hash_sha256), NEW.file_size)
    ON CONFLICT (document_id, artifact_type, file_hash) DO NOTHING;
  END IF;
  IF NEW.sealed_pdf_hash ~* '^[a-f0-9]{64}$' THEN
    INSERT INTO public.document_artifacts (workspace_id, document_id, artifact_type, filename, mime_type, storage_path, file_hash, size_bytes)
    VALUES (NEW.workspace_id, NEW.id, 'SIGNED_DOCUMENT', NEW.file_name, 'application/pdf', NEW.sealed_pdf_path, lower(NEW.sealed_pdf_hash), NEW.file_size)
    ON CONFLICT (document_id, artifact_type, file_hash) DO NOTHING;
  END IF;
  IF NEW.xml_hash_sha256 ~* '^[a-f0-9]{64}$' THEN
    INSERT INTO public.document_artifacts (workspace_id, document_id, artifact_type, filename, mime_type, storage_path, file_hash)
    VALUES (NEW.workspace_id, NEW.id, 'EVIDENCE_XML', NEW.nombre || '-evidencia.xml', 'application/xml', NEW.xml_evidencia_path, lower(NEW.xml_hash_sha256))
    ON CONFLICT (document_id, artifact_type, file_hash) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS index_document_verification_artifacts ON public.documentos;
CREATE TRIGGER index_document_verification_artifacts
AFTER INSERT OR UPDATE OF estado, file_hash_sha256, sealed_pdf_hash, xml_hash_sha256 ON public.documentos
FOR EACH ROW EXECUTE FUNCTION public.index_document_verification_artifacts();

INSERT INTO public.document_artifacts (workspace_id, document_id, artifact_type, filename, mime_type, storage_path, file_hash, size_bytes)
SELECT workspace_id, id, 'ORIGINAL_DOCUMENT', file_name, file_type, file_url, lower(file_hash_sha256), file_size
FROM public.documentos
WHERE estado = 'completado' AND file_hash_sha256 ~* '^[a-f0-9]{64}$'
ON CONFLICT (document_id, artifact_type, file_hash) DO NOTHING;

INSERT INTO public.document_artifacts (workspace_id, document_id, artifact_type, filename, mime_type, storage_path, file_hash, size_bytes)
SELECT workspace_id, id, 'SIGNED_DOCUMENT', file_name, 'application/pdf', sealed_pdf_path, lower(sealed_pdf_hash), file_size
FROM public.documentos
WHERE estado = 'completado' AND sealed_pdf_hash ~* '^[a-f0-9]{64}$'
ON CONFLICT (document_id, artifact_type, file_hash) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reject_verification_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros de verificacion son inmutables';
END;
$$;

DROP TRIGGER IF EXISTS immutable_verification_runs ON public.verification_runs;
CREATE TRIGGER immutable_verification_runs BEFORE UPDATE OR DELETE ON public.verification_runs
FOR EACH ROW EXECUTE FUNCTION public.reject_verification_log_mutation();

DROP TRIGGER IF EXISTS immutable_verification_checks ON public.verification_checks;
CREATE TRIGGER immutable_verification_checks BEFORE UPDATE OR DELETE ON public.verification_checks
FOR EACH ROW EXECUTE FUNCTION public.reject_verification_log_mutation();

