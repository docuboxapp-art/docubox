-- Docubox Colabora: extend canonical tasks and add review/version domain.

ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS collaboration_space_id UUID,
  ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES public.organization_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT,
  ADD COLUMN IF NOT EXISTS confidentiality TEXT NOT NULL DEFAULT 'internal'
    CHECK (confidentiality IN ('private','internal','shared','formal')),
  ADD COLUMN IF NOT EXISTS optimistic_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tareas_collaboration_source
  ON public.tareas(workspace_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_tareas_collaboration_sla
  ON public.tareas(workspace_id, estado, sla_due_at);

CREATE TABLE IF NOT EXISTS public.task_collaborators (
  task_id UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'collaborator' CHECK (role IN ('collaborator','reviewer','approver')),
  added_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.task_followers (
  task_id UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id)
);

ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.task_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'internal'
    CHECK (audience IN ('private','internal','shared','formal')),
  ADD COLUMN IF NOT EXISTS recipient_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_formal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_review','approved','sent','signed','obsolete')),
  file_url TEXT,
  storage_path TEXT,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  change_reason TEXT,
  source_version_id UUID REFERENCES public.document_versions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  frozen_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.collaboration_review_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','changes_requested','approved','closed','cancelled')),
  requested_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  blocking_comments_required BOOLEAN NOT NULL DEFAULT TRUE,
  decision_note TEXT,
  decided_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  optimistic_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (document_id, round_number)
);

CREATE TABLE IF NOT EXISTS public.collaboration_reviewers (
  review_round_id UUID NOT NULL REFERENCES public.collaboration_review_rounds(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer','approver','observer')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reviewing','approved','changes_requested','abstained')),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (review_round_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  review_round_id UUID REFERENCES public.collaboration_review_rounds(id) ON DELETE SET NULL,
  parent_id UUID REFERENCES public.collaboration_comments(id) ON DELETE SET NULL,
  author_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  audience TEXT NOT NULL DEFAULT 'internal'
    CHECK (audience IN ('private','internal','shared','formal')),
  recipient_ids UUID[] NOT NULL DEFAULT '{}',
  comment_type TEXT NOT NULL DEFAULT 'general'
    CHECK (comment_type IN ('general','annotation','change_request','decision')),
  is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','redacted')),
  resolved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  redacted_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  redacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.collaboration_comment_mentions (
  comment_id UUID NOT NULL REFERENCES public.collaboration_comments(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, mentioned_user_id)
);

CREATE TABLE IF NOT EXISTS public.collaboration_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  document_version_id UUID NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  comment_id UUID NOT NULL REFERENCES public.collaboration_comments(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  annotation_type TEXT NOT NULL CHECK (annotation_type IN ('point','highlight','rectangle','region')),
  x NUMERIC(9,6) NOT NULL CHECK (x BETWEEN 0 AND 1),
  y NUMERIC(9,6) NOT NULL CHECK (y BETWEEN 0 AND 1),
  width NUMERIC(9,6) CHECK (width IS NULL OR width BETWEEN 0 AND 1),
  height NUMERIC(9,6) CHECK (height IS NULL OR height BETWEEN 0 AND 1),
  rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_versions_document
  ON public.document_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_review_rounds_workspace_status
  ON public.collaboration_review_rounds(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_comments_version_status
  ON public.collaboration_comments(document_version_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_mentions_gin
  ON public.collaboration_comments USING GIN(recipient_ids);

CREATE OR REPLACE FUNCTION public.prevent_frozen_document_version_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL OR OLD.status IN ('sent','signed') THEN
    RAISE EXCEPTION 'frozen_document_version' USING ERRCODE = '55000';
  END IF;
  NEW.version_number := OLD.version_number;
  NEW.document_id := OLD.document_id;
  NEW.workspace_id := OLD.workspace_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_frozen_document_version_mutation
  BEFORE UPDATE ON public.document_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_frozen_document_version_mutation();

CREATE OR REPLACE FUNCTION public.prevent_formal_comment_delete()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.audience = 'formal' OR OLD.parent_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.collaboration_comments reply WHERE reply.parent_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'comment_must_be_redacted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER prevent_formal_comment_delete
  BEFORE DELETE ON public.collaboration_comments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_formal_comment_delete();

CREATE OR REPLACE FUNCTION public.bump_collaboration_optimistic_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.optimistic_version := OLD.optimistic_version + 1;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bump_review_optimistic_version
  BEFORE UPDATE ON public.collaboration_review_rounds
  FOR EACH ROW EXECUTE FUNCTION public.bump_collaboration_optimistic_version();

CREATE OR REPLACE FUNCTION public.bump_task_optimistic_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.optimistic_version := OLD.optimistic_version + 1;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_task_optimistic_version ON public.tareas;
CREATE TRIGGER bump_task_optimistic_version
  BEFORE UPDATE ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION public.bump_task_optimistic_version();

ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_review_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_comment_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_collaborators_read ON public.task_collaborators;
CREATE POLICY task_collaborators_read ON public.task_collaborators FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'tasks.view'));
DROP POLICY IF EXISTS task_followers_read ON public.task_followers;
CREATE POLICY task_followers_read ON public.task_followers FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_core', FALSE)
    AND public.has_organization_permission(workspace_id, 'tasks.view'));
DROP POLICY IF EXISTS document_versions_read ON public.document_versions;
CREATE POLICY document_versions_read ON public.document_versions FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_reviews', FALSE)
    AND public.has_organization_permission(workspace_id, 'versions.view'));
DROP POLICY IF EXISTS review_rounds_read ON public.collaboration_review_rounds;
CREATE POLICY review_rounds_read ON public.collaboration_review_rounds FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_reviews', FALSE)
    AND public.has_organization_permission(workspace_id, 'reviews.view'));
DROP POLICY IF EXISTS reviewers_read ON public.collaboration_reviewers;
CREATE POLICY reviewers_read ON public.collaboration_reviewers FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_reviews', FALSE)
    AND public.has_organization_permission(workspace_id, 'reviews.view'));
DROP POLICY IF EXISTS comments_read ON public.collaboration_comments;
CREATE POLICY comments_read ON public.collaboration_comments FOR SELECT TO authenticated
  USING (
    public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_reviews', FALSE)
    AND public.has_organization_permission(workspace_id, 'reviews.view')
    AND (
      audience <> 'private'
      OR author_id = auth.uid()
      OR auth.uid() = ANY(recipient_ids)
    )
  );
DROP POLICY IF EXISTS mentions_read ON public.collaboration_comment_mentions;
CREATE POLICY mentions_read ON public.collaboration_comment_mentions FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_reviews', FALSE)
    AND (mentioned_user_id = auth.uid() OR public.has_organization_permission(workspace_id, 'reviews.view')));
DROP POLICY IF EXISTS annotations_read ON public.collaboration_annotations;
CREATE POLICY annotations_read ON public.collaboration_annotations FOR SELECT TO authenticated
  USING (public.has_collaboration_entitlement(workspace_id, 'collaboration_advanced_reviews', FALSE)
    AND public.has_organization_permission(workspace_id, 'reviews.view'));

REVOKE INSERT, UPDATE, DELETE ON public.task_collaborators FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.task_followers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.document_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_review_rounds FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_reviewers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_comments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_comment_mentions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collaboration_annotations FROM authenticated;

GRANT SELECT ON public.task_collaborators, public.task_followers, public.document_versions,
  public.collaboration_review_rounds, public.collaboration_reviewers,
  public.collaboration_comments, public.collaboration_comment_mentions,
  public.collaboration_annotations TO authenticated;
