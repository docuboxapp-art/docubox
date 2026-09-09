-- Permisos explícitos por documento. Los participantes del flujo conservan su
-- acceso existente; esta tabla cubre lectores, editores y delegados para invitar.

CREATE TABLE IF NOT EXISTS public.document_access_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  grantee_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_email TEXT,
  access_level TEXT NOT NULL DEFAULT 'view'
    CHECK (access_level IN ('view', 'edit')),
  can_invite BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (grantee_user_id IS NOT NULL AND grantee_email IS NULL)
    OR (grantee_user_id IS NULL AND grantee_email IS NOT NULL)
  ),
  CHECK (grantee_email IS NULL OR grantee_email = lower(trim(grantee_email)))
);

CREATE UNIQUE INDEX IF NOT EXISTS document_access_permissions_user_unique
  ON public.document_access_permissions(document_id, grantee_user_id)
  WHERE grantee_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS document_access_permissions_email_unique
  ON public.document_access_permissions(document_id, grantee_email)
  WHERE grantee_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_access_permissions_lookup
  ON public.document_access_permissions(document_id, access_level)
  WHERE grantee_user_id IS NOT NULL OR grantee_email IS NOT NULL;

ALTER TABLE public.document_access_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.document_access_permissions FROM anon, authenticated;

COMMENT ON TABLE public.document_access_permissions IS
  'Permisos explícitos de lectura, edición e invitación de lectores por documento. Todas las mutaciones se validan en API y se auditan.';

CREATE OR REPLACE FUNCTION public.has_document_access_permission(
  p_document_id UUID,
  p_required_level TEXT DEFAULT 'view'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.document_access_permissions permission
    WHERE permission.document_id = p_document_id
      AND (
        permission.grantee_user_id = auth.uid()
        OR (
          permission.grantee_email IS NOT NULL
          AND lower(permission.grantee_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      )
      AND (
        p_required_level = 'view'
        OR permission.access_level = 'edit'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.has_document_access_permission(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_document_access_permission(UUID, TEXT) TO authenticated, service_role;

-- Amplía el ACL de lectura ya existente sin convertir permisos de lectura en
-- permisos de actualización generales.
CREATE OR REPLACE FUNCTION public.can_access_documento(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documentos d
    WHERE d.id = p_document_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.document_user_visibility visibility
        WHERE visibility.document_id = d.id
          AND visibility.user_id = auth.uid()
          AND (visibility.hidden_at IS NOT NULL OR (visibility.trashed_at IS NOT NULL AND visibility.restored_at IS NULL))
      )
      AND (
        d.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.workspace_members manager
          WHERE manager.workspace_id = d.workspace_id
            AND manager.user_id = auth.uid()
            AND manager.status = 'active'
            AND lower(manager.role::text) IN ('owner', 'admin', 'workspace_admin')
            AND (manager.access_expires_at IS NULL OR manager.access_expires_at > now())
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) participant
          WHERE lower(COALESCE(participant ->> 'current_access', 'true')) NOT IN ('false', '0', 'no')
            AND participant ->> 'portal_token_invalidated_at' IS NULL
            AND (
              public.try_uuid(participant ->> 'id') = auth.uid()
              OR public.try_uuid(participant ->> 'user_id') = auth.uid()
              OR lower(COALESCE(participant ->> 'email', '')) = lower(COALESCE(auth.jwt() ->> 'email', ''))
            )
        )
        OR public.has_document_access_permission(d.id, 'view')
      )
  );
$$;
