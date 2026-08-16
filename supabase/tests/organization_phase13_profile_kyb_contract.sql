-- Organization phase 13 profile and KYB contract.

BEGIN;
DO $$
BEGIN
  IF to_regclass('public.organization_kyb_evidence') IS NULL
    OR to_regclass('public.organization_verification_history') IS NULL THEN
    RAISE EXCEPTION 'Organization KYB tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_permissions WHERE permission_key = 'kyb.read')
    OR NOT EXISTS (SELECT 1 FROM public.organization_permissions WHERE permission_key = 'kyb.manage')
    OR NOT EXISTS (SELECT 1 FROM public.organization_permissions WHERE permission_key = 'kyb.download') THEN
    RAISE EXCEPTION 'Organization KYB permissions are missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.organization_kyb_evidence', 'INSERT')
    OR has_table_privilege('authenticated', 'public.organization_verification_history', 'INSERT') THEN
    RAISE EXCEPTION 'Organization KYB records remain directly browser-writable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'organization-kyb' AND public = FALSE) THEN
    RAISE EXCEPTION 'Private organization KYB bucket is missing';
  END IF;
END;
$$;
ROLLBACK;
