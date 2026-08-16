-- Organization directory and authority hardening.
-- Keeps evidence private and makes authority activation fail closed.

ALTER TABLE public.organization_directory_evidence
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'organization-evidence',
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS sha256_hash TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE public.organization_authorities
  ADD COLUMN IF NOT EXISTS evidence_id UUID REFERENCES public.organization_directory_evidence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE public.organization_directory_evidence
  DROP CONSTRAINT IF EXISTS organization_directory_evidence_sha256_check;
ALTER TABLE public.organization_directory_evidence
  ADD CONSTRAINT organization_directory_evidence_sha256_check
  CHECK (sha256_hash IS NULL OR sha256_hash ~ '^[a-f0-9]{64}$');

CREATE INDEX IF NOT EXISTS idx_org_directory_evidence_hash
  ON public.organization_directory_evidence(workspace_id, sha256_hash)
  WHERE sha256_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_authorities_evidence
  ON public.organization_authorities(workspace_id, evidence_id, status);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-evidence',
  'organization-evidence',
  FALSE,
  15728640,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.validate_organization_authority_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  person_record RECORD;
  evidence_record RECORD;
BEGIN
  SELECT workspace_id, identity_status, status
    INTO person_record
  FROM public.organization_directory_people
  WHERE id = NEW.person_id;

  IF person_record.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'organization_authority_person_workspace_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.evidence_id IS NOT NULL THEN
    SELECT workspace_id, person_id, status, valid_until
      INTO evidence_record
    FROM public.organization_directory_evidence
    WHERE id = NEW.evidence_id;
    IF evidence_record.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR evidence_record.person_id IS DISTINCT FROM NEW.person_id THEN
      RAISE EXCEPTION 'organization_authority_evidence_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'active' THEN
    IF person_record.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'organization_authority_person_inactive' USING ERRCODE = '23514';
    END IF;
    IF NEW.identity_required AND person_record.identity_status NOT IN ('verified', 'identity_verified') THEN
      RAISE EXCEPTION 'organization_authority_identity_not_verified' USING ERRCODE = '23514';
    END IF;
    IF NEW.evidence_id IS NULL OR evidence_record.status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'organization_authority_verified_evidence_required' USING ERRCODE = '23514';
    END IF;
    IF evidence_record.valid_until IS NOT NULL AND evidence_record.valid_until < CURRENT_DATE THEN
      RAISE EXCEPTION 'organization_authority_evidence_expired' USING ERRCODE = '23514';
    END IF;
    IF NEW.valid_until IS NOT NULL AND NEW.valid_until < CURRENT_DATE THEN
      RAISE EXCEPTION 'organization_authority_expired' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'revoked' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'revoked') THEN
    NEW.revoked_at := COALESCE(NEW.revoked_at, CURRENT_TIMESTAMP);
  ELSIF NEW.status <> 'revoked' THEN
    NEW.revoked_at := NULL;
    NEW.revoked_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_organization_authority_activation ON public.organization_authorities;
CREATE TRIGGER validate_organization_authority_activation
  BEFORE INSERT OR UPDATE ON public.organization_authorities
  FOR EACH ROW EXECUTE FUNCTION public.validate_organization_authority_activation();

REVOKE ALL ON FUNCTION public.validate_organization_authority_activation() FROM PUBLIC;

-- Browser roles do not receive direct object access. Files are served through
-- short-lived signed URLs after the API verifies tenant and permission scope.
DROP POLICY IF EXISTS "org_evidence_browser_select" ON storage.objects;
DROP POLICY IF EXISTS "org_evidence_browser_insert" ON storage.objects;
DROP POLICY IF EXISTS "org_evidence_browser_update" ON storage.objects;
DROP POLICY IF EXISTS "org_evidence_browser_delete" ON storage.objects;

