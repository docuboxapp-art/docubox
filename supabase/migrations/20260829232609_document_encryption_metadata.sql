-- The legacy diagnostics view depends on columns that do not exist in the
-- versioned metadata model. Remove that dependent legacy object explicitly
-- before replacing its table; never use CASCADE for this migration. Its exact
-- definition is preserved in the pre-encryption snapshot and restored by the
-- scoped rollback script.
DROP VIEW IF EXISTS public.v_documents_missing_participant_deks;

-- A legacy, pre-versioned table with this name may exist from an earlier
-- experiment. It is incompatible with the application provider because it
-- exposes wrapped-key data to authenticated clients and has no version/AAD
-- binding. Replace it only while it is empty; otherwise fail closed so no key
-- metadata can be discarded silently.
DO $$
BEGIN
  IF to_regclass('public.document_encryption_metadata') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'document_encryption_metadata'
         AND column_name = 'document_version_id'
     )
  THEN
    IF EXISTS (SELECT 1 FROM public.document_encryption_metadata LIMIT 1) THEN
      RAISE EXCEPTION 'legacy_document_encryption_metadata_not_empty'
        USING ERRCODE = '55000';
    END IF;
    DROP TABLE public.document_encryption_metadata;
  END IF;
END;
$$;

-- The legacy participant-DEK experiment is empty in production, but its trigger
-- would keep calling a function that updates columns removed by this schema.
-- Disable only that obsolete synchronization path and close public execution on
-- the related SECURITY DEFINER helpers. The functions remain available to
-- privileged operators for forensic compatibility.
DO $$
BEGIN
  IF to_regclass('public.document_participant_deks') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_sync_dek_counts ON public.document_participant_deks';
  END IF;

  IF to_regprocedure('public.generate_participant_dek_wrap(uuid,uuid,text,uuid,text,text,text,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.generate_participant_dek_wrap(uuid,uuid,text,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regprocedure('public.sync_encryption_metadata_dek_counts()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.sync_encryption_metadata_dek_counts() FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regprocedure('public.is_workspace_member_for_encryption(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.is_workspace_member_for_encryption(uuid) FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regprocedure('public.kms_rewrap_deks_batch()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.kms_rewrap_deks_batch() FROM PUBLIC, anon, authenticated';
  END IF;

  IF to_regprocedure('public.notify_new_participant_dek_needed()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.notify_new_participant_dek_needed() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.document_encryption_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  artifact_kind text NOT NULL DEFAULT 'document'
    CHECK (artifact_kind IN ('document','visual_pdf','signed_pdf','certified_pdf','constancia','evidence','preview','attachment')),
  storage_bucket text NOT NULL CHECK (length(storage_bucket) BETWEEN 1 AND 100),
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 1 AND 1500),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','migrating','superseded','failed')),
  encryption_version integer NOT NULL CHECK (encryption_version > 0),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm = 'AES-256-GCM'),
  wrapped_dek text NOT NULL CHECK (length(wrapped_dek) > 0),
  kms_provider text NOT NULL CHECK (length(kms_provider) BETWEEN 1 AND 80),
  kms_key_id text NOT NULL CHECK (length(kms_key_id) BETWEEN 1 AND 1200),
  kms_key_version text NOT NULL CHECK (length(kms_key_version) BETWEEN 1 AND 200),
  nonce text NOT NULL CHECK (length(nonce) > 0),
  auth_tag text NOT NULL CHECK (length(auth_tag) > 0),
  aad_sha256 text NOT NULL CHECK (aad_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext_size bigint NOT NULL CHECK (ciphertext_size >= 0),
  plaintext_size bigint NOT NULL CHECK (plaintext_size >= 0),
  plaintext_sha256 text NOT NULL CHECK (plaintext_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext_sha256 text NOT NULL CHECK (ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  original_file_name text,
  original_mime_type text NOT NULL DEFAULT 'application/octet-stream',
  encrypted_at timestamptz NOT NULL DEFAULT now(),
  rewrapped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_path),
  UNIQUE (document_version_id, artifact_kind, storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS document_encryption_document_version_idx
  ON public.document_encryption_metadata(tenant_id, document_id, document_version_id);
CREATE INDEX IF NOT EXISTS document_encryption_active_path_idx
  ON public.document_encryption_metadata(storage_bucket, storage_path)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.touch_document_encryption_metadata_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_document_encryption_metadata_updated_at
  ON public.document_encryption_metadata;
CREATE TRIGGER touch_document_encryption_metadata_updated_at
  BEFORE UPDATE ON public.document_encryption_metadata
  FOR EACH ROW EXECUTE FUNCTION public.touch_document_encryption_metadata_updated_at();

CREATE TABLE IF NOT EXISTS public.document_encryption_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documentos(id) ON DELETE SET NULL,
  document_version_id uuid REFERENCES public.document_versions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'DOCUMENT_ENCRYPTED','DOCUMENT_DECRYPTED','DOCUMENT_VIEWED','DOCUMENT_DOWNLOADED',
    'DOCUMENT_ENCRYPTION_FAILED','DOCUMENT_DECRYPTION_FAILED','DOCUMENT_INTEGRITY_FAILURE',
    'DOCUMENT_KEY_UNWRAP_FAILED','DOCUMENT_KEY_ROTATED','LEGACY_PLAINTEXT_ACCESS'
  )),
  result text NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  reason text,
  source text NOT NULL DEFAULT 'backend',
  request_id text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_encryption_events_document_idx
  ON public.document_encryption_security_events(tenant_id, document_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.reject_document_encryption_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'document_encryption_security_events_are_immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS immutable_document_encryption_security_events
  ON public.document_encryption_security_events;
CREATE TRIGGER immutable_document_encryption_security_events
  BEFORE UPDATE OR DELETE ON public.document_encryption_security_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_document_encryption_security_event_mutation();

ALTER TABLE public.document_encryption_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_encryption_security_events ENABLE ROW LEVEL SECURITY;

-- Wrapped DEKs and operational crypto events are backend-only. No authenticated
-- or anonymous policy is intentionally created.
REVOKE ALL ON public.document_encryption_metadata FROM anon, authenticated;
REVOKE ALL ON public.document_encryption_security_events FROM anon, authenticated;
GRANT ALL ON public.document_encryption_metadata TO service_role;
GRANT SELECT, INSERT ON public.document_encryption_security_events TO service_role;

COMMENT ON TABLE public.document_encryption_metadata IS
  'Backend-only envelope encryption metadata. wrapped_dek is ciphertext produced by KMS; plaintext DEKs are never persisted.';
COMMENT ON COLUMN public.document_encryption_metadata.plaintext_sha256 IS
  'Logical document SHA-256. It is independent from ciphertext_sha256 and remains the hash used by legal workflows.';
COMMENT ON COLUMN public.document_encryption_metadata.aad_sha256 IS
  'SHA-256 of deterministic AAD. The AAD bytes are reconstructed from tenant/document/version/artifact/version fields.';

-- Frozen versions remain immutable at the logical layer. A narrowly scoped
-- storage-reference switch is allowed only after a matching active encrypted
-- object has been persisted for this exact version and plaintext hash.
CREATE OR REPLACE FUNCTION public.prevent_frozen_document_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL OR OLD.status IN ('sent','signed') THEN
    IF
      NEW.storage_path IS DISTINCT FROM OLD.storage_path
      AND NEW.id = OLD.id
      AND NEW.version_number = OLD.version_number
      AND NEW.document_id = OLD.document_id
      AND NEW.workspace_id = OLD.workspace_id
      AND NEW.sha256 = OLD.sha256
      AND NEW.status = OLD.status
      AND NEW.mime_type = OLD.mime_type
      AND NEW.byte_size IS NOT DISTINCT FROM OLD.byte_size
      AND NEW.frozen_at IS NOT DISTINCT FROM OLD.frozen_at
      AND NEW.signed_at IS NOT DISTINCT FROM OLD.signed_at
      AND EXISTS (
        SELECT 1
        FROM public.document_encryption_metadata metadata
        WHERE metadata.document_version_id = OLD.id
          AND metadata.tenant_id = OLD.workspace_id
          AND metadata.document_id = OLD.document_id
          AND metadata.storage_bucket = 'documents'
          AND metadata.storage_path = NEW.storage_path
          AND metadata.plaintext_sha256 = OLD.sha256
          AND metadata.status = 'active'
      )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'frozen_document_version' USING ERRCODE = '55000';
  END IF;
  NEW.version_number := OLD.version_number;
  NEW.document_id := OLD.document_id;
  NEW.workspace_id := OLD.workspace_id;
  RETURN NEW;
END;
$$;
