-- Tasks are linked to existing resources; system work is reconciled separately
-- from user-authored activities.
ALTER TYPE public.tarea_tipo ADD VALUE IF NOT EXISTS 'retomar_borrador';
ALTER TYPE public.tarea_tipo ADD VALUE IF NOT EXISTS 'revisar_vencimiento';
ALTER TYPE public.tarea_tipo ADD VALUE IF NOT EXISTS 'responder_formulario';
ALTER TYPE public.tarea_tipo ADD VALUE IF NOT EXISTS 'revisar_expediente';

ALTER TABLE public.tareas
  ADD COLUMN IF NOT EXISTS work_kind text NOT NULL DEFAULT 'accion',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS automation_key text,
  ADD COLUMN IF NOT EXISTS resolution_note text;

ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_work_kind_check;
ALTER TABLE public.tareas ADD CONSTRAINT tareas_work_kind_check
  CHECK (work_kind IN ('accion', 'actividad'));
ALTER TABLE public.tareas DROP CONSTRAINT IF EXISTS tareas_origin_check;
ALTER TABLE public.tareas ADD CONSTRAINT tareas_origin_check
  CHECK (origin IN ('manual', 'sistema'));

CREATE UNIQUE INDEX IF NOT EXISTS tareas_automation_source_unique
  ON public.tareas (workspace_id, automation_key, source_id)
  WHERE automation_key IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tareas_assignee_active_priority_idx
  ON public.tareas (assigned_to, prioridad, due_date)
  WHERE estado NOT IN ('completada', 'cancelada', 'rechazada');

CREATE TABLE IF NOT EXISTS public.task_system_rules (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_key text NOT NULL CHECK (rule_key IN ('draft_stale', 'document_due', 'form_invite_pending', 'case_due', 'missing_anexo')),
  enabled boolean NOT NULL DEFAULT true,
  threshold_days integer NOT NULL DEFAULT 3 CHECK (threshold_days BETWEEN 1 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, rule_key)
);

ALTER TABLE public.task_system_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.task_system_rules TO authenticated;

CREATE POLICY task_system_rules_member_read ON public.task_system_rules
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = task_system_rules.workspace_id
        AND wm.user_id = (SELECT auth.uid()) AND wm.status = 'active')
  );
CREATE POLICY task_system_rules_admin_update ON public.task_system_rules
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = task_system_rules.workspace_id
        AND wm.user_id = (SELECT auth.uid()) AND wm.status = 'active'
        AND wm.role IN ('owner', 'admin'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = task_system_rules.workspace_id
        AND wm.user_id = (SELECT auth.uid()) AND wm.status = 'active'
        AND wm.role IN ('owner', 'admin'))
  );

-- Historic demonstration tasks use invented DOC/EXP references. Preserve their
-- audit trail but remove them from the active queue.
UPDATE public.tareas t
SET estado = 'cancelada', cancelled_at = COALESCE(cancelled_at, now()),
    resolution_note = 'Registro de demostración sin documento vinculado; retirado de la cola activa.'
WHERE t.created_at >= '2026-05-24'::timestamptz
  AND t.created_at < '2026-05-25'::timestamptz
  AND t.document_id LIKE 'DOC-2026-%'
  AND t.source_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.documentos d WHERE d.id::text = t.document_id);
