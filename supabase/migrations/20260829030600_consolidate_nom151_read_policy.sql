-- Consolidate historical and tenant-aware reads into one policy. This keeps
-- participant access implemented by can_access_documento() while avoiding
-- multiple permissive SELECT policies for authenticated users.

DROP POLICY IF EXISTS "nom151_doc_authorized_read" ON public.nom151_constancias_doc;
DROP POLICY IF EXISTS "nom151_doc_member_read" ON public.nom151_constancias_doc;

CREATE POLICY "nom151_doc_member_read"
  ON public.nom151_constancias_doc
  FOR SELECT
  TO authenticated
  USING (
    public.can_access_documento(documento_id)
    OR EXISTS (
      SELECT 1
      FROM public.documentos d
      WHERE d.id = nom151_constancias_doc.documento_id
        AND (
          d.owner_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.workspace_members wm
            WHERE wm.workspace_id = d.workspace_id
              AND wm.user_id = (SELECT auth.uid())
              AND wm.status = 'active'
          )
        )
    )
  );

;
