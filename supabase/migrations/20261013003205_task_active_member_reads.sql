-- Only active members may read tasks or their detail rows. The detail row must
-- belong to the same workspace as its parent task.
DROP POLICY IF EXISTS workspace_members_select_tareas ON public.tareas;
CREATE POLICY workspace_members_select_tareas ON public.tareas FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.workspace_members member
  WHERE member.workspace_id=tareas.workspace_id AND member.user_id=(select auth.uid())
    AND member.status='active'
));

DROP POLICY IF EXISTS ws_members_select_task_checklist ON public.task_checklist_items;
CREATE POLICY ws_members_select_task_checklist ON public.task_checklist_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas task JOIN public.workspace_members member
    ON member.workspace_id=task.workspace_id AND member.user_id=(select auth.uid())
      AND member.status='active'
  WHERE task.id=task_checklist_items.tarea_id AND task.workspace_id=task_checklist_items.workspace_id
));

DROP POLICY IF EXISTS ws_members_select_task_comments ON public.task_comments;
CREATE POLICY ws_members_select_task_comments ON public.task_comments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas task JOIN public.workspace_members member
    ON member.workspace_id=task.workspace_id AND member.user_id=(select auth.uid())
      AND member.status='active'
  WHERE task.id=task_comments.tarea_id AND task.workspace_id=task_comments.workspace_id
));

DROP POLICY IF EXISTS ws_members_select_task_dependencies ON public.task_dependencies;
CREATE POLICY ws_members_select_task_dependencies ON public.task_dependencies FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas task JOIN public.workspace_members member
    ON member.workspace_id=task.workspace_id AND member.user_id=(select auth.uid())
      AND member.status='active'
  WHERE task.id=task_dependencies.tarea_id AND task.workspace_id=task_dependencies.workspace_id
));

DROP POLICY IF EXISTS ws_members_select_task_history ON public.task_history;
CREATE POLICY ws_members_select_task_history ON public.task_history FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas task JOIN public.workspace_members member
    ON member.workspace_id=task.workspace_id AND member.user_id=(select auth.uid())
      AND member.status='active'
  WHERE task.id=task_history.tarea_id AND task.workspace_id=task_history.workspace_id
));
