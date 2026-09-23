-- Allow authenticated users to delete only their own profile photo.
DROP POLICY IF EXISTS avatars_owner_delete ON storage.objects;
CREATE POLICY avatars_owner_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE ('avatars/' || auth.uid()::text || '.%')
  );
