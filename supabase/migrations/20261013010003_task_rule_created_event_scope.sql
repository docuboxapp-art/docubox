-- Created-event rules only observe tasks created after the rule itself.
-- A created-event notification fires once per task; other triggers may remind daily.
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
        OR (r.trigger_kind='created' AND t.created_at>=r.created_at AND t.created_at<=now())
        OR (r.trigger_kind='inactive' AND t.updated_at<=now()-make_interval(days=>r.lead_days)))
    WHERE r.enabled
  LOOP
    IF rec.action_kind='notify_assignee' AND rec.assigned_to IS NOT NULL THEN
      audit_key:='task-rule:'||rec.id||':'||rec.task_id||':'||CASE WHEN rec.trigger_kind='created' THEN 'created' ELSE current_date::text END;
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
CREATE OR REPLACE FUNCTION task_internal.run_additional_rule_actions()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rec record; executed integer := 0; inserted_id uuid; audit_key text;
BEGIN
  FOR rec IN
    SELECT r.id rule_id,r.workspace_id,r.name rule_name,r.created_by rule_creator,r.trigger_kind,
      extra.action_kind,t.id task_id,t.assigned_to,t.title task_title,
      t.prioridad,t.tipo,t.document_id,t.expediente_id,t.document_name,
      t.expediente_name,t.responsible_name,t.creator_name
    FROM public.task_custom_rules r
    JOIN public.tareas t ON t.workspace_id=r.workspace_id
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
        OR (r.trigger_kind='created' AND t.created_at>=r.created_at AND t.created_at<=now())
        OR (r.trigger_kind='inactive' AND t.updated_at<=now()-make_interval(days=>r.lead_days)))
    CROSS JOIN LATERAL unnest(r.additional_action_kinds) AS extra(action_kind)
    WHERE r.enabled AND r.target_kind='task'
  LOOP
    IF rec.action_kind='notify_assignee' AND rec.assigned_to IS NOT NULL THEN
      audit_key:='task-rule-extra:'||rec.rule_id||':'||rec.task_id||':'||CASE WHEN rec.trigger_kind='created' THEN 'created' ELSE current_date::text END;
      INSERT INTO public.notifications(user_id,workspace_id,type,title,description,priority,
        category,event_type,severity,entity_type,entity_id,action_url,action_label,idempotency_key)
      VALUES(rec.assigned_to,rec.workspace_id,'task_rule',rec.rule_name,rec.task_title,
        'medium','REMINDER','task.custom_rule','warning','task',rec.task_id,
        '/mis-tareas?task='||rec.task_id,'Ver tarea',audit_key)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN
        INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
        VALUES(rec.task_id,rec.workspace_id,'Aviso automático: '||rec.rule_name,
          'Sistema','Bell','text-blue-500');
        executed:=executed+1;
      END IF;
    ELSIF rec.action_kind='raise_priority' AND rec.prioridad IN ('baja','media') THEN
      UPDATE public.tareas SET prioridad='alta',riesgo='medio' WHERE id=rec.task_id;
      INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
      VALUES(rec.task_id,rec.workspace_id,'Prioridad elevada automáticamente: '||rec.rule_name,
        'Sistema','AlertTriangle','text-amber-500');
      executed:=executed+1;
    ELSIF rec.action_kind='create_followup' AND rec.assigned_to IS NOT NULL THEN
      INSERT INTO public.tareas(workspace_id,automation_key,source_type,source_id,
        assigned_to,created_by,title,description,tipo,prioridad,riesgo,estado,due_date,
        main_action,origin,work_kind,document_id,expediente_id,document_name,expediente_name,
        responsible_name,creator_name)
      VALUES(rec.workspace_id,'custom:'||rec.rule_id,'task',rec.task_id,
        rec.assigned_to,COALESCE(rec.rule_creator,rec.assigned_to),'Dar seguimiento: '||rec.task_title,
        'Actividad de seguimiento creada por la automatización '||rec.rule_name,
        rec.tipo,'media','bajo','pendiente',now()+interval '2 days',
        'Abrir tarea original','sistema','actividad',rec.document_id,rec.expediente_id,
        rec.document_name,rec.expediente_name,rec.responsible_name,rec.creator_name)
      ON CONFLICT (workspace_id,automation_key,source_id)
        WHERE automation_key IS NOT NULL AND source_id IS NOT NULL DO NOTHING
      RETURNING id INTO inserted_id;
      IF inserted_id IS NOT NULL THEN
        INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
        VALUES(inserted_id,rec.workspace_id,'Seguimiento creado automáticamente: '||rec.rule_name,
          'Sistema','Plus','text-blue-500');
        executed:=executed+1;
      END IF;
      inserted_id:=NULL;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT matched.*,rule.additional_action_kinds
    FROM task_internal.match_resource_rules() matched
    JOIN public.task_custom_rules rule ON rule.id=matched.rule_id
  LOOP
    IF 'notify_assignee' = ANY(rec.additional_action_kinds) THEN
      audit_key:='task-resource-extra:'||rec.rule_id||':'||rec.source_id;
      INSERT INTO public.notifications(user_id,workspace_id,type,title,description,priority,
        category,event_type,severity,entity_type,entity_id,action_url,action_label,idempotency_key)
      VALUES(rec.assigned_to,rec.workspace_id,'task_rule',rec.rule_name,
        rec.resource_name||' · '||COALESCE(rec.resource_status,'Revisar'),
        CASE WHEN rec.generated_priority IN ('critica','alta') THEN 'high' ELSE 'medium' END,
        'REMINDER','task.resource_rule','warning',rec.source_type,rec.source_id,
        rec.action_url,'Abrir recurso',audit_key)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN executed:=executed+1; END IF;
    END IF;
    IF 'create_followup' = ANY(rec.additional_action_kinds) THEN
      INSERT INTO public.tareas(workspace_id,automation_key,source_type,source_id,
        assigned_to,created_by,title,description,tipo,prioridad,riesgo,estado,due_date,
        main_action,origin,work_kind,document_id,expediente_id,document_name,expediente_name,
        responsible_name,creator_name,is_critical)
      SELECT rec.workspace_id,'custom:'||rec.rule_id,rec.source_type,rec.source_id,
        rec.assigned_to,rec.rule_creator,'Atender '||rec.source_type||': '||rec.resource_name,
        'Acción creada por la automatización '||rec.rule_name||'. Estado del recurso: '||
          COALESCE(rec.resource_status,'sin estado')||'.',
        rec.generated_task_type,rec.generated_priority,
        CASE WHEN rec.generated_priority='critica' THEN 'alto'::public.tarea_riesgo
          WHEN rec.generated_priority='alta' THEN 'medio'::public.tarea_riesgo
          ELSE 'bajo'::public.tarea_riesgo END,
        'pendiente'::public.tarea_estado,
        CASE WHEN rec.due_at>now() THEN rec.due_at ELSE now()+interval '2 days' END,
        'Abrir recurso','sistema','accion',
        CASE WHEN rec.source_type='document' THEN rec.source_id::text END,
        CASE WHEN rec.source_type='case_file' THEN rec.source_id::text END,
        CASE WHEN rec.source_type='document' THEN rec.resource_name END,
        CASE WHEN rec.source_type='case_file' THEN rec.resource_name END,
        COALESCE(assignee.full_name,assignee.email,'Usuario'),
        COALESCE(creator.full_name,creator.email,'Sistema'),rec.generated_priority='critica'
      FROM public.user_profiles assignee
      LEFT JOIN public.user_profiles creator ON creator.id=rec.rule_creator
      WHERE assignee.id=rec.assigned_to
      ON CONFLICT (workspace_id,automation_key,source_id)
        WHERE automation_key IS NOT NULL AND source_id IS NOT NULL
      DO UPDATE SET estado='pendiente',completed_at=NULL,cancelled_at=NULL,
        resolution_note=NULL,due_date=EXCLUDED.due_date
      WHERE tareas.origin='sistema' AND tareas.estado='completada'
        AND rec.condition_kind<>'created'
      RETURNING id INTO inserted_id;
      IF inserted_id IS NOT NULL THEN
        INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
        VALUES(inserted_id,rec.workspace_id,'Acción creada por una automatización de recursos.',
          'Sistema','Plus','text-blue-500');
        executed:=executed+1;
      END IF;
      inserted_id:=NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('executed',executed);
END;
$$;

REVOKE ALL ON FUNCTION task_internal.run_additional_rule_actions() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.preview_task_custom_rule(p_rule_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rule_row public.task_custom_rules%ROWTYPE; total_matches bigint := 0;
  examples jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO rule_row FROM public.task_custom_rules WHERE id=p_rule_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id=rule_row.workspace_id
      AND member.user_id=(SELECT auth.uid()) AND member.status='active'
  ) THEN
    RAISE EXCEPTION 'Regla no disponible para este espacio.' USING ERRCODE='42501';
  END IF;
  IF NOT rule_row.enabled THEN
    RETURN jsonb_build_object('total',0,'examples','[]'::jsonb,'disabled',true);
  END IF;
  IF rule_row.target_kind='task' THEN
    WITH matches AS (
      SELECT t.id,t.title,t.estado::text status,count(*) OVER() match_count
      FROM public.tareas t WHERE t.workspace_id=rule_row.workspace_id
        AND t.estado NOT IN ('completada','cancelada','rechazada')
        AND (t.automation_key IS NULL OR t.automation_key NOT LIKE 'custom:%')
        AND (rule_row.task_type IS NULL OR rule_row.task_type=t.tipo::text)
        AND (rule_row.work_kind IS NULL OR rule_row.work_kind=t.work_kind)
        AND (rule_row.priority_filter IS NULL OR rule_row.priority_filter=t.prioridad::text)
        AND (rule_row.status_filter IS NULL OR rule_row.status_filter=t.estado::text)
        AND (rule_row.origin_filter IS NULL OR rule_row.origin_filter=t.origin)
        AND (rule_row.source_filter IS NULL OR rule_row.source_filter=t.source_type)
        AND ((rule_row.trigger_kind='overdue' AND t.due_date<now())
          OR (rule_row.trigger_kind='due_soon' AND t.due_date BETWEEN now() AND now()+make_interval(days=>rule_row.lead_days))
          OR (rule_row.trigger_kind='created' AND t.created_at>=rule_row.created_at AND t.created_at<=now())
          OR (rule_row.trigger_kind='inactive' AND t.updated_at<=now()-make_interval(days=>rule_row.lead_days)))
    )
    SELECT COALESCE(max(sample.match_count),0),
      COALESCE(jsonb_agg(jsonb_build_object('id',sample.id,'title',sample.title,'status',sample.status)), '[]'::jsonb)
    INTO total_matches,examples FROM (SELECT * FROM matches ORDER BY title,id LIMIT 10) sample;
  ELSE
    WITH matches AS (
      SELECT m.source_id id,m.resource_name title,m.resource_status status,count(*) OVER() match_count
      FROM task_internal.match_resource_rules() m WHERE m.rule_id=p_rule_id
    )
    SELECT COALESCE(max(sample.match_count),0),
      COALESCE(jsonb_agg(jsonb_build_object('id',sample.id,'title',sample.title,'status',sample.status)), '[]'::jsonb)
    INTO total_matches,examples FROM (SELECT * FROM matches ORDER BY title,id LIMIT 10) sample;
  END IF;
  RETURN jsonb_build_object('total',total_matches,'examples',examples,'disabled',false);
END;
$$;

REVOKE ALL ON FUNCTION public.preview_task_custom_rule(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_task_custom_rule(uuid) TO authenticated;
