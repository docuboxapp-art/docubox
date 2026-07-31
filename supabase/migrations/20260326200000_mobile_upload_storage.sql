-- Migration: Add storage_path support and create mobile-uploads bucket policies
-- Timestamp: 20260326200000

-- Add storage_path column to mobile_upload_sessions (if not already there)
ALTER TABLE public.mobile_upload_sessions
ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Create the mobile-uploads storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mobile-uploads',
  'mobile-uploads',
  false,
  26214400, -- 25MB
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- Allow service role to manage mobile-uploads bucket
DROP POLICY IF EXISTS "mobile_uploads_service_insert" ON storage.objects;
CREATE POLICY "mobile_uploads_service_insert"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'mobile-uploads');

DROP POLICY IF EXISTS "mobile_uploads_service_select" ON storage.objects;
CREATE POLICY "mobile_uploads_service_select"
ON storage.objects
FOR SELECT
TO service_role
USING (bucket_id = 'mobile-uploads');

DROP POLICY IF EXISTS "mobile_uploads_service_delete" ON storage.objects;
CREATE POLICY "mobile_uploads_service_delete"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'mobile-uploads');

-- Allow anon to upload (mobile device is not authenticated)
DROP POLICY IF EXISTS "mobile_uploads_anon_insert" ON storage.objects;
CREATE POLICY "mobile_uploads_anon_insert"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'mobile-uploads');

-- Allow authenticated users to read uploads
DROP POLICY IF EXISTS "mobile_uploads_auth_select" ON storage.objects;
CREATE POLICY "mobile_uploads_auth_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'mobile-uploads');
