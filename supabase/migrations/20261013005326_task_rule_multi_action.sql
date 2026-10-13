-- A rule can perform several independent, idempotent actions on the same match.
-- Existing single-action rules keep their current behavior.
ALTER TABLE public.task_custom_rules
  ADD COLUMN additional_action_kinds text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.task_custom_rules
  ADD CONSTRAINT task_custom_rules_additional_actions_check CHECK (
    additional_action_kinds <@ ARRAY['notify_assignee','raise_priority','create_followup']::text[]
    AND cardinality(additional_action_kinds) <= 2
    AND cardinality(array_positions(additional_action_kinds,'notify_assignee')) <= 1
    AND cardinality(array_positions(additional_action_kinds,'raise_priority')) <= 1
    AND cardinality(array_positions(additional_action_kinds,'create_followup')) <= 1
    AND NOT (action_kind = ANY(additional_action_kinds))
    AND (target_kind = 'task' OR NOT ('raise_priority' = ANY(additional_action_kinds)))
  );

CREATE OR REPLACE FUNCTION task_internal.run_additional_rule_actions()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rec record; executed integer := 0; inserted_id uuid; audit_key text;
BEGIN
  FOR rec IN
    SELECT r.id rule_id,r.workspace_id,r.name rule_name,r.created_by rule_creator,
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
        OR (r.trigger_kind='created' AND t.created_at<=now())
        OR (r.trigger_kind='inactive' AND t.updated_at<=now()-make_interval(days=>r.lead_days)))
    CROSS JOIN LATERAL unnest(r.additional_action_kinds) AS extra(action_kind)
    WHERE r.enabled AND r.target_kind='task'
  LOOP
    IF rec.action_kind='notify_assignee' AND rec.assigned_to IS NOT NULL THEN
      audit_key:='task-rule-extra:'||rec.rule_id||':'||rec.task_id||':'||current_date;
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
SELECT cron.schedule('docubox-task-additional-actions','*/30 * * * *',
  'select task_internal.run_additional_rule_actions();');

-- Keep an additional follow-up open while the resource condition still matches.
CREATE OR REPLACE FUNCTION task_internal.reconcile_resource_rules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE created_count integer:=0; closed_count integer:=0; notified_count integer:=0;
BEGIN
  WITH matched AS (SELECT * FROM task_internal.match_resource_rules()),
  changed AS (
    INSERT INTO public.tareas (
      workspace_id,automation_key,source_type,source_id,assigned_to,created_by,
      title,description,tipo,prioridad,riesgo,estado,due_date,main_action,
      origin,work_kind,document_id,expediente_id,document_name,expediente_name,
      responsible_name,creator_name,is_critical
    )
    SELECT m.workspace_id,'custom:'||m.rule_id::text,m.source_type,m.source_id,
      m.assigned_to,m.rule_creator,'Atender '||
        CASE m.source_type WHEN 'document' THEN 'documento' WHEN 'form_template' THEN 'formulario'
          WHEN 'template' THEN 'plantilla' WHEN 'case_file' THEN 'expediente'
          WHEN 'form_response' THEN 'respuesta' ELSE 'validación de usuario' END||
        ': '||m.resource_name,
      'Acción creada por la automatización '||m.rule_name||'. Estado del recurso: '||
        COALESCE(m.resource_status,'sin estado')||'.',
      m.generated_task_type,m.generated_priority,
      CASE WHEN m.generated_priority='critica' THEN 'alto'::public.tarea_riesgo
        WHEN m.generated_priority='alta' THEN 'medio'::public.tarea_riesgo
        ELSE 'bajo'::public.tarea_riesgo END,
      'pendiente'::public.tarea_estado,
      CASE WHEN m.due_at>now() THEN m.due_at ELSE now()+interval '2 days' END,
      'Abrir recurso','sistema','accion',
      CASE WHEN m.source_type='document' THEN m.source_id::text END,
      CASE WHEN m.source_type='case_file' THEN m.source_id::text END,
      CASE WHEN m.source_type='document' THEN m.resource_name END,
      CASE WHEN m.source_type='case_file' THEN m.resource_name END,
      COALESCE(assignee.full_name,assignee.email,'Usuario'),
      COALESCE(creator.full_name,creator.email,'Sistema'),
      m.generated_priority='critica'
    FROM matched m
    LEFT JOIN public.user_profiles assignee ON assignee.id=m.assigned_to
    LEFT JOIN public.user_profiles creator ON creator.id=m.rule_creator
    WHERE m.action_kind='create_followup'
    ON CONFLICT (workspace_id,automation_key,source_id)
      WHERE automation_key IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET estado='pendiente',completed_at=NULL,cancelled_at=NULL,
      resolution_note=NULL,due_date=EXCLUDED.due_date
    WHERE tareas.origin='sistema' AND tareas.estado='completada'
      AND EXISTS (SELECT 1 FROM public.task_custom_rules rule
        WHERE 'custom:'||rule.id::text=EXCLUDED.automation_key
          AND rule.condition_kind<>'created')
    RETURNING id,workspace_id
  ), audited AS (
    INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Acción creada o reabierta por una automatización de recursos.',
      'Sistema','Plus','text-blue-500' FROM changed RETURNING id
  ) SELECT count(*) INTO created_count FROM audited;

  WITH sent AS (
    INSERT INTO public.notifications(
      user_id,workspace_id,type,title,description,priority,category,event_type,
      severity,entity_type,entity_id,action_url,action_label,idempotency_key
    )
    SELECT m.assigned_to,m.workspace_id,'task_rule',m.rule_name,
      m.resource_name||' · '||COALESCE(m.resource_status,'Revisar'),
      CASE WHEN m.generated_priority IN ('critica','alta') THEN 'high' ELSE 'medium' END,
      'REMINDER','task.resource_rule','warning',m.source_type,m.source_id,
      m.action_url,'Abrir recurso','task-resource:'||m.rule_id::text||':'||m.source_id::text
    FROM task_internal.match_resource_rules() m WHERE m.action_kind='notify_assignee'
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id
  ) SELECT count(*) INTO notified_count FROM sent;

  WITH closed AS (
    UPDATE public.tareas task SET estado='completada',completed_at=now(),is_overdue=false,
      resolution_note='Cierre automático: la condición del recurso dejó de cumplirse o se desactivó la regla.'
    WHERE task.origin='sistema' AND task.automation_key LIKE 'custom:%'
      AND task.source_type IN ('document','form_template','template','case_file','form_response','user')
      AND task.estado NOT IN ('completada','cancelada','rechazada')
      AND NOT EXISTS (
        SELECT 1 FROM task_internal.match_resource_rules() match
        WHERE task.automation_key='custom:'||match.rule_id::text
          AND task.source_id=match.source_id
          AND (match.action_kind='create_followup' OR EXISTS (SELECT 1 FROM public.task_custom_rules rule WHERE rule.id=match.rule_id AND 'create_followup'=ANY(rule.additional_action_kinds))))
    RETURNING task.id,task.workspace_id
  ), audit AS (
    INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Cierre automático: la condición del recurso dejó de cumplirse.',
      'Sistema','CheckCircle2','text-green-500' FROM closed RETURNING id
  ) SELECT count(*) INTO closed_count FROM audit;

  RETURN jsonb_build_object('created',created_count,'closed',closed_count,'notified',notified_count);
END;
$$;

REVOKE ALL ON FUNCTION task_internal.reconcile_resource_rules() FROM PUBLIC,anon,authenticated;

-- Read-only simulation of an enabled rule. The same matcher is used by the
-- resource processor; the task branch mirrors the active-task predicate.
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
          OR (rule_row.trigger_kind='created' AND t.created_at<=now())
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
