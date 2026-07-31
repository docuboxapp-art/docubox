-- ============================================================
-- XML Evidence: extra columns for document_signers + blockchain table
-- ============================================================

-- 1. Add curp and hash_firma_autografa to document_signers
ALTER TABLE public.document_signers
  ADD COLUMN IF NOT EXISTS curp TEXT,
  ADD COLUMN IF NOT EXISTS hash_firma_autografa TEXT;

-- 2. Create document_blockchain table (Enterprise tier)
CREATE TABLE IF NOT EXISTS public.document_blockchain (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  tx_id TEXT,
  red TEXT,
  fecha_tx TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_blockchain_document_id ON public.document_blockchain(document_id);

ALTER TABLE public.document_blockchain ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_blockchain_service_write" ON public.document_blockchain;
CREATE POLICY "document_blockchain_service_write" ON public.document_blockchain
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "document_blockchain_owner_read" ON public.document_blockchain;
CREATE POLICY "document_blockchain_owner_read" ON public.document_blockchain
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM public.documents WHERE owner_id = auth.uid()
    )
  );

-- 3. Ensure documents table has folio and nombre_archivo columns
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS folio TEXT,
  ADD COLUMN IF NOT EXISTS nombre_archivo TEXT,
  ADD COLUMN IF NOT EXISTS hash_sha256_original TEXT,
  ADD COLUMN IF NOT EXISTS hash_sha256_final TEXT;

-- 4. Ensure document_audit_trail has metadata column
ALTER TABLE public.document_audit_trail
  ADD COLUMN IF NOT EXISTS metadata JSONB;
