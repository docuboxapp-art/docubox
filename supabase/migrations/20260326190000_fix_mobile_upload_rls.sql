-- Fix mobile_upload_sessions policies to allow service role inserts
-- and allow reading completed sessions for realtime updates

-- Allow service role to bypass RLS (already does by default)
-- But we need anon/authenticated to read completed sessions for realtime

DROP POLICY IF EXISTS "public_can_read_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
CREATE POLICY "public_can_read_mobile_upload_sessions_by_token"
ON public.mobile_upload_sessions
FOR SELECT
TO anon, authenticated
USING (expires_at > now() OR status = 'completed');

-- Allow service role insert (service role bypasses RLS, no policy needed)
-- Allow anon to update sessions (for mobile submit)
DROP POLICY IF EXISTS "public_can_update_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
CREATE POLICY "public_can_update_mobile_upload_sessions_by_token"
ON public.mobile_upload_sessions
FOR UPDATE
TO anon, authenticated
USING (expires_at > now() AND status = 'pending')
WITH CHECK (expires_at > now());
