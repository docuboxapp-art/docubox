ALTER TABLE public.task_rule_executions ADD COLUMN target_name text;
COMMENT ON COLUMN public.task_rule_executions.target_name IS 'Nombre visible del recurso en el momento de la ejecución';
CREATE OR REPLACE FUNCTION task_internal.record_custom_rule_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE matched_rule record; rule_text text; target_id uuid; target_type text;
  action_name text; event_key text; target_name text; parts text[];
BEGIN
  IF TG_TABLE_NAME='notifications' THEN
    IF NEW.idempotency_key IS NULL OR NOT (
      NEW.idempotency_key LIKE 'task-rule:%' OR NEW.idempotency_key LIKE 'task-rule-extra:%'
      OR NEW.idempotency_key LIKE 'task-resource:%' OR NEW.idempotency_key LIKE 'task-resource-extra:%'
    ) THEN RETURN NEW; END IF;
    parts:=string_to_array(NEW.idempotency_key,':');
    rule_text:=parts[2];
    IF rule_text IS NULL OR rule_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN RETURN NEW; END IF;
    target_id:=NEW.entity_id;
    target_type:=COALESCE(NEW.entity_type,'task');
    action_name:='notify_assignee';
    target_name:=NEW.description;
    event_key:='notification:'||NEW.id::text;
    SELECT id,workspace_id,name INTO matched_rule FROM public.task_custom_rules
      WHERE id=rule_text::uuid AND workspace_id=NEW.workspace_id;
  ELSIF TG_TABLE_NAME='tareas' THEN
    IF NEW.origin<>'sistema' OR NEW.automation_key IS NULL OR
      NEW.automation_key NOT LIKE 'custom:%' OR NEW.source_id IS NULL OR
      NEW.estado IN ('completada','cancelada','rechazada') THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.estado NOT IN ('completada','cancelada','rechazada') THEN RETURN NEW; END IF;
    END IF;
    rule_text:=substring(NEW.automation_key from 8);
    IF rule_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN RETURN NEW; END IF;
    target_id:=NEW.source_id;
    target_type:=NEW.source_type;
    action_name:='create_followup';
    target_name:=NEW.title;
    event_key:='task-followup:'||NEW.id::text||':'||NEW.updated_at::text;
    SELECT id,workspace_id,name INTO matched_rule FROM public.task_custom_rules
      WHERE id=rule_text::uuid AND workspace_id=NEW.workspace_id;
  ELSE
    IF NEW.action NOT LIKE 'Prioridad elevada automáticamente: %' THEN RETURN NEW; END IF;
    SELECT id,workspace_id,name INTO matched_rule FROM public.task_custom_rules
      WHERE workspace_id=NEW.workspace_id
        AND name=substring(NEW.action from char_length('Prioridad elevada automáticamente: ')+1)
        AND (action_kind='raise_priority' OR 'raise_priority'=ANY(additional_action_kinds));
    target_id:=NEW.tarea_id;
    target_type:='task';
    action_name:='raise_priority';
    SELECT title INTO target_name FROM public.tareas WHERE id=NEW.tarea_id;
    event_key:='task-priority:'||NEW.id::text;
  END IF;
  IF matched_rule.id IS NOT NULL AND target_id IS NOT NULL THEN
    INSERT INTO public.task_rule_executions(workspace_id,rule_id,rule_name,target_type,target_id,target_name,action_kind,idempotency_key)
    VALUES(matched_rule.workspace_id,matched_rule.id,matched_rule.name,target_type,target_id,target_name,action_name,event_key)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION task_internal.record_custom_rule_execution() FROM PUBLIC,anon,authenticated;
