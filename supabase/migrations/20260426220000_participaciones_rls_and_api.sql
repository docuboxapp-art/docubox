-- ─── Participaciones: RLS & helpers ─────────────────────────────────────────
-- Allows authenticated users to read documents where they appear as a participant
-- (identified by their email stored in the participantes JSONB array).
-- Also adds a helper function used by the API routes.

-- 1. Function: get current user email (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1;
$$;

-- 2. RLS policy: participants can SELECT documents they are listed in
--    The participantes column is a JSONB array of objects with an "email" key.
DROP POLICY IF EXISTS "participants_can_read_documentos" ON public.documentos;
CREATE POLICY "participants_can_read_documentos"
  ON public.documentos
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(participantes, '[]'::jsonb)) AS p
      WHERE p->>'email' = public.current_user_email()
    )
  );

-- 3. Index to speed up JSONB participant lookups
CREATE INDEX IF NOT EXISTS idx_documentos_participantes_gin
  ON public.documentos USING GIN (participantes);

-- 4. Index on owner_id + estado for participation-requests queries
CREATE INDEX IF NOT EXISTS idx_documentos_owner_estado
  ON public.documentos (owner_id, estado);
