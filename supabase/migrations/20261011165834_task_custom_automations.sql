-- The legacy seeded rules were a visual demo and have no runtime processor.
UPDATE public.automation_rules SET activa = false
WHERE nombre IN (
  'Escalado automático por vencimiento',
  'Notificar firmante próximo a vencer',
  'Bloquear firma si falta anexo',
  'Reintento tras fallo de firma',
  'Bloqueo por identidad no validada'
) AND ejecutada_count = 0;

CREATE TABLE IF NOT EXISTS public.task_custom_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  enabled boolean NOT NULL DEFAULT true,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('due_soon', 'overdue')),
  action_kind text NOT NULL CHECK (action_kind IN ('notify_assignee', 'raise_priority')),
  lead_days integer NOT NULL DEFAULT 2 CHECK (lead_days BETWEEN 1 AND 30),
  task_type text,
  work_kind text CHECK (work_kind IN ('accion', 'actividad')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_custom_rules_workspace_active_idx
  ON public.task_custom_rules(workspace_id, enabled);
ALTER TABLE public.task_custom_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_custom_rules TO authenticated;
CREATE POLICY task_custom_rules_read ON public.task_custom_rules
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = task_custom_rules.workspace_id
      AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'));
CREATE POLICY task_custom_rules_manage ON public.task_custom_rules
  FOR ALL TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = task_custom_rules.workspace_id
      AND m.user_id = (SELECT auth.uid()) AND m.status = 'active' AND m.role IN ('owner','admin')))
  WITH CHECK (created_by = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = task_custom_rules.workspace_id
      AND m.user_id = (SELECT auth.uid()) AND m.status = 'active' AND m.role IN ('owner','admin')));

CREATE OR REPLACE FUNCTION task_internal.run_custom_rules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rec record;
  executed integer := 0;
  audit_key text;
BEGIN
  FOR rec IN
    SELECT r.*, t.id task_id, t.assigned_to, t.title, t.prioridad, t.estado,
      t.due_date, t.tipo, t.work_kind task_work_kind
    FROM public.task_custom_rules r
    JOIN public.tareas t ON t.workspace_id = r.workspace_id
      AND t.estado NOT IN ('completada','cancelada','rechazada')
      AND t.due_date IS NOT NULL
      AND (r.task_type IS NULL OR r.task_type = t.tipo::text)
      AND (r.work_kind IS NULL OR r.work_kind = t.work_kind)
      AND ((r.trigger_kind = 'overdue' AND t.due_date < now())
        OR (r.trigger_kind = 'due_soon' AND t.due_date BETWEEN now() AND now() + make_interval(days => r.lead_days)))
    WHERE r.enabled
  LOOP
    IF rec.action_kind = 'notify_assignee' AND rec.assigned_to IS NOT NULL THEN
      audit_key := 'task-rule:' || rec.id::text || ':' || rec.task_id::text || ':' || current_date::text;
      INSERT INTO public.notifications (
        user_id, workspace_id, type, title, description, priority, category,
        event_type, severity, entity_type, entity_id, action_url, action_label, idempotency_key
      ) VALUES (
        rec.assigned_to, rec.workspace_id, 'task_rule', rec.name, rec.title,
        'medium', 'REMINDER', 'task.custom_rule', 'warning', 'task', rec.task_id,
        '/mis-tareas?task=' || rec.task_id::text, 'Ver tarea', audit_key
      ) ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.task_history (tarea_id, workspace_id, action, actor_name, icon_name, color)
        VALUES (rec.task_id, rec.workspace_id, 'Recordatorio automático: ' || rec.name,
          'Sistema', 'Bell', 'text-blue-500');
        executed := executed + 1;
      END IF;
    ELSIF rec.action_kind = 'raise_priority' AND rec.prioridad IN ('baja','media') THEN
      UPDATE public.tareas SET prioridad = 'alta' WHERE id = rec.task_id;
      INSERT INTO public.task_history (tarea_id, workspace_id, action, actor_name, icon_name, color)
      VALUES (rec.task_id, rec.workspace_id, 'Prioridad elevada automáticamente: ' || rec.name,
        'Sistema', 'AlertTriangle', 'text-amber-500');
      executed := executed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('executed', executed);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.run_custom_rules() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('docubox-task-custom-rules', '*/30 * * * *',
  'select task_internal.run_custom_rules();');
