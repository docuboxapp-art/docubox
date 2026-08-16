-- Organization phase 12 audit chain and billing boundary contract.

BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organization_audit_events'
      AND column_name IN ('sequence_number', 'previous_event_hash', 'event_hash', 'chain_version')
    GROUP BY table_schema, table_name HAVING COUNT(*) = 4
  ) THEN RAISE EXCEPTION 'Organization audit hash-chain columns are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'chain_organization_audit_event' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'prevent_organization_audit_mutation' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Organization audit chain or immutability trigger is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_event_hash_format_check')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_previous_hash_format_check')
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_audit_sequence_positive_check') THEN
    RAISE EXCEPTION 'Organization audit hash-chain constraints are incomplete';
  END IF;
  IF has_table_privilege('authenticated', 'public.organization_cost_centers', 'INSERT') THEN
    RAISE EXCEPTION 'Organization cost centers remain directly browser-writable';
  END IF;
END;
$$;
ROLLBACK;
