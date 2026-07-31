-- ─── Task Details Tables ─────────────────────────────────────────────────────
-- Migration: 20260524050000_task_details_tables.sql
-- Adds dedicated relational tables for task checklist, comments, attachments,
-- history, and dependencies. The tareas table already exists.

-- 1. task_checklist_items
CREATE TABLE IF NOT EXISTS public.task_checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id      UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  done          BOOLEAN NOT NULL DEFAULT false,
  position      INTEGER NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_checklist_tarea_id ON public.task_checklist_items(tarea_id);
CREATE INDEX IF NOT EXISTS idx_task_checklist_workspace_id ON public.task_checklist_items(workspace_id);

-- 2. task_comments
CREATE TABLE IF NOT EXISTS public.task_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id      UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  author_id     UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  author_name   TEXT NOT NULL DEFAULT '',
  author_avatar TEXT NOT NULL DEFAULT '',
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_tarea_id ON public.task_comments(tarea_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_workspace_id ON public.task_comments(workspace_id);

-- 3. task_attachments
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id      UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  size          TEXT NOT NULL DEFAULT '',
  file_type     TEXT NOT NULL DEFAULT '',
  storage_path  TEXT,
  uploaded_by   UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_tarea_id ON public.task_attachments(tarea_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_workspace_id ON public.task_attachments(workspace_id);

-- 4. task_history
CREATE TABLE IF NOT EXISTS public.task_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id      UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id  UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  actor_id      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_name    TEXT NOT NULL DEFAULT '',
  icon_name     TEXT NOT NULL DEFAULT 'Plus',
  color         TEXT NOT NULL DEFAULT 'text-blue-500',
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_history_tarea_id ON public.task_history(tarea_id);
CREATE INDEX IF NOT EXISTS idx_task_history_workspace_id ON public.task_history(workspace_id);

-- 5. task_dependencies
CREATE TABLE IF NOT EXISTS public.task_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id        UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  depends_on_id   UUID NOT NULL REFERENCES public.tareas(id) ON DELETE CASCADE,
  workspace_id    UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tarea_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_tarea_id ON public.task_dependencies(tarea_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_id ON public.task_dependencies(depends_on_id);

-- 6. updated_at triggers
CREATE OR REPLACE FUNCTION public.set_task_details_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_checklist_updated_at ON public.task_checklist_items;
CREATE TRIGGER task_checklist_updated_at
  BEFORE UPDATE ON public.task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_task_details_updated_at();

DROP TRIGGER IF EXISTS task_comments_updated_at ON public.task_comments;
CREATE TRIGGER task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_task_details_updated_at();

-- 7. Enable RLS
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies — workspace members access

-- task_checklist_items
DROP POLICY IF EXISTS "ws_members_select_task_checklist" ON public.task_checklist_items;
CREATE POLICY "ws_members_select_task_checklist"
ON public.task_checklist_items FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_insert_task_checklist" ON public.task_checklist_items;
CREATE POLICY "ws_members_insert_task_checklist"
ON public.task_checklist_items FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_update_task_checklist" ON public.task_checklist_items;
CREATE POLICY "ws_members_update_task_checklist"
ON public.task_checklist_items FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_delete_task_checklist" ON public.task_checklist_items;
CREATE POLICY "ws_members_delete_task_checklist"
ON public.task_checklist_items FOR DELETE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- task_comments
DROP POLICY IF EXISTS "ws_members_select_task_comments" ON public.task_comments;
CREATE POLICY "ws_members_select_task_comments"
ON public.task_comments FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_insert_task_comments" ON public.task_comments;
CREATE POLICY "ws_members_insert_task_comments"
ON public.task_comments FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_update_task_comments" ON public.task_comments;
CREATE POLICY "ws_members_update_task_comments"
ON public.task_comments FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_delete_task_comments" ON public.task_comments;
CREATE POLICY "ws_members_delete_task_comments"
ON public.task_comments FOR DELETE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- task_attachments
DROP POLICY IF EXISTS "ws_members_select_task_attachments" ON public.task_attachments;
CREATE POLICY "ws_members_select_task_attachments"
ON public.task_attachments FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_insert_task_attachments" ON public.task_attachments;
CREATE POLICY "ws_members_insert_task_attachments"
ON public.task_attachments FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_delete_task_attachments" ON public.task_attachments;
CREATE POLICY "ws_members_delete_task_attachments"
ON public.task_attachments FOR DELETE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- task_history
DROP POLICY IF EXISTS "ws_members_select_task_history" ON public.task_history;
CREATE POLICY "ws_members_select_task_history"
ON public.task_history FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_insert_task_history" ON public.task_history;
CREATE POLICY "ws_members_insert_task_history"
ON public.task_history FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

-- task_dependencies
DROP POLICY IF EXISTS "ws_members_select_task_dependencies" ON public.task_dependencies;
CREATE POLICY "ws_members_select_task_dependencies"
ON public.task_dependencies FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_insert_task_dependencies" ON public.task_dependencies;
CREATE POLICY "ws_members_insert_task_dependencies"
ON public.task_dependencies FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ws_members_delete_task_dependencies" ON public.task_dependencies;
CREATE POLICY "ws_members_delete_task_dependencies"
ON public.task_dependencies FOR DELETE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
