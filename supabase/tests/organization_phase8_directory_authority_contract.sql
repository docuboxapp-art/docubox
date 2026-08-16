-- Organization phase 8 directory evidence and authority contract.

BEGIN;

DO $$
DECLARE
  bucket_public BOOLEAN;
BEGIN
  SELECT public INTO bucket_public
  FROM storage.buckets
  WHERE id = 'organization-evidence';

  IF bucket_public IS NULL THEN
    RAISE EXCEPTION 'Private organization evidence bucket is missing';
  END IF;
  IF bucket_public IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Organization evidence bucket must not be public';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_directory_evidence'
      AND column_name IN ('storage_bucket', 'mime_type', 'size_bytes', 'sha256_hash', 'verified_by', 'verified_at', 'revoked_by', 'revoked_at')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 8
  ) THEN
    RAISE EXCEPTION 'Directory evidence is missing private-file integrity metadata';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'validate_organization_authority_activation'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Authority fail-closed activation trigger is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE 'org_evidence_browser_%'
  ) THEN
    RAISE EXCEPTION 'A browser role has direct organization evidence object access';
  END IF;
END;
$$;

ROLLBACK;
