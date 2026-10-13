-- A completed, cancelled or rejected task is a historical record. Members may
-- still read its checklist/dependencies and add comments, but cannot rewrite
-- the structure that determined its outcome.
DROP POLICY IF EXISTS task_checklist_insert ON public.task_checklist_items;
DROP POLICY IF EXISTS task_checklist_update ON public.task_checklist_items;
DROP POLICY IF EXISTS task_checklist_delete ON public.task_checklist_items;

CREATE POLICY task_checklist_insert ON public.task_checklist_items FOR INSERT TO authenticated
WITH CHECK (created_by=(select auth.uid()) AND EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND t.estado NOT IN ('completada','cancelada','rechazada')
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));
CREATE POLICY task_checklist_update ON public.task_checklist_items FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND t.estado NOT IN ('completada','cancelada','rechazada')
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND t.estado NOT IN ('completada','cancelada','rechazada')
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));
CREATE POLICY task_checklist_delete ON public.task_checklist_items FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND t.estado NOT IN ('completada','cancelada','rechazada')
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));

DROP POLICY IF EXISTS task_dependencies_insert ON public.task_dependencies;
DROP POLICY IF EXISTS task_dependencies_delete ON public.task_dependencies;
CREATE POLICY task_dependencies_insert ON public.task_dependencies FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_dependencies.workspace_id
    AND t.estado NOT IN ('completada','cancelada','rechazada')
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
    AND EXISTS (SELECT 1 FROM public.tareas parent
      WHERE parent.id=depends_on_id AND parent.workspace_id=t.workspace_id)
));
CREATE POLICY task_dependencies_delete ON public.task_dependencies FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_dependencies.workspace_id
    AND t.estado NOT IN ('completada','cancelada','rechazada')
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));
