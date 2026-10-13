-- Task writes go through authenticated server routes. Workspace membership alone
-- must never authorize changing a task's owner, assignee, status or audit trail.
DROP POLICY IF EXISTS workspace_members_insert_tareas ON public.tareas;
DROP POLICY IF EXISTS workspace_members_update_tareas ON public.tareas;
DROP POLICY IF EXISTS workspace_members_delete_tareas ON public.tareas;
REVOKE INSERT, UPDATE, DELETE ON public.tareas FROM PUBLIC, anon, authenticated;

-- Detail edits remain available to the assignee, creator and workspace admins.
-- Every policy verifies the parent task and its workspace, so a caller cannot
-- attach a child row to a task in a different workspace.
DROP POLICY IF EXISTS ws_members_insert_task_checklist ON public.task_checklist_items;
DROP POLICY IF EXISTS ws_members_update_task_checklist ON public.task_checklist_items;
DROP POLICY IF EXISTS ws_members_delete_task_checklist ON public.task_checklist_items;
CREATE POLICY task_checklist_insert ON public.task_checklist_items FOR INSERT TO authenticated
WITH CHECK (created_by = (select auth.uid()) AND EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));
CREATE POLICY task_checklist_update ON public.task_checklist_items FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));
CREATE POLICY task_checklist_delete ON public.task_checklist_items FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_checklist_items.workspace_id
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));

DROP POLICY IF EXISTS ws_members_insert_task_comments ON public.task_comments;
DROP POLICY IF EXISTS ws_members_update_task_comments ON public.task_comments;
DROP POLICY IF EXISTS ws_members_delete_task_comments ON public.task_comments;
CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT TO authenticated
WITH CHECK (author_id=(select auth.uid()) AND EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_comments.workspace_id
));
CREATE POLICY task_comments_delete ON public.task_comments FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_comments.workspace_id
    AND (author_id=(select auth.uid()) OR m.role IN ('owner','admin'))
));

DROP POLICY IF EXISTS ws_members_insert_task_dependencies ON public.task_dependencies;
DROP POLICY IF EXISTS ws_members_delete_task_dependencies ON public.task_dependencies;
CREATE POLICY task_dependencies_insert ON public.task_dependencies FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_dependencies.workspace_id
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
    AND EXISTS (SELECT 1 FROM public.tareas parent
      WHERE parent.id=depends_on_id AND parent.workspace_id=t.workspace_id)
));
CREATE POLICY task_dependencies_delete ON public.task_dependencies FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.tareas t JOIN public.workspace_members m
    ON m.workspace_id=t.workspace_id AND m.user_id=(select auth.uid()) AND m.status='active'
  WHERE t.id=tarea_id AND t.workspace_id=task_dependencies.workspace_id
    AND (t.assigned_to=(select auth.uid()) OR t.created_by=(select auth.uid()) OR m.role IN ('owner','admin'))
));

-- Only trusted server code and database triggers may write audit entries.
DROP POLICY IF EXISTS ws_members_insert_task_history ON public.task_history;
REVOKE INSERT, UPDATE, DELETE ON public.task_history FROM PUBLIC, anon, authenticated;

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
CREATE TRIGGER task_checklist_audit AFTER INSERT OR UPDATE OF done OR DELETE ON public.task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION task_internal.audit_task_detail_change();
CREATE TRIGGER task_comments_audit AFTER INSERT OR DELETE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION task_internal.audit_task_detail_change();
CREATE TRIGGER task_dependencies_audit AFTER INSERT OR DELETE ON public.task_dependencies
  FOR EACH ROW EXECUTE FUNCTION task_internal.audit_task_detail_change();

-- Postponing an overdue task restores an actionable state immediately.
CREATE OR REPLACE FUNCTION task_internal.refresh_task_due_state()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.due_date IS DISTINCT FROM OLD.due_date AND NEW.estado='vencida'
     AND (NEW.due_date IS NULL OR NEW.due_date>=now()) THEN
    NEW.estado:='pendiente';
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.is_overdue:=NEW.due_date IS NOT NULL AND NEW.due_date<now()
      AND NEW.estado NOT IN ('completada','cancelada','rechazada');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.refresh_task_due_state() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_due_state BEFORE UPDATE OF due_date ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION task_internal.refresh_task_due_state();

-- High-priority creation is already covered by task_attention_notification.
CREATE OR REPLACE FUNCTION task_internal.notify_normal_task_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM NEW.created_by
     AND NEW.prioridad IN ('media','baja') AND NEW.estado NOT IN ('completada','cancelada','rechazada') THEN
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
CREATE TRIGGER task_normal_assignment AFTER INSERT ON public.tareas
  FOR EACH ROW EXECUTE FUNCTION task_internal.notify_normal_task_assignment();

-- A form response stalled in signing needs a real follow-up for its owner.
ALTER TABLE public.task_system_rules DROP CONSTRAINT task_system_rules_rule_key_check;
ALTER TABLE public.task_system_rules ADD CONSTRAINT task_system_rules_rule_key_check
  CHECK (rule_key IN ('draft_stale','document_due','form_invite_pending','case_due','missing_anexo',
    'template_draft_stale','form_draft_stale','identity_pending','form_signing_stale'));
INSERT INTO public.task_system_rules(workspace_id,rule_key,threshold_days)
SELECT id,'form_signing_stale',1 FROM public.workspaces
ON CONFLICT (workspace_id,rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION task_internal.seed_workspace_task_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.task_system_rules(workspace_id,rule_key,threshold_days)
  VALUES (NEW.id,'draft_stale',3),(NEW.id,'document_due',3),
    (NEW.id,'form_invite_pending',2),(NEW.id,'case_due',3),(NEW.id,'missing_anexo',1),
    (NEW.id,'template_draft_stale',3),(NEW.id,'form_draft_stale',3),(NEW.id,'identity_pending',2),
    (NEW.id,'form_signing_stale',1)
  ON CONFLICT (workspace_id,rule_key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.seed_workspace_task_rules() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION task_internal.reconcile_stalled_form_signatures()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE created_count integer:=0; closed_count integer:=0;
BEGIN
  WITH created AS (
    INSERT INTO public.tareas(workspace_id,automation_key,source_type,source_id,
      assigned_to,created_by,title,description,tipo,prioridad,riesgo,estado,due_date,
      main_action,origin,work_kind,responsible_name,creator_name)
    SELECT response.workspace_id,'form_signing_stale','form_response',response.id,
      form.created_by,form.created_by,'Dar seguimiento a firma: '||form.name,
      'La respuesta fue enviada, pero su firma sigue pendiente. Revisa el estado y contacta al participante si hace falta.',
      'seguimiento_formulario'::public.tarea_tipo,'media'::public.tarea_prioridad,
      'bajo'::public.tarea_riesgo,'pendiente'::public.tarea_estado,
      now()+interval '2 days','Ver respuesta','sistema','accion',
      COALESCE(profile.full_name,profile.email,'Usuario'),
      COALESCE(profile.full_name,profile.email,'Usuario')
    FROM public.form_responses response
    JOIN public.form_templates form ON form.id=response.template_id
      AND form.workspace_id=response.workspace_id
    JOIN public.task_system_rules rule ON rule.workspace_id=response.workspace_id
      AND rule.rule_key='form_signing_stale' AND rule.enabled
    LEFT JOIN public.user_profiles profile ON profile.id=form.created_by
    WHERE response.status='signing' AND form.created_by IS NOT NULL
      AND COALESCE(response.submitted_at,response.draft_saved_at) <= now()-make_interval(days=>rule.threshold_days)
    ON CONFLICT (workspace_id,automation_key,source_id)
      WHERE automation_key IS NOT NULL AND source_id IS NOT NULL DO NOTHING
    RETURNING id,workspace_id
  ), audit AS (
    INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Seguimiento creado: firma de formulario pendiente.',
      'Sistema','Plus','text-blue-500' FROM created RETURNING id
  ) SELECT count(*) INTO created_count FROM audit;

  WITH closed AS (
    UPDATE public.tareas task SET estado='completada',completed_at=now(),is_overdue=false,
      resolution_note='Cierre automático: la respuesta dejó de estar pendiente de firma o se desactivó la regla.'
    WHERE task.origin='sistema' AND task.automation_key='form_signing_stale'
      AND task.estado NOT IN ('completada','cancelada','rechazada')
      AND NOT EXISTS (
        SELECT 1 FROM public.form_responses response
        JOIN public.task_system_rules rule ON rule.workspace_id=response.workspace_id
          AND rule.rule_key='form_signing_stale' AND rule.enabled
        WHERE response.id=task.source_id AND response.workspace_id=task.workspace_id
          AND response.status='signing'
          AND COALESCE(response.submitted_at,response.draft_saved_at) <= now()-make_interval(days=>rule.threshold_days)
      ) RETURNING id,workspace_id
  ), audit AS (
    INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Cierre automático: la firma dejó de estar pendiente.',
      'Sistema','CheckCircle2','text-green-500' FROM closed RETURNING id
  ) SELECT count(*) INTO closed_count FROM audit;
  RETURN jsonb_build_object('created',created_count,'closed',closed_count);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.reconcile_stalled_form_signatures() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('docubox-task-form-signatures','*/30 * * * *',
  'select task_internal.reconcile_stalled_form_signatures();');

-- Alert workspace administrators if a task reconciliation stops succeeding.
CREATE OR REPLACE FUNCTION task_internal.monitor_task_crons()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sent_count integer:=0;
BEGIN
  WITH unhealthy AS (
    SELECT job.jobname FROM cron.job job
    WHERE job.jobname IN ('docubox-task-reconcile','docubox-task-extended',
      'docubox-task-custom-rules','docubox-task-resource-rules','docubox-task-form-signatures')
      AND (NOT job.active OR NOT EXISTS (
        SELECT 1 FROM cron.job_run_details run
        WHERE run.jobid=job.jobid AND run.status='succeeded'
          AND run.start_time>now()-interval '90 minutes'))
  ), inserted AS (
    INSERT INTO public.notifications(user_id,workspace_id,type,title,description,priority,
      category,event_type,severity,action_url,action_label,idempotency_key)
    SELECT member.user_id,member.workspace_id,'task_automation_health',
      'Automatización de tareas sin ejecución reciente',
      'Revisa la ejecución programada '||unhealthy.jobname||'.',
      'high','SYSTEM','task.automation_failed','warning',
      '/mis-tareas/automatizaciones','Ver automatizaciones',
      'task-cron:'||unhealthy.jobname||':'||member.workspace_id::text||':'||member.user_id::text||':'||current_date::text
    FROM unhealthy CROSS JOIN public.workspace_members member
    WHERE member.status='active' AND member.role IN ('owner','admin')
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id
  ) SELECT count(*) INTO sent_count FROM inserted;
  RETURN sent_count;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.monitor_task_crons() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('docubox-task-health','15 * * * *',
  'select task_internal.monitor_task_crons();');
