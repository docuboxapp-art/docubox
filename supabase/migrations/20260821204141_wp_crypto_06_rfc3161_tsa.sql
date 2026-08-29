-- WP-CRYPTO-06: store only verifiable RFC 3161 evidence. Private keys and
-- credentials are deliberately excluded from PostgreSQL and Storage metadata.

ALTER TABLE public.document_pdf_signatures
  ADD COLUMN IF NOT EXISTS timestamp_record_id uuid
  REFERENCES public.timestamp_records(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_document_pdf_signatures_timestamp_record
  ON public.document_pdf_signatures (timestamp_record_id)
  WHERE timestamp_record_id IS NOT NULL;

COMMENT ON COLUMN public.document_pdf_signatures.timestamp_record_id IS
  'RFC 3161 evidence attached to this PDF signature. Required by the service before it declares PAdES-B-T.';

COMMENT ON TABLE public.timestamp_records IS
  'Verified RFC 3161 evidence. created_at is audit metadata only and is never a substitute for gen_time or a TimeStampToken.';
