-- Human-readable workspace identifier used by organization accounts.
-- Existing workspaces remain compatible because the column is nullable.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS workspace_slug TEXT;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_workspace_slug_format_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_workspace_slug_format_check
  CHECK (
    workspace_slug IS NULL
    OR workspace_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_workspace_slug
  ON public.workspaces (lower(workspace_slug))
  WHERE workspace_slug IS NOT NULL;

COMMENT ON COLUMN public.workspaces.workspace_slug IS
  'Editable, globally unique public identifier for an organization workspace.';

-- Optional tax/person identifier captured when an invitation is prepared
-- during organization registration. It is not used for authorization.
ALTER TABLE public.organization_invitations
  ADD COLUMN IF NOT EXISTS recipient_identifier TEXT;

ALTER TABLE public.organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_recipient_identifier_check;
ALTER TABLE public.organization_invitations
  ADD CONSTRAINT organization_invitations_recipient_identifier_check
  CHECK (
    recipient_identifier IS NULL
    OR recipient_identifier ~ '^[A-Z0-9]{10,18}$'
  );

GRANT SELECT (workspace_slug) ON public.workspaces TO authenticated;
GRANT SELECT (recipient_identifier) ON public.organization_invitations TO authenticated;;
