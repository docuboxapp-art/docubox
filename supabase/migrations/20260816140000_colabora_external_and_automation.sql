-- Docubox Colabora Pro: external rooms, automation and advanced coordination.

CREATE TABLE IF NOT EXISTS public.collaboration_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE SET NULL,
  case_file_id UUID REFERENCES public.case_files(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  purpose TEXT,
  room_type TEXT NOT NULL DEFAULT 'counterparty'
    CHECK (room_type IN ('counterparty','data_room','negotiation','committee','closing')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','expired','closed','revoked','archived')),
  owner_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  otp_required BOOLEAN NOT NULL DEFAULT TRUE,
  downloads_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  watermark_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  terms_required BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  session_minutes INTEGER NOT NULL DEFAULT 30 CHECK (session_minutes BETWEEN 5 AND 1440),
  max_failed_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_failed_attempts BETWEEN 3 AND 20),
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_room_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','expired','revoked','blocked')),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  token_expires_at TIMESTAMPTZ NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{"view":true,"download":false,"upload":false,"comment":false}'::JSONB,
  nda_accepted_at TIMESTAMPTZ,
  invited_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  last_access_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (room_id, email)
);

CREATE TABLE IF NOT EXISTS public.collaboration_room_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('document','document_version','case_file','form','request','file')),
  resource_id UUID NOT NULL,
  display_name TEXT,
  permissions JSONB NOT NULL DEFAULT '{"view":true,"download":false}'::JSONB,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (room_id, resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_external_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES public.collaboration_room_guests(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE CHECK (length(session_token_hash) = 64),
  otp_hash TEXT CHECK (otp_hash IS NULL OR length(otp_hash) = 64),
  otp_expires_at TIMESTAMPTZ,
  otp_consumed_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES public.collaboration_room_guests(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.collaboration_external_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  outcome TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failed')),
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','disabled','error','archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  max_depth INTEGER NOT NULL DEFAULT 5 CHECK (max_depth BETWEEN 1 AND 20),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  published_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_automation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES public.collaboration_automations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  trigger_definition JSONB NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::JSONB,
  actions JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_policy JSONB NOT NULL DEFAULT '{"max_attempts":3,"backoff":"exponential"}'::JSONB,
  schema_version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (automation_id, version)
);

CREATE TABLE IF NOT EXISTS public.collaboration_automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES public.collaboration_automations(id) ON DELETE CASCADE,
  automation_version_id UUID NOT NULL REFERENCES public.collaboration_automation_versions(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','retrying','failed','dead_lettered','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  result_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_code TEXT,
  error_detail TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.collaboration_negotiation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  clause_reference TEXT,
  original_text TEXT,
  requested_change TEXT,
  counterparty_proposal TEXT,
  internal_position TEXT,
  owner_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','internal_review','counterparty_review','agreed','rejected','withdrawn')),
  resolution TEXT,
  resolved_version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','convened','in_session','closed','cancelled')),
  scheduled_at TIMESTAMPTZ,
  quorum_rule JSONB NOT NULL DEFAULT '{}'::JSONB,
  agenda JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_committee_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES public.collaboration_committees(id) ON DELETE CASCADE,
  agenda_item_key TEXT NOT NULL,
  voter_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('for','against','abstain')),
  comment TEXT,
  cast_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (committee_id, agenda_item_key, voter_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_closing_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  space_id UUID REFERENCES public.collaboration_spaces(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing','ready','signing','released','sealed','cancelled')),
  conditions JSONB NOT NULL DEFAULT '[]'::JSONB,
  release_authorized_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ,
  sealed_at TIMESTAMPTZ,
  manifest_hash TEXT CHECK (manifest_hash IS NULL OR manifest_hash ~ '^[0-9a-f]{64}$'),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collab_rooms_workspace_status
  ON public.collaboration_rooms(workspace_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_collab_room_guests_room_status
  ON public.collaboration_room_guests(room_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_external_sessions_expiry
  ON public.collaboration_external_sessions(room_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collab_external_events_room
  ON public.collaboration_external_events(room_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_automations_workspace
  ON public.collaboration_automations(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_collab_automation_runs_status
  ON public.collaboration_automation_runs(workspace_id, status, scheduled_at);

ALTER TABLE public.collaboration_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_room_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_room_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_external_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_external_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_automation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_negotiation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_committee_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_closing_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collab_rooms_read ON public.collaboration_rooms;
CREATE POLICY collab_rooms_read ON public.collaboration_rooms FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', FALSE)
    AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_room_guests_read ON public.collaboration_room_guests;
CREATE POLICY collab_room_guests_read ON public.collaboration_room_guests FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', FALSE)
    AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_room_resources_read ON public.collaboration_room_resources;
CREATE POLICY collab_room_resources_read ON public.collaboration_room_resources FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', FALSE)
    AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_external_events_read ON public.collaboration_external_events;
CREATE POLICY collab_external_events_read ON public.collaboration_external_events FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_external_rooms', FALSE)
    AND public.has_organization_permission(workspace_id, 'rooms.view'));
DROP POLICY IF EXISTS collab_automations_read ON public.collaboration_automations;
CREATE POLICY collab_automations_read ON public.collaboration_automations FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_automations', FALSE)
    AND public.has_organization_permission(workspace_id, 'automations.view'));
DROP POLICY IF EXISTS collab_automation_versions_read ON public.collaboration_automation_versions;
CREATE POLICY collab_automation_versions_read ON public.collaboration_automation_versions FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_automations', FALSE)
    AND public.has_organization_permission(workspace_id, 'automations.view'));
DROP POLICY IF EXISTS collab_automation_runs_read ON public.collaboration_automation_runs;
CREATE POLICY collab_automation_runs_read ON public.collaboration_automation_runs FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_automations', FALSE)
    AND public.has_organization_permission(workspace_id, 'automations.view'));
DROP POLICY IF EXISTS collab_negotiation_read ON public.collaboration_negotiation_items;
CREATE POLICY collab_negotiation_read ON public.collaboration_negotiation_items FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', FALSE)
    AND public.has_organization_permission(workspace_id, 'reviews.view'));
DROP POLICY IF EXISTS collab_committees_read ON public.collaboration_committees;
CREATE POLICY collab_committees_read ON public.collaboration_committees FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_committee_votes_read ON public.collaboration_committee_votes;
CREATE POLICY collab_committee_votes_read ON public.collaboration_committee_votes FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));
DROP POLICY IF EXISTS collab_closing_rooms_read ON public.collaboration_closing_rooms;
CREATE POLICY collab_closing_rooms_read ON public.collaboration_closing_rooms FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_workflows', FALSE)
    AND public.has_organization_permission(workspace_id, 'collaboration_spaces.view'));

-- No anonymous policy is created. Public access is mediated by rate-limited backend APIs.
REVOKE ALL ON public.collaboration_external_sessions FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_rooms, public.collaboration_room_guests,
  public.collaboration_room_resources, public.collaboration_external_events,
  public.collaboration_automations, public.collaboration_automation_versions,
  public.collaboration_automation_runs, public.collaboration_negotiation_items,
  public.collaboration_committees, public.collaboration_committee_votes,
  public.collaboration_closing_rooms FROM authenticated;

GRANT SELECT ON public.collaboration_rooms, public.collaboration_room_guests,
  public.collaboration_room_resources, public.collaboration_external_events,
  public.collaboration_automations, public.collaboration_automation_versions,
  public.collaboration_automation_runs, public.collaboration_negotiation_items,
  public.collaboration_committees, public.collaboration_committee_votes,
  public.collaboration_closing_rooms TO authenticated;
