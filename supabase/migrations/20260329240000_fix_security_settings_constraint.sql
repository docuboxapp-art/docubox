-- Fix document_security_settings: remove FK on owner_id and change unique constraint to documento_id only
-- This allows saving security settings even when owner_id is not yet resolved

-- Step 1: Drop the existing FK constraint on owner_id
ALTER TABLE public.document_security_settings
  DROP CONSTRAINT IF EXISTS document_security_settings_owner_id_fkey;

-- Step 2: Drop the existing unique constraint on (documento_id, owner_id)
ALTER TABLE public.document_security_settings
  DROP CONSTRAINT IF EXISTS uq_document_security_settings_doc_owner;

-- Step 3: Add new unique constraint on documento_id only
ALTER TABLE public.document_security_settings
  ADD CONSTRAINT uq_document_security_settings_doc UNIQUE (documento_id);

-- Step 4: Update RLS policy to use owner_id = auth.uid() OR allow insert when owner_id is null (set by trigger)
DROP POLICY IF EXISTS "users_manage_own_document_security_settings" ON public.document_security_settings;
CREATE POLICY "users_manage_own_document_security_settings"
  ON public.document_security_settings
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid() OR owner_id IS NULL)
  WITH CHECK (owner_id = auth.uid() OR owner_id IS NULL);

-- Step 5: Also fix security_audit_log FK on user_id (make it not FK-constrained)
ALTER TABLE public.security_audit_log
  DROP CONSTRAINT IF EXISTS security_audit_log_user_id_fkey;
