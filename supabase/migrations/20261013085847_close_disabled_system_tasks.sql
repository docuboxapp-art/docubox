-- Turning off a system rule must also retire the open tasks it generated.
-- The original five-rule reconciler only checked the resource condition when closing.
CREATE OR REPLACE FUNCTION task_internal.close_disabled_system_tasks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE closed_count integer := 0;
BEGIN
  WITH closed AS (
    UPDATE public.tareas task
    SET estado = 'completada', completed_at = now(), is_overdue = false,
      resolution_note = 'Cierre automático: se desactivó la regla del sistema que generó esta tarea.'
    FROM public.task_system_rules rule
    WHERE task.origin = 'sistema'
      AND task.workspace_id = rule.workspace_id
      AND task.automation_key = rule.rule_key
      AND NOT rule.enabled
      AND task.estado NOT IN ('completada', 'cancelada', 'rechazada')
    RETURNING task.id, task.workspace_id
  ), audit AS (
    INSERT INTO public.task_history(tarea_id, workspace_id, action, actor_name, icon_name, color)
    SELECT id, workspace_id, 'Cierre automático: se desactivó la regla del sistema.',
      'Sistema', 'CheckCircle2', 'text-green-500'
    FROM closed
    RETURNING id
  ) SELECT count(*) INTO closed_count FROM audit;
  RETURN closed_count;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.close_disabled_system_tasks() FROM PUBLIC, anon, authenticated;

-- The existing 30-minute pipeline already runs for every workspace; reuse it
-- instead of adding another concurrent cron job.
CREATE OR REPLACE FUNCTION task_internal.run_custom_rule_pipeline()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE primary_result jsonb; additional_result jsonb; resource_result jsonb;
  flow_result jsonb; disabled_count integer;
BEGIN
  primary_result := task_internal.run_custom_rules();
  additional_result := task_internal.run_additional_rule_actions();
  resource_result := task_internal.reconcile_resource_rules();
  flow_result := task_internal.run_task_rule_workflow_stages();
  disabled_count := task_internal.close_disabled_system_tasks();
  RETURN jsonb_build_object('primary', primary_result, 'additional', additional_result,
    'resources', resource_result, 'workflow', flow_result,
    'disabled_system_tasks_closed', disabled_count);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.run_custom_rule_pipeline() FROM PUBLIC, anon, authenticated;
