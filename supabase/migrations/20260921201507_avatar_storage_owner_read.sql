-- Storage upsert checks for an existing object before inserting or updating it.
-- Restrict that lookup to the authenticated user's own avatar path.
DROP POLICY IF EXISTS avatars_owner_select ON storage.objects;
CREATE POLICY avatars_owner_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE ('avatars/' || auth.uid()::text || '.%')
  );
