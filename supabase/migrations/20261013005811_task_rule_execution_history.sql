-- Retain a rule's execution history even if the rule is later removed.
CREATE UNIQUE INDEX task_custom_rules_workspace_name_unique
  ON public.task_custom_rules(workspace_id, lower(name));

CREATE TABLE public.task_rule_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL,
  rule_name text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('notify_assignee','raise_priority','create_followup')),
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_rule_executions_workspace_recent_idx
  ON public.task_rule_executions(workspace_id,occurred_at DESC);
CREATE INDEX task_rule_executions_rule_recent_idx
  ON public.task_rule_executions(rule_id,occurred_at DESC);
ALTER TABLE public.task_rule_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_rule_executions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.task_rule_executions TO authenticated;
CREATE POLICY task_rule_executions_read ON public.task_rule_executions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.workspace_members member
  WHERE member.workspace_id=task_rule_executions.workspace_id
    AND member.user_id=(SELECT auth.uid()) AND member.status='active'
));

CREATE OR REPLACE FUNCTION task_internal.record_custom_rule_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE matched_rule record; rule_text text; target_id uuid; target_type text;
  action_name text; event_key text; parts text[];
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
    event_key:='task-priority:'||NEW.id::text;
  END IF;
  IF matched_rule.id IS NOT NULL AND target_id IS NOT NULL THEN
    INSERT INTO public.task_rule_executions(workspace_id,rule_id,rule_name,target_type,target_id,action_kind,idempotency_key)
    VALUES(matched_rule.workspace_id,matched_rule.id,matched_rule.name,target_type,target_id,action_name,event_key)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.record_custom_rule_execution() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_rule_notification_execution AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION task_internal.record_custom_rule_execution();
CREATE TRIGGER task_rule_followup_execution AFTER INSERT OR UPDATE OF estado ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION task_internal.record_custom_rule_execution();
CREATE TRIGGER task_rule_priority_execution AFTER INSERT ON public.task_history
  FOR EACH ROW EXECUTE FUNCTION task_internal.record_custom_rule_execution();
