-- A configurable rule can observe a real workspace resource, not only a task.
ALTER TABLE public.task_custom_rules
  ADD COLUMN target_kind text NOT NULL DEFAULT 'task',
  ADD COLUMN condition_kind text NOT NULL DEFAULT 'inactive',
  ADD COLUMN entity_status_filter text,
  ADD COLUMN generated_task_type public.tarea_tipo NOT NULL DEFAULT 'revisar_documento',
  ADD COLUMN generated_priority public.tarea_prioridad NOT NULL DEFAULT 'media';
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_target_kind_check
  CHECK (target_kind IN ('task','document','form_template','template','case_file','form_response','user'));
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_condition_kind_check
  CHECK (condition_kind IN ('created','inactive','due_soon','overdue','status'));
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_entity_status_check
  CHECK (entity_status_filter IS NULL OR char_length(entity_status_filter) BETWEEN 1 AND 60);
ALTER TABLE public.task_custom_rules DROP CONSTRAINT task_custom_rules_trigger_kind_check;
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_trigger_kind_check
  CHECK (trigger_kind IN ('due_soon','overdue','created','inactive','resource_condition'));
ALTER TABLE public.task_custom_rules ADD CONSTRAINT task_custom_rules_target_trigger_check
  CHECK ((target_kind='task' AND trigger_kind<>'resource_condition')
      OR (target_kind<>'task' AND trigger_kind='resource_condition'
        AND action_kind IN ('notify_assignee','create_followup')
        AND (condition_kind<>'status' OR entity_status_filter IS NOT NULL)));

CREATE INDEX task_custom_rules_resource_active_idx
  ON public.task_custom_rules(workspace_id,target_kind,enabled)
  WHERE target_kind <> 'task';

CREATE OR REPLACE FUNCTION task_internal.match_resource_rules()
RETURNS TABLE (
  rule_id uuid, workspace_id uuid, source_type text, source_id uuid,
  resource_name text, resource_status text, due_at timestamptz, assigned_to uuid,
  rule_name text, rule_creator uuid, action_kind text,
  generated_task_type public.tarea_tipo, generated_priority public.tarea_prioridad,
  action_url text, condition_kind text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH entities AS (
    SELECT d.workspace_id,'document'::text kind,d.id source_id,d.nombre resource_name,
      d.estado resource_status,d.created_at,d.updated_at,d.fecha_vencimiento due_at,
      d.owner_id resource_owner,'/visor-documento/'||d.id::text action_url
    FROM public.documentos d WHERE d.deleted_at IS NULL AND d.workspace_id IS NOT NULL
    UNION ALL
    SELECT f.workspace_id,'form_template',f.id,f.name,f.status,
      f.created_at,f.updated_at,NULL::timestamptz,f.created_by,
      '/formularios/nuevo?id='||f.id::text
    FROM public.form_templates f
    UNION ALL
    SELECT p.workspace_id,'template',p.id,p.nombre,p.estado,
      p.created_at,p.updated_at,NULL::timestamptz,p.created_by,
      '/plantillas/nueva?id='||p.id::text
    FROM public.plantillas p WHERE p.workspace_id IS NOT NULL
    UNION ALL
    SELECT c.workspace_id,'case_file',c.id,c.title,c.status,
      c.created_at,c.updated_at,c.target_close_at,COALESCE(c.owner_user_id,c.created_by),
      '/expedientes/'||c.id::text
    FROM public.case_files c
    UNION ALL
    SELECT response.workspace_id,'form_response',response.id,
      COALESCE(response.folio,response.respondent_name,'Respuesta'),response.status,
      COALESCE(response.submitted_at,response.draft_saved_at),
      COALESCE(response.draft_saved_at,response.submitted_at),NULL::timestamptz,
      form.created_by,'/formularios/respuestas?id='||response.template_id::text
    FROM public.form_responses response
    JOIN public.form_templates form ON form.id=response.template_id
    UNION ALL
    SELECT member.workspace_id,'user',profile.id,
      COALESCE(profile.full_name,profile.email,'Usuario'),
      CASE WHEN COALESCE(verification.biometric_verified,false) THEN 'validado'
        WHEN COALESCE(verification.email_verified,profile.email_verified,false) THEN 'identidad pendiente'
        ELSE 'correo pendiente' END,
      profile.created_at,COALESCE(verification.updated_at,profile.updated_at),
      NULL::timestamptz,profile.id,'/mi-perfil'
    FROM public.workspace_members member
    JOIN public.user_profiles profile ON profile.id=member.user_id
    LEFT JOIN public.user_verification_status verification ON verification.user_id=profile.id
    WHERE member.status='active'
  )
  SELECT rule.id,entity.workspace_id,entity.kind,entity.source_id,
    entity.resource_name,entity.resource_status,entity.due_at,
    COALESCE(owner_member.user_id,workspace_owner.user_id),
    rule.name,rule.created_by,rule.action_kind,rule.generated_task_type,
    rule.generated_priority,entity.action_url,rule.condition_kind
  FROM public.task_custom_rules rule
  JOIN entities entity ON entity.workspace_id=rule.workspace_id AND entity.kind=rule.target_kind
  JOIN public.workspaces workspace ON workspace.id=entity.workspace_id
  LEFT JOIN public.workspace_members owner_member
    ON owner_member.workspace_id=entity.workspace_id
    AND owner_member.user_id=entity.resource_owner AND owner_member.status='active'
  LEFT JOIN public.workspace_members workspace_owner
    ON workspace_owner.workspace_id=entity.workspace_id
    AND workspace_owner.user_id=workspace.owner_id AND workspace_owner.status='active'
  WHERE rule.enabled AND rule.target_kind<>'task'
    AND COALESCE(owner_member.user_id,workspace_owner.user_id) IS NOT NULL
    AND (rule.entity_status_filter IS NOT NULL OR
      lower(COALESCE(entity.resource_status,'')) NOT IN
        ('completado','cancelado','rechazado','archived','closed','signed','validado'))
    AND (rule.entity_status_filter IS NULL OR
      lower(entity.resource_status)=lower(rule.entity_status_filter))
    AND (
      (rule.condition_kind='created' AND entity.created_at>=rule.created_at)
      OR (rule.condition_kind='inactive' AND entity.updated_at<=now()-make_interval(days=>rule.lead_days))
      OR (rule.condition_kind='due_soon' AND entity.due_at>now()
        AND entity.due_at<=now()+make_interval(days=>rule.lead_days))
      OR (rule.condition_kind='overdue' AND entity.due_at<now())
      OR (rule.condition_kind='status')
    );
$$;
REVOKE ALL ON FUNCTION task_internal.match_resource_rules() FROM PUBLIC,anon,authenticated;

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
          AND match.action_kind='create_followup')
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
SELECT cron.schedule('docubox-task-resource-rules','*/30 * * * *',
  'select task_internal.reconcile_resource_rules();');
