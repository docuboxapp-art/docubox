-- Additional access is read-only and exists only for completed documents.
UPDATE public.document_access_permissions permission
SET grantee_user_id = account.id, grantee_email = NULL
FROM auth.users account
WHERE permission.grantee_email IS NOT NULL
  AND lower(account.email) = permission.grantee_email;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.document_access_permissions
    WHERE grantee_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Resolve unregistered document permission emails before this migration';
  END IF;
END;
$$;

ALTER TABLE public.document_access_permissions
  DROP CONSTRAINT document_access_permissions_access_level_check;

UPDATE public.document_access_permissions
SET access_level = CASE WHEN access_level = 'edit' THEN 'view' ELSE access_level END,
    can_invite = FALSE;

ALTER TABLE public.document_access_permissions
  ADD CONSTRAINT document_access_permissions_access_level_check
    CHECK (access_level IN ('view', 'download', 'evidence')),
  ADD CONSTRAINT document_access_permissions_registered_user_check
    CHECK (grantee_user_id IS NOT NULL AND grantee_email IS NULL),
  ADD CONSTRAINT document_access_permissions_no_invitation_check
    CHECK (can_invite = FALSE);

COMMENT ON TABLE public.document_access_permissions IS
  'Accesos adicionales de consulta para usuarios registrados, concedidos por propietario o administrador tras completar el documento.';

CREATE OR REPLACE FUNCTION public.has_document_access_permission(
  p_document_id UUID,
  p_required_level TEXT DEFAULT 'view'
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_access_permissions permission
    JOIN public.documentos document ON document.id = permission.document_id
    WHERE permission.document_id = p_document_id
      AND document.estado = 'completado'
      AND permission.grantee_user_id = auth.uid()
      AND (
        p_required_level = 'view'
        OR (p_required_level = 'download' AND permission.access_level IN ('download', 'evidence'))
        OR (p_required_level = 'evidence' AND permission.access_level = 'evidence')
      )
  );
$$;

-- Additional viewers receive only server-projected document data. Row-level
-- access to the full documentos record remains limited to the flow roles.
CREATE OR REPLACE FUNCTION public.can_access_documento(p_document_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documentos document
    WHERE document.id = p_document_id
      AND NOT EXISTS (
        SELECT 1 FROM public.document_user_visibility visibility
        WHERE visibility.document_id = document.id
          AND visibility.user_id = auth.uid()
          AND (visibility.hidden_at IS NOT NULL OR (visibility.trashed_at IS NOT NULL AND visibility.restored_at IS NULL))
      )
      AND (
        document.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_members manager
          WHERE manager.workspace_id = COALESCE(document.current_custodian_workspace_id, document.workspace_id)
            AND manager.user_id = auth.uid()
            AND manager.status = 'active'
            AND lower(manager.role::TEXT) IN ('owner', 'admin', 'workspace_admin')
            AND (manager.access_expires_at IS NULL OR manager.access_expires_at > CURRENT_TIMESTAMP)
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(document.participantes, '[]'::JSONB)) participant
          WHERE lower(COALESCE(participant ->> 'current_access', 'true')) NOT IN ('false', '0', 'no')
            AND participant ->> 'portal_token_invalidated_at' IS NULL
            AND (
              public.try_uuid(participant ->> 'id') = auth.uid()
              OR public.try_uuid(participant ->> 'user_id') = auth.uid()
              OR lower(COALESCE(participant ->> 'email', '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
            )
        )
      )
  );
$$;
