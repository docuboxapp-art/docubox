-- Docubox Colabora: spaces, milestones, activity and document requests.

CREATE TABLE IF NOT EXISTS public.collaboration_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  space_type TEXT NOT NULL DEFAULT 'project'
    CHECK (space_type IN ('client','project','area','operation','contract','case_file','committee','closing')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','on_hold','closed','archived')),
  confidentiality TEXT NOT NULL DEFAULT 'internal'
    CHECK (confidentiality IN ('internal','confidential','restricted')),
  owner_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  backup_owner_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  organization_unit_id UUID REFERENCES public.organization_units(id) ON DELETE SET NULL,
  case_file_id UUID REFERENCES public.case_files(id) ON DELETE SET NULL,
  favorite_by UUID[] NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  optimistic_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tareas_collaboration_space_id_fkey'
      AND conrelid = 'public.tareas'::regclass
  ) THEN
    ALTER TABLE public.tareas
      ADD CONSTRAINT tareas_collaboration_space_id_fkey
      FOREIGN KEY (collaboration_space_id)
      REFERENCES public.collaboration_spaces(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.collaboration_space_members (
  space_id UUID NOT NULL REFERENCES public.collaboration_spaces(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator'
    CHECK (role IN ('coordinator','manager','collaborator','reviewer','approver','observer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','suspended','removed')),
  added_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_space_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES public.collaboration_spaces(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('document','document_version','case_file','form','template','request','task')),
  resource_id UUID NOT NULL,
  display_name TEXT,
  added_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (space_id, resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE CASCADE,
  source_type TEXT,
  source_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming','in_progress','completed','missed','cancelled')),
  starts_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL,
  recurrence_rule TEXT,
  reminder_hours INTEGER[] NOT NULL DEFAULT ARRAY[72,24],
  owner_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  summary TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('private','internal','shared')),
  recipient_ids UUID[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  read_by UUID[] NOT NULL DEFAULT '{}',
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE SET NULL,
  case_file_id UUID REFERENCES public.case_files(id) ON DELETE SET NULL,
  folio TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','in_progress','in_review','completed','expired','cancelled')),
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  responsible_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  access_token_hash TEXT UNIQUE,
  access_expires_at TIMESTAMPTZ,
  reminder_policy JSONB NOT NULL DEFAULT '{}'::JSONB,
  optimistic_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, folio)
);

CREATE TABLE IF NOT EXISTS public.collaboration_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.collaboration_document_requests(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('document','form','identity','signature')),
  title TEXT NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','uploaded','in_review','approved','rejected','replacement_requested','expired','waived')),
  position INTEGER NOT NULL DEFAULT 0,
  declared_valid_until DATE,
  validation_status TEXT NOT NULL DEFAULT 'not_checked'
    CHECK (validation_status IN ('not_checked','pending','valid','invalid','inconclusive')),
  validation_provider TEXT,
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  waived_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  waiver_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_request_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_item_id UUID NOT NULL REFERENCES public.collaboration_request_items(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  malware_scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (malware_scan_status IN ('pending','clean','quarantined','failed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  replaced_file_id UUID REFERENCES public.collaboration_request_files(id) ON DELETE SET NULL,
  uploaded_by_member_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  uploaded_by_external_session_id UUID,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  UNIQUE (request_item_id, version)
);

CREATE INDEX IF NOT EXISTS idx_collab_spaces_workspace_status
  ON public.collaboration_spaces(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_space_resources_lookup
  ON public.collaboration_space_resources(workspace_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_collab_milestones_calendar
  ON public.collaboration_milestones(workspace_id, due_at, status);
CREATE INDEX IF NOT EXISTS idx_collab_activity_feed
  ON public.collaboration_activity_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_requests_workspace_status
  ON public.collaboration_document_requests(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_collab_request_items_request
  ON public.collaboration_request_items(request_id, position);

CREATE OR REPLACE FUNCTION public.bump_collaboration_space_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.optimistic_version := OLD.optimistic_version + 1;
  NEW.updated_at := CURRENT_TIMESTAMP;
  IF OLD.status IN ('closed','archived') AND NEW.status NOT IN ('closed','archived') THEN
    RAISE EXCEPTION 'closed_space_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bump_collaboration_space_version
  BEFORE UPDATE ON public.collaboration_spaces
  FOR EACH ROW EXECUTE FUNCTION public.bump_collaboration_space_version();

CREATE OR REPLACE FUNCTION public.bump_collaboration_request_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.optimistic_version := OLD.optimistic_version + 1;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bump_collaboration_request_version
  BEFORE UPDATE ON public.collaboration_document_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_collaboration_request_version();

ALTER TABLE public.collaboration_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_space_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_document_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_request_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collab_spaces_read ON public.collaboration_spaces;
CREATE POLICY collab_spaces_read ON public.collaboration_spaces FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_space_members_read ON public.collaboration_space_members;
CREATE POLICY collab_space_members_read ON public.collaboration_space_members FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_space_resources_read ON public.collaboration_space_resources;
CREATE POLICY collab_space_resources_read ON public.collaboration_space_resources FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_milestones_read ON public.collaboration_milestones;
CREATE POLICY collab_milestones_read ON public.collaboration_milestones FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration.view_dashboard'));
DROP POLICY IF EXISTS collab_activity_read ON public.collaboration_activity_events;
CREATE POLICY collab_activity_read ON public.collaboration_activity_events FOR SELECT TO authenticated
  USING (
    public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration.view_dashboard')
    AND (visibility <> 'private' OR actor_user_id = auth.uid() OR auth.uid() = ANY(recipient_ids))
  );
DROP POLICY IF EXISTS collab_requests_read ON public.collaboration_document_requests;
CREATE POLICY collab_requests_read ON public.collaboration_document_requests FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'requests.view'));
DROP POLICY IF EXISTS collab_request_items_read ON public.collaboration_request_items;
CREATE POLICY collab_request_items_read ON public.collaboration_request_items FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'requests.view'));
DROP POLICY IF EXISTS collab_request_files_read ON public.collaboration_request_files;
CREATE POLICY collab_request_files_read ON public.collaboration_request_files FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'requests.view'));

REVOKE INSERT, UPDATE, DELETE ON public.collaboration_spaces FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_space_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_space_resources FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_milestones FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_activity_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_document_requests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_request_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_request_files FROM authenticated;

GRANT SELECT ON public.collaboration_spaces, public.collaboration_space_members,
  public.collaboration_space_resources, public.collaboration_milestones,
  public.collaboration_activity_events, public.collaboration_document_requests,
  public.collaboration_request_items, public.collaboration_request_files TO authenticated;
