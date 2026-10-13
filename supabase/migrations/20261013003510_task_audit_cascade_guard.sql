-- Cascading deletion of a task also deletes its details. Do not insert a new
-- history row after the parent task has already disappeared.
CREATE OR REPLACE FUNCTION task_internal.audit_task_detail_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task_id uuid; scope_id uuid; description text; icon text; actor uuid; actor_name text;
BEGIN
  IF TG_OP='DELETE' THEN
    task_id:=OLD.tarea_id;
    scope_id:=OLD.workspace_id;
  ELSE
    task_id:=NEW.tarea_id;
    scope_id:=NEW.workspace_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tareas WHERE id=task_id AND workspace_id=scope_id) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  actor:=(select auth.uid());
  SELECT COALESCE(full_name,email,'Usuario') INTO actor_name FROM public.user_profiles WHERE id=actor;
  IF TG_TABLE_NAME='task_checklist_items' THEN
    description:=CASE TG_OP WHEN 'INSERT' THEN 'Elemento agregado al checklist' WHEN 'DELETE' THEN 'Elemento eliminado del checklist'
      ELSE CASE WHEN NEW.done THEN 'Elemento completado en el checklist' ELSE 'Elemento reabierto en el checklist' END END;
    icon:='CheckCircle2';
  ELSIF TG_TABLE_NAME='task_comments' THEN
    description:=CASE WHEN TG_OP='INSERT' THEN 'Comentario agregado' ELSE 'Comentario eliminado' END;
    icon:='MessageSquare';
  ELSE
    description:=CASE WHEN TG_OP='INSERT' THEN 'Dependencia agregada' ELSE 'Dependencia eliminada' END;
    icon:='Link2';
  END IF;
  INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_id,actor_name,icon_name,color)
  VALUES(task_id,scope_id,description,actor,COALESCE(actor_name,'Sistema'),icon,'text-blue-500');
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.audit_task_detail_change() FROM PUBLIC,anon,authenticated;
