-- Bounded, forward-only decision graph appended after a rule's initial actions.
ALTER TABLE public.task_custom_rules
  ADD COLUMN workflow_stages jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION task_internal.valid_task_workflow_stages(stages jsonb, target text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE stage jsonb; branch jsonb; action text; position integer := 0;
  stage_count integer; pointer text; field_name text; comparison text; expected text;
BEGIN
  IF stages IS NULL OR jsonb_typeof(stages) <> 'array' THEN RETURN false; END IF;
  stage_count := jsonb_array_length(stages);
  IF stage_count > 5 THEN RETURN false; END IF;
  FOR stage IN SELECT value FROM jsonb_array_elements(stages) LOOP
    position := position + 1;
    IF jsonb_typeof(stage) <> 'object' THEN RETURN false; END IF;
    field_name := stage->>'field'; comparison := stage->>'operator'; expected := stage->>'value';
    IF field_name NOT IN ('status','priority','risk','source_type','overdue','inactive_days')
      OR expected IS NULL OR length(expected) NOT BETWEEN 1 AND 60 THEN RETURN false; END IF;
    IF target <> 'task' AND field_name IN ('priority','risk','inactive_days') THEN RETURN false; END IF;
    IF field_name='inactive_days' THEN
      IF comparison <> 'gte' OR expected !~ '^[0-9]+$' THEN RETURN false; END IF;
      IF expected::integer NOT BETWEEN 1 AND 90 THEN RETURN false; END IF;
    ELSIF comparison NOT IN ('eq','ne') THEN RETURN false; END IF;
    IF field_name='overdue' AND expected NOT IN ('true','false') THEN RETURN false; END IF;
    IF field_name='priority' AND expected NOT IN ('baja','media','alta','critica') THEN RETURN false; END IF;
    IF field_name='risk' AND expected NOT IN ('bajo','medio','alto') THEN RETURN false; END IF;
    FOREACH pointer IN ARRAY ARRAY['nextTrue','nextFalse'] LOOP
      IF stage ? pointer AND jsonb_typeof(stage->pointer) <> 'null' THEN
        IF jsonb_typeof(stage->pointer) <> 'number' OR (stage->>pointer) !~ '^[0-9]+$'
          OR (stage->>pointer)::integer <= position OR (stage->>pointer)::integer > stage_count
        THEN RETURN false; END IF;
      END IF;
    END LOOP;
    FOREACH pointer IN ARRAY ARRAY['onTrue','onFalse'] LOOP
      branch := stage->pointer;
      IF jsonb_typeof(branch) <> 'array' THEN RETURN false; END IF;
      IF jsonb_array_length(branch) > 3 THEN RETURN false; END IF;
      IF (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements_text(branch))
        THEN RETURN false; END IF;
      FOR action IN SELECT value FROM jsonb_array_elements_text(branch) LOOP
        IF action NOT IN ('notify_assignee','raise_priority','create_followup')
          OR (target <> 'task' AND action='raise_priority') THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END;
$$;
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_workflow_stages_check
  CHECK (task_internal.valid_task_workflow_stages(workflow_stages,target_kind));

CREATE OR REPLACE FUNCTION task_internal.task_flow_decision_matches(stage jsonb, current_status text,
  current_priority text, current_risk text, current_source text, due_at timestamptz,
  updated_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE actual text; expected text := stage->>'value'; field_name text := stage->>'field';
BEGIN
  IF field_name='inactive_days' THEN
    RETURN updated_at IS NOT NULL AND updated_at <= now()-make_interval(days=>(expected::integer));
  END IF;
  actual := CASE field_name WHEN 'status' THEN current_status
    WHEN 'priority' THEN current_priority WHEN 'risk' THEN current_risk
    WHEN 'source_type' THEN current_source WHEN 'overdue' THEN
      CASE WHEN due_at IS NOT NULL AND due_at < now() THEN 'true' ELSE 'false' END END;
  IF stage->>'operator'='ne' THEN RETURN actual IS DISTINCT FROM expected; END IF;
  RETURN actual IS NOT DISTINCT FROM expected;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.task_flow_decision_matches(jsonb,text,text,text,text,timestamptz,timestamptz)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION task_internal.run_task_rule_workflow_stages()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rec record; stage jsonb; branch_actions jsonb; selected_action text;
  branch_name text; event_key text; followup_key text; inserted_id uuid;
  stage_number integer; visited integer; matched boolean; executed integer := 0;
  closed_count integer := 0; target_kind text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS task_flow_active_followups (
    automation_key text NOT NULL, source_id uuid NOT NULL,
    PRIMARY KEY (automation_key,source_id)) ON COMMIT DROP;
  TRUNCATE pg_temp.task_flow_active_followups;
  FOR rec IN
    SELECT r.id rule_id,r.workspace_id,r.name rule_name,r.created_by rule_creator,
      r.trigger_kind,r.condition_kind,r.generated_task_type,r.generated_priority,
      r.workflow_stages,'task'::text target_kind,t.id target_id,t.id task_id,
      t.title target_name,t.estado::text current_status,t.prioridad::text current_priority,
      t.riesgo::text current_risk,t.source_type current_source,t.due_date due_at,
      t.updated_at,t.assigned_to,t.tipo task_type,t.document_id,t.expediente_id,
      t.document_name,t.expediente_name,t.responsible_name,t.creator_name
    FROM public.task_custom_rules r JOIN public.tareas t ON t.workspace_id=r.workspace_id
      AND t.estado NOT IN ('completada','cancelada','rechazada')
      AND (t.automation_key IS NULL OR t.automation_key NOT LIKE 'custom:%')
      AND (t.automation_key IS NULL OR t.automation_key NOT LIKE 'flow:%')
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
    WHERE r.enabled AND r.target_kind='task' AND jsonb_array_length(r.workflow_stages)>0
    UNION ALL
    SELECT r.id,m.workspace_id,r.name,r.created_by,r.trigger_kind,r.condition_kind,
      r.generated_task_type,r.generated_priority,r.workflow_stages,r.target_kind,
      m.source_id,NULL::uuid,m.resource_name,m.resource_status,NULL::text,NULL::text,
      m.source_type,m.due_at,NULL::timestamptz,m.assigned_to,r.generated_task_type,
      CASE WHEN m.source_type='document' THEN m.source_id::text END,
      CASE WHEN m.source_type='case_file' THEN m.source_id::text END,
      CASE WHEN m.source_type='document' THEN m.resource_name END,
      CASE WHEN m.source_type='case_file' THEN m.resource_name END,
      COALESCE(assignee.full_name,assignee.email,'Usuario'),
      COALESCE(creator.full_name,creator.email,'Sistema')
    FROM task_internal.match_resource_rules() m
    JOIN public.task_custom_rules r ON r.id=m.rule_id AND r.enabled
      AND jsonb_array_length(r.workflow_stages)>0
    LEFT JOIN public.user_profiles assignee ON assignee.id=m.assigned_to
    LEFT JOIN public.user_profiles creator ON creator.id=r.created_by
  LOOP
    stage_number:=1; visited:=0;
    WHILE stage_number IS NOT NULL AND visited<5 LOOP
      visited:=visited+1;
      stage:=rec.workflow_stages->(stage_number-1);
      matched:=task_internal.task_flow_decision_matches(stage,rec.current_status,
        rec.current_priority,rec.current_risk,rec.current_source,rec.due_at,rec.updated_at);
      branch_name:=CASE WHEN matched THEN 'yes' ELSE 'no' END;
      branch_actions:=stage->(CASE WHEN matched THEN 'onTrue' ELSE 'onFalse' END);
      FOR selected_action IN SELECT value FROM jsonb_array_elements_text(branch_actions) LOOP
        IF selected_action='notify_assignee' AND rec.assigned_to IS NOT NULL THEN
          event_key:='task-flow:'||rec.rule_id||':'||stage_number||':'||branch_name||':'||rec.target_id||':'||
            CASE WHEN rec.trigger_kind='created' OR rec.condition_kind='created'
              THEN 'created' ELSE current_date::text END;
          INSERT INTO public.notifications(user_id,workspace_id,type,title,description,priority,
            category,event_type,severity,entity_type,entity_id,action_url,action_label,idempotency_key)
          VALUES(rec.assigned_to,rec.workspace_id,'task_rule',rec.rule_name,
            'Etapa '||stage_number||': '||rec.target_name,
            CASE WHEN rec.generated_priority IN ('critica','alta') THEN 'high' ELSE 'medium' END,
            'REMINDER','task.flow_branch','warning',rec.target_kind,rec.target_id,
            CASE WHEN rec.target_kind='task' THEN '/mis-tareas?task='||rec.target_id
              WHEN rec.target_kind='document' THEN '/visor-documento/'||rec.target_id
              WHEN rec.target_kind='case_file' THEN '/expedientes/'||rec.target_id
              ELSE '/mis-tareas' END,'Abrir',event_key)
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
          IF FOUND THEN
            INSERT INTO public.task_rule_executions(workspace_id,rule_id,rule_name,target_type,
              target_id,target_name,action_kind,idempotency_key)
            VALUES(rec.workspace_id,rec.rule_id,rec.rule_name,rec.target_kind,rec.target_id,
              rec.target_name,selected_action,'flow:'||event_key)
            ON CONFLICT (idempotency_key) DO NOTHING;
            executed:=executed+1;
          END IF;
        ELSIF selected_action='raise_priority' AND rec.task_id IS NOT NULL THEN
          UPDATE public.tareas SET prioridad='alta',riesgo='medio' WHERE id=rec.task_id
            AND prioridad IN ('baja','media');
          IF FOUND THEN
            INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
            VALUES(rec.task_id,rec.workspace_id,'Prioridad elevada por decisión '||stage_number||': '||rec.rule_name,
              'Sistema','AlertTriangle','text-amber-500');
            INSERT INTO public.task_rule_executions(workspace_id,rule_id,rule_name,target_type,
              target_id,target_name,action_kind,idempotency_key)
            VALUES(rec.workspace_id,rec.rule_id,rec.rule_name,'task',rec.target_id,
              rec.target_name,selected_action,'flow-priority:'||rec.rule_id||':'||rec.target_id||':'||stage_number||':'||branch_name)
            ON CONFLICT (idempotency_key) DO NOTHING;
            executed:=executed+1;
            rec.current_priority:='alta'; rec.current_risk:='medio';
          END IF;
        ELSIF selected_action='create_followup' AND rec.assigned_to IS NOT NULL THEN
          followup_key:='flow:'||rec.rule_id||':'||stage_number||':'||branch_name;
          INSERT INTO pg_temp.task_flow_active_followups(automation_key,source_id)
            VALUES(followup_key,rec.target_id) ON CONFLICT DO NOTHING;
          INSERT INTO public.tareas(workspace_id,automation_key,source_type,source_id,
            assigned_to,created_by,title,description,tipo,prioridad,riesgo,estado,due_date,
            main_action,origin,work_kind,document_id,expediente_id,document_name,expediente_name,
            responsible_name,creator_name)
          VALUES(rec.workspace_id,followup_key,CASE WHEN rec.target_kind='task' THEN 'task' ELSE rec.target_kind END,
            rec.target_id,rec.assigned_to,COALESCE(rec.rule_creator,rec.assigned_to),
            'Dar seguimiento: '||rec.target_name,
            'Seguimiento creado en la etapa '||stage_number||' de '||rec.rule_name||'.',
            rec.task_type,rec.generated_priority,
            CASE WHEN rec.generated_priority='critica' THEN 'alto'::public.tarea_riesgo
              WHEN rec.generated_priority='alta' THEN 'medio'::public.tarea_riesgo
              ELSE 'bajo'::public.tarea_riesgo END,'pendiente'::public.tarea_estado,
            now()+interval '2 days','Abrir recurso','sistema','actividad',rec.document_id,
            rec.expediente_id,rec.document_name,rec.expediente_name,
            COALESCE(rec.responsible_name,'Usuario'),COALESCE(rec.creator_name,'Sistema'))
          ON CONFLICT (workspace_id,automation_key,source_id)
            WHERE automation_key IS NOT NULL AND source_id IS NOT NULL
          DO UPDATE SET estado='pendiente',completed_at=NULL,cancelled_at=NULL,
            resolution_note=NULL,due_date=EXCLUDED.due_date
          WHERE tareas.origin='sistema' AND tareas.estado='completada'
          RETURNING id INTO inserted_id;
          IF inserted_id IS NOT NULL THEN
            INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
            VALUES(inserted_id,rec.workspace_id,'Seguimiento creado por decisión '||stage_number||': '||rec.rule_name,
              'Sistema','GitBranch','text-blue-500');
            INSERT INTO public.task_rule_executions(workspace_id,rule_id,rule_name,target_type,
              target_id,target_name,action_kind,idempotency_key)
            VALUES(rec.workspace_id,rec.rule_id,rec.rule_name,rec.target_kind,rec.target_id,
              rec.target_name,selected_action,'flow-followup:'||inserted_id||':'||now()::text)
            ON CONFLICT (idempotency_key) DO NOTHING;
            executed:=executed+1;
          END IF;
          inserted_id:=NULL;
        END IF;
      END LOOP;
      stage_number:=CASE WHEN matched THEN (stage->>'nextTrue')::integer
        ELSE (stage->>'nextFalse')::integer END;
    END LOOP;
  END LOOP;
  WITH closed AS (
    UPDATE public.tareas task SET estado='completada',completed_at=now(),is_overdue=false,
      resolution_note='Cierre automático: la rama del flujo dejó de cumplirse o la regla fue desactivada.'
    WHERE task.origin='sistema' AND task.automation_key LIKE 'flow:%'
      AND task.estado NOT IN ('completada','cancelada','rechazada')
      AND NOT EXISTS (SELECT 1 FROM pg_temp.task_flow_active_followups active
        WHERE active.automation_key=task.automation_key AND active.source_id=task.source_id)
    RETURNING task.id,task.workspace_id
  ) INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Cierre automático: la rama del flujo dejó de cumplirse.',
      'Sistema','CheckCircle2','text-green-500' FROM closed;
  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN jsonb_build_object('executed',executed,'closed',closed_count);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.run_task_rule_workflow_stages() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION task_internal.run_custom_rule_pipeline()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE primary_result jsonb; additional_result jsonb; resource_result jsonb; flow_result jsonb;
BEGIN
  primary_result:=task_internal.run_custom_rules();
  additional_result:=task_internal.run_additional_rule_actions();
  resource_result:=task_internal.reconcile_resource_rules();
  flow_result:=task_internal.run_task_rule_workflow_stages();
  RETURN jsonb_build_object('primary',primary_result,'additional',additional_result,
    'resources',resource_result,'workflow',flow_result);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.run_custom_rule_pipeline() FROM PUBLIC,anon,authenticated;
