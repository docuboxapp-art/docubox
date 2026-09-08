-- Performance-only migration. The owner predicate is unchanged; wrapping auth.uid()
-- in a scalar subquery lets PostgreSQL evaluate it once per statement instead of once
-- per candidate row. Participant/workspace access remains in its existing SELECT policy.
DROP POLICY IF EXISTS owner_manage_documentos ON public.documentos;

CREATE POLICY owner_manage_documentos
  ON public.documentos
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);

-- This index was created before plantillas.status was renamed to estado. PostgreSQL
-- retained the old index name, making it byte-for-byte equivalent to idx_plantillas_estado.
DROP INDEX IF EXISTS public.idx_plantillas_status;

COMMENT ON POLICY owner_manage_documentos ON public.documentos IS
  'Owner CRUD policy; auth.uid() is initialized once per statement for RLS performance.';
