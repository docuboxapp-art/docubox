-- Migration: Add scan columns to documents table and create document_audit_trail

-- Add scan columns to documents table
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS scan_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scan_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS scan_mime VARCHAR(100),
  ADD COLUMN IF NOT EXISTS scan_threat VARCHAR(255),
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Add check constraint for scan_status (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scan_status_values'
    AND conrelid = 'documents'::regclass
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT scan_status_values
      CHECK (scan_status IN ('pending', 'clean', 'rejected'));
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- Create document_audit_trail table if not exists
CREATE TABLE IF NOT EXISTS document_audit_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id),
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on document_audit_trail
ALTER TABLE document_audit_trail ENABLE ROW LEVEL SECURITY;

-- Policy: only service_role can insert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'document_audit_trail'
    AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY "service_role_only"
      ON document_audit_trail
      USING (auth.role() = 'service_role');
  END IF;
END $$;
