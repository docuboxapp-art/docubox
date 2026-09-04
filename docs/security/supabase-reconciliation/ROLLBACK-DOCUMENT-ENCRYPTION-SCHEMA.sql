-- ONLY FOR DOCUMENT ENCRYPTION SCHEMA ROLLBACK
--
-- Generated from the production snapshot in
-- pre-encryption-schema-snapshot/LEGACY-OBJECTS.sql.
-- This script never modifies documentos, document_versions rows, or Storage.
-- Execute only after reviewing the current production state.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.document_encryption_metadata LIMIT 1) THEN
    RAISE EXCEPTION 'rollback_blocked_non_empty_document_encryption_metadata'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.document_encryption_security_events LIMIT 1) THEN
    RAISE EXCEPTION 'rollback_blocked_non_empty_document_encryption_security_events'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS immutable_document_encryption_security_events
  ON public.document_encryption_security_events;
DROP TRIGGER IF EXISTS touch_document_encryption_metadata_updated_at
  ON public.document_encryption_metadata;
DROP TABLE IF EXISTS public.document_encryption_security_events;
DROP TABLE IF EXISTS public.document_encryption_metadata;

DROP FUNCTION IF EXISTS public.reject_document_encryption_security_event_mutation();
DROP FUNCTION IF EXISTS public.touch_document_encryption_metadata_updated_at();

DROP TRIGGER IF EXISTS trg_sync_dek_counts ON public.document_participant_deks;
DROP VIEW IF EXISTS public.v_documents_missing_participant_deks;
DROP TABLE IF EXISTS public.document_encryption_metadata;

-- The following definitions are the captured legacy definitions.
\ir pre-encryption-schema-snapshot/LEGACY-OBJECTS.sql

COMMIT;
