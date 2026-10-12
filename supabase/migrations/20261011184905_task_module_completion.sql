-- Additional process signals and a bounded, executable custom-rule vocabulary.
ALTER TABLE public.task_system_rules DROP CONSTRAINT IF EXISTS task_system_rules_rule_key_check;
ALTER TABLE public.task_system_rules ADD CONSTRAINT task_system_rules_rule_key_check
  CHECK (rule_key IN ('draft_stale','document_due','form_invite_pending','case_due','missing_anexo',
    'template_draft_stale','form_draft_stale','identity_pending'));

INSERT INTO public.task_system_rules (workspace_id,rule_key,threshold_days)
SELECT w.id,r.key,r.days FROM public.workspaces w CROSS JOIN
  (VALUES ('template_draft_stale',3),('form_draft_stale',3),('identity_pending',2)) r(key,days)
ON CONFLICT (workspace_id,rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION task_internal.seed_workspace_task_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.task_system_rules (workspace_id,rule_key,threshold_days)
  VALUES (NEW.id,'draft_stale',3),(NEW.id,'document_due',3),
    (NEW.id,'form_invite_pending',2),(NEW.id,'case_due',3),(NEW.id,'missing_anexo',1),
    (NEW.id,'template_draft_stale',3),(NEW.id,'form_draft_stale',3),(NEW.id,'identity_pending',2)
  ON CONFLICT (workspace_id,rule_key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.seed_workspace_task_rules() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION task_internal.reconcile_extended_tasks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE created_count integer := 0; closed_count integer := 0; rec record;
BEGIN
  WITH candidates AS (
    SELECT p.workspace_id,'template_draft_stale'::text rule_key,p.id source_id,
      'template'::text source_type,p.created_by assignee,p.created_by creator,
      ('Continuar plantilla: ' || p.nombre) title,
      'La plantilla sigue en borrador sin cambios recientes.'::text description,
      'revisar_documento'::public.tarea_tipo task_type,
      'media'::public.tarea_prioridad priority,
      (now() + interval '2 days') due_at,'Abrir plantilla'::text action_label
    FROM public.plantillas p JOIN public.task_system_rules r ON r.workspace_id=p.workspace_id
      AND r.rule_key='template_draft_stale' AND r.enabled
    WHERE p.estado IN ('draft','borrador') AND p.created_by IS NOT NULL
      AND p.updated_at <= now()-make_interval(days=>r.threshold_days)
    UNION ALL
    SELECT f.workspace_id,'form_draft_stale',f.id,'form_template',f.created_by,f.created_by,
      ('Continuar formulario: ' || f.name),
      'El formulario sigue en borrador sin cambios recientes.',
      'seguimiento_formulario'::public.tarea_tipo,'media'::public.tarea_prioridad,
      now()+interval '2 days','Abrir formulario'
    FROM public.form_templates f JOIN public.task_system_rules r ON r.workspace_id=f.workspace_id
      AND r.rule_key='form_draft_stale' AND r.enabled
    WHERE f.status='draft' AND f.created_by IS NOT NULL
      AND f.updated_at <= now()-make_interval(days=>r.threshold_days)
    UNION ALL
    SELECT m.workspace_id,'identity_pending',v.user_id,'user',v.user_id,v.user_id,
      'Completar validación de identidad',
      'La cuenta tiene correo verificado, pero falta completar la validación biométrica.',
      'validar_identidad'::public.tarea_tipo,'alta'::public.tarea_prioridad,
      now()+interval '2 days','Abrir perfil'
    FROM public.user_verification_status v
    JOIN public.workspace_members m ON m.user_id=v.user_id AND m.status='active'
    JOIN public.task_system_rules r ON r.workspace_id=m.workspace_id
      AND r.rule_key='identity_pending' AND r.enabled
    WHERE v.email_verified AND NOT COALESCE(v.biometric_verified,false)
      AND v.created_at <= now()-make_interval(days=>r.threshold_days)
  ), inserted AS (
    INSERT INTO public.tareas (workspace_id,automation_key,source_type,source_id,
      assigned_to,created_by,title,description,tipo,prioridad,riesgo,estado,
      due_date,main_action,origin,work_kind,responsible_name,creator_name)
    SELECT c.workspace_id,c.rule_key,c.source_type,c.source_id,c.assignee,c.creator,
      c.title,c.description,c.task_type,c.priority,
      CASE WHEN c.priority='alta' THEN 'medio'::public.tarea_riesgo ELSE 'bajo'::public.tarea_riesgo END,
      'pendiente'::public.tarea_estado,c.due_at,c.action_label,'sistema','accion',
      COALESCE(a.full_name,a.email,'Usuario'),COALESCE(u.full_name,u.email,'Sistema')
    FROM candidates c LEFT JOIN public.user_profiles a ON a.id=c.assignee
      LEFT JOIN public.user_profiles u ON u.id=c.creator
    ON CONFLICT (workspace_id,automation_key,source_id)
      WHERE automation_key IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET estado='pendiente',completed_at=NULL,cancelled_at=NULL,resolution_note=NULL,
      due_date=EXCLUDED.due_date,title=EXCLUDED.title,description=EXCLUDED.description
    WHERE tareas.origin='sistema' AND tareas.estado='completada'
    RETURNING id,workspace_id
  ), audit AS (
    INSERT INTO public.task_history (tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Acción creada o reabierta por una condición real del proceso.',
      'Sistema','Plus','text-blue-500' FROM inserted RETURNING id
  ) SELECT count(*) INTO created_count FROM audit;

  FOR rec IN SELECT t.id,t.workspace_id,t.automation_key FROM public.tareas t
    WHERE t.origin='sistema' AND t.automation_key IN
      ('template_draft_stale','form_draft_stale','identity_pending')
      AND t.estado NOT IN ('completada','cancelada','rechazada')
      AND NOT EXISTS (
        SELECT 1 FROM public.task_system_rules r WHERE r.workspace_id=t.workspace_id
          AND r.rule_key=t.automation_key AND r.enabled AND
          ((t.automation_key='template_draft_stale' AND EXISTS (
            SELECT 1 FROM public.plantillas p WHERE p.id=t.source_id
              AND p.estado IN ('draft','borrador') AND p.updated_at <= now()-make_interval(days=>r.threshold_days)))
          OR (t.automation_key='form_draft_stale' AND EXISTS (
            SELECT 1 FROM public.form_templates f WHERE f.id=t.source_id
              AND f.status='draft' AND f.updated_at <= now()-make_interval(days=>r.threshold_days)))
          OR (t.automation_key='identity_pending' AND EXISTS (
            SELECT 1 FROM public.user_verification_status v
            JOIN public.workspace_members m ON m.user_id=v.user_id AND m.workspace_id=t.workspace_id AND m.status='active'
            WHERE v.user_id=t.source_id AND v.email_verified AND NOT COALESCE(v.biometric_verified,false)
              AND v.created_at <= now()-make_interval(days=>r.threshold_days)))))
  LOOP
    UPDATE public.tareas SET estado='completada',completed_at=now(),is_overdue=false,
      resolution_note='La condición dejó de requerir atención o la regla fue desactivada.' WHERE id=rec.id;
    INSERT INTO public.task_history (tarea_id,workspace_id,action,actor_name,icon_name,color)
    VALUES (rec.id,rec.workspace_id,'Cierre automático: la condición dejó de requerir atención.',
      'Sistema','CheckCircle2','text-green-500');
    closed_count:=closed_count+1;
  END LOOP;
  RETURN jsonb_build_object('created',created_count,'closed',closed_count);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.reconcile_extended_tasks() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('docubox-task-extended','*/30 * * * *',
  'select task_internal.reconcile_extended_tasks();');

ALTER TABLE public.task_custom_rules DROP CONSTRAINT IF EXISTS task_custom_rules_trigger_kind_check;
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_trigger_kind_check
  CHECK (trigger_kind IN ('due_soon','overdue','created','inactive'));
ALTER TABLE public.task_custom_rules DROP CONSTRAINT IF EXISTS task_custom_rules_action_kind_check;
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_action_kind_check
  CHECK (action_kind IN ('notify_assignee','raise_priority','create_followup'));
ALTER TABLE public.task_custom_rules
  ADD COLUMN IF NOT EXISTS priority_filter text CHECK (priority_filter IN ('critica','alta','media','baja')),
  ADD COLUMN IF NOT EXISTS status_filter text CHECK (status_filter IN ('nueva','programada','pendiente','en_proceso','bloqueada','en_revision','vencida','escalada')),
  ADD COLUMN IF NOT EXISTS origin_filter text CHECK (origin_filter IN ('manual','sistema')),
  ADD COLUMN IF NOT EXISTS source_filter text CHECK (source_filter IN
    ('document','form_template','template','case_file','form_response','user','task','form_token','participant_requirement'));

CREATE OR REPLACE FUNCTION task_internal.run_custom_rules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rec record; executed integer:=0; audit_key text; inserted_id uuid;
BEGIN
  FOR rec IN
    SELECT r.*,t.id task_id,t.assigned_to,t.created_by,t.title task_title,t.description task_description,
      t.prioridad,t.estado,t.tipo,t.work_kind task_work_kind,t.source_type,t.source_id,
      t.document_id,t.expediente_id,t.document_name,t.expediente_name,
      t.responsible_name,t.creator_name
    FROM public.task_custom_rules r JOIN public.tareas t ON t.workspace_id=r.workspace_id
      AND t.estado NOT IN ('completada','cancelada','rechazada')
      AND (t.automation_key IS NULL OR t.automation_key NOT LIKE 'custom:%')
      AND (r.task_type IS NULL OR r.task_type=t.tipo::text)
      AND (r.work_kind IS NULL OR r.work_kind=t.work_kind)
      AND (r.priority_filter IS NULL OR r.priority_filter=t.prioridad::text)
      AND (r.status_filter IS NULL OR r.status_filter=t.estado::text)
      AND (r.origin_filter IS NULL OR r.origin_filter=t.origin)
      AND (r.source_filter IS NULL OR r.source_filter=t.source_type)
      AND ((r.trigger_kind='overdue' AND t.due_date<now())
        OR (r.trigger_kind='due_soon' AND t.due_date BETWEEN now() AND now()+make_interval(days=>r.lead_days))
        OR (r.trigger_kind='created' AND t.created_at<=now())
        OR (r.trigger_kind='inactive' AND t.updated_at<=now()-make_interval(days=>r.lead_days)))
    WHERE r.enabled
  LOOP
    IF rec.action_kind='notify_assignee' AND rec.assigned_to IS NOT NULL THEN
      audit_key:='task-rule:'||rec.id||':'||rec.task_id||':'||current_date;
      INSERT INTO public.notifications (user_id,workspace_id,type,title,description,priority,category,
        event_type,severity,entity_type,entity_id,action_url,action_label,idempotency_key)
      VALUES (rec.assigned_to,rec.workspace_id,'task_rule',rec.name,rec.task_title,
        'medium','REMINDER','task.custom_rule','warning','task',rec.task_id,
        '/mis-tareas?task='||rec.task_id,'Ver tarea',audit_key)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.task_history (tarea_id,workspace_id,action,actor_name,icon_name,color)
        VALUES (rec.task_id,rec.workspace_id,'Aviso automático: '||rec.name,'Sistema','Bell','text-blue-500');
        executed:=executed+1;
      END IF;
    ELSIF rec.action_kind='raise_priority' AND rec.prioridad IN ('baja','media') THEN
      UPDATE public.tareas SET prioridad='alta',riesgo='medio' WHERE id=rec.task_id;
      INSERT INTO public.task_history (tarea_id,workspace_id,action,actor_name,icon_name,color)
      VALUES (rec.task_id,rec.workspace_id,'Prioridad elevada automáticamente: '||rec.name,
        'Sistema','AlertTriangle','text-amber-500');
      executed:=executed+1;
    ELSIF rec.action_kind='create_followup' AND rec.assigned_to IS NOT NULL THEN
      INSERT INTO public.tareas (workspace_id,automation_key,source_type,source_id,
        assigned_to,created_by,title,description,tipo,prioridad,riesgo,estado,due_date,
        main_action,origin,work_kind,document_id,expediente_id,document_name,expediente_name,
        responsible_name,creator_name)
      VALUES (rec.workspace_id,'custom:'||rec.id,'task',rec.task_id,
        rec.assigned_to,COALESCE(rec.created_by,rec.assigned_to),'Dar seguimiento: '||rec.task_title,
        'Actividad de seguimiento creada por la automatización '||rec.name,
        rec.tipo,'media','bajo','pendiente',now()+interval '2 days',
        'Abrir tarea original','sistema','actividad',rec.document_id,rec.expediente_id,
        rec.document_name,rec.expediente_name,rec.responsible_name,rec.creator_name)
      ON CONFLICT (workspace_id,automation_key,source_id)
        WHERE automation_key IS NOT NULL AND source_id IS NOT NULL DO NOTHING
      RETURNING id INTO inserted_id;
      IF inserted_id IS NOT NULL THEN
        INSERT INTO public.task_history (tarea_id,workspace_id,action,actor_name,icon_name,color)
        VALUES (inserted_id,rec.workspace_id,'Seguimiento creado automáticamente: '||rec.name,
          'Sistema','Plus','text-blue-500');
        executed:=executed+1;
      END IF;
      inserted_id:=NULL;
    END IF;
  END LOOP;
  WITH closed AS (
    UPDATE public.tareas followup SET estado='completada',completed_at=now(),is_overdue=false,
      resolution_note='La tarea de origen concluyó; seguimiento cerrado automáticamente.'
    FROM public.tareas original
    WHERE followup.source_type='task' AND followup.source_id=original.id
      AND followup.automation_key LIKE 'custom:%'
      AND followup.estado NOT IN ('completada','cancelada','rechazada')
      AND original.estado IN ('completada','cancelada','rechazada')
    RETURNING followup.id,followup.workspace_id
  )
  INSERT INTO public.task_history (tarea_id,workspace_id,action,actor_name,icon_name,color)
  SELECT id,workspace_id,'Cierre automático: la tarea de origen concluyó.',
    'Sistema','CheckCircle2','text-green-500' FROM closed;
  RETURN jsonb_build_object('executed',executed);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.run_custom_rules() FROM PUBLIC,anon,authenticated;
