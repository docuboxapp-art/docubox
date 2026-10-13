-- Dependencies must stay in one workspace and must not form a cycle that
-- would make all involved actions impossible to complete.
CREATE OR REPLACE FUNCTION task_internal.validate_task_dependency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.tarea_id=NEW.depends_on_id THEN
    RAISE EXCEPTION 'Una tarea no puede depender de sí misma.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tareas task JOIN public.tareas parent
      ON parent.id=NEW.depends_on_id AND parent.workspace_id=task.workspace_id
    WHERE task.id=NEW.tarea_id AND task.workspace_id=NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Las tareas vinculadas deben pertenecer al mismo espacio.' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE upstream(id,path) AS (
      SELECT NEW.depends_on_id,ARRAY[NEW.depends_on_id]
      UNION ALL
      SELECT edge.depends_on_id,upstream.path||edge.depends_on_id
      FROM upstream JOIN public.task_dependencies edge ON edge.tarea_id=upstream.id
      WHERE edge.id IS DISTINCT FROM NEW.id
        AND NOT edge.depends_on_id=ANY(upstream.path)
    ) SELECT 1 FROM upstream WHERE id=NEW.tarea_id
  ) THEN
    RAISE EXCEPTION 'Esta dependencia formaría un ciclo entre tareas.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.validate_task_dependency() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_dependency_integrity BEFORE INSERT OR UPDATE OF tarea_id,depends_on_id,workspace_id
  ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION task_internal.validate_task_dependency();
