-- System-created actions still need an assignment notification even when the
-- resource owner is stored as both assignee and creator.
CREATE OR REPLACE FUNCTION task_internal.notify_normal_task_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (NEW.assigned_to IS DISTINCT FROM NEW.created_by OR NEW.origin='sistema')
     AND NEW.prioridad IN ('media','baja')
     AND NEW.estado NOT IN ('completada','cancelada','rechazada')
     AND EXISTS (SELECT 1 FROM public.workspace_members member
       WHERE member.workspace_id=NEW.workspace_id AND member.user_id=NEW.assigned_to
         AND member.status='active') THEN
    INSERT INTO public.notifications(user_id,workspace_id,type,title,description,priority,category,
      event_type,severity,entity_type,entity_id,action_url,action_label,actor_user_id,idempotency_key)
    VALUES(NEW.assigned_to,NEW.workspace_id,'task_assigned','Nueva tarea asignada',NEW.title,
      'medium','WORKFLOW','task.assigned','info','task',NEW.id,
      '/mis-tareas?task='||NEW.id::text,'Ver tarea',NEW.created_by,
      'task-assigned:'||NEW.id::text||':'||NEW.assigned_to::text)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.notify_normal_task_assignment() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION task_internal.notify_task_state_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE recipient uuid; heading text; level text;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN RETURN NEW; END IF;
  IF NEW.estado='vencida' THEN
    recipient:=NEW.assigned_to; heading:='Tarea vencida'; level:='warning';
  ELSIF NEW.estado='bloqueada' THEN
    recipient:=NEW.assigned_to; heading:='Tarea bloqueada'; level:='warning';
  ELSIF NEW.estado='completada' AND NEW.created_by IS DISTINCT FROM NEW.assigned_to THEN
    recipient:=NEW.created_by; heading:='Tarea completada'; level:='success';
  ELSIF NEW.estado='cancelada' AND NEW.assigned_to IS DISTINCT FROM NEW.created_by THEN
    recipient:=NEW.assigned_to; heading:='Tarea cancelada'; level:='info';
  ELSE RETURN NEW;
  END IF;
  IF recipient IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id=NEW.workspace_id AND member.user_id=recipient
      AND member.status='active') THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(user_id,workspace_id,type,title,description,priority,
    category,event_type,severity,entity_type,entity_id,action_url,action_label,idempotency_key)
  VALUES(recipient,NEW.workspace_id,'task_state',heading,NEW.title,
    CASE WHEN NEW.estado='vencida' THEN 'high' ELSE 'medium' END,
    'WORKFLOW','task.'||NEW.estado,level,'task',NEW.id,
    '/mis-tareas?task='||NEW.id::text,'Ver tarea',
    'task-state:'||NEW.id::text||':'||NEW.estado::text||':'||recipient::text)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.notify_task_state_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_state_notification AFTER UPDATE OF estado ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION task_internal.notify_task_state_change();
