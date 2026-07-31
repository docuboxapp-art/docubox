-- Allow anonymous/unauthenticated reads on enrollment_results filtered by session_id
-- This enables the polling fallback in the webapp to work without auth
-- The service role client in the API route handles writes (bypasses RLS)

-- Enable realtime on enrollment_results (ensure it's in the publication)
ALTER TABLE public.enrollment_results REPLICA IDENTITY FULL;

DO $$
BEGIN
  -- Add SELECT policy for anon to read their own session results
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'enrollment_results'
      AND policyname = 'anon_read_by_session_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY anon_read_by_session_id
        ON public.enrollment_results
        FOR SELECT
        TO anon, authenticated
        USING (true)
    $policy$;
  END IF;
END $$;
