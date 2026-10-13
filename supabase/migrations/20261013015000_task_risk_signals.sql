-- Additional real-resource signals. Every rule can be disabled per workspace.
ALTER TABLE public.task_system_rules DROP CONSTRAINT task_system_rules_rule_key_check;
ALTER TABLE public.task_system_rules ADD CONSTRAINT task_system_rules_rule_key_check
  CHECK (rule_key IN ('draft_stale','document_due','form_invite_pending','case_due','missing_anexo',
    'template_draft_stale','form_draft_stale','identity_pending','form_signing_stale',
    'document_signing_stale','case_inactive','identity_phone_pending','nom151_failed'));

INSERT INTO public.task_system_rules(workspace_id,rule_key,threshold_days)
SELECT w.id,r.rule_key,r.days FROM public.workspaces w CROSS JOIN
  (VALUES ('document_signing_stale',3),('case_inactive',5),
    ('identity_phone_pending',3),('nom151_failed',1)) r(rule_key,days)
ON CONFLICT (workspace_id,rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION task_internal.seed_workspace_task_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.task_system_rules(workspace_id,rule_key,threshold_days)
  VALUES (NEW.id,'draft_stale',3),(NEW.id,'document_due',3),
    (NEW.id,'form_invite_pending',2),(NEW.id,'case_due',3),(NEW.id,'missing_anexo',1),
    (NEW.id,'template_draft_stale',3),(NEW.id,'form_draft_stale',3),
    (NEW.id,'identity_pending',2),(NEW.id,'form_signing_stale',1),
    (NEW.id,'document_signing_stale',3),(NEW.id,'case_inactive',5),
    (NEW.id,'identity_phone_pending',3),(NEW.id,'nom151_failed',1)
  ON CONFLICT (workspace_id,rule_key) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.seed_workspace_task_rules() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION task_internal.reconcile_risk_tasks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE created_count integer:=0; closed_count integer:=0;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS task_risk_candidates (
    workspace_id uuid NOT NULL,rule_key text NOT NULL,source_id uuid NOT NULL,
    source_type text NOT NULL,document_id text,expediente_id text,
    document_name text,expediente_name text,assignee uuid NOT NULL,creator uuid NOT NULL,
    title text NOT NULL,description text NOT NULL,task_type public.tarea_tipo NOT NULL,
    priority public.tarea_prioridad NOT NULL,due_at timestamptz NOT NULL,
    action_label text NOT NULL,PRIMARY KEY(workspace_id,rule_key,source_id)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.task_risk_candidates;

  INSERT INTO pg_temp.task_risk_candidates
  SELECT workspace.id,'document_signing_stale',document.id,'document',document.id::text,NULL,
    document.nombre,NULL,document.owner_id,document.owner_id,
    'Retomar firma: '||document.nombre,
    'El documento sigue en proceso sin actividad reciente. Revisa las firmas pendientes.',
    'revisar_documento'::public.tarea_tipo,'alta'::public.tarea_prioridad,
    now()+interval '2 days','Abrir documento'
  FROM public.documentos document
  JOIN public.workspaces workspace ON workspace.id=document.workspace_id OR
    (document.workspace_id IS NULL AND workspace.owner_id=document.owner_id
      AND workspace.workspace_type::text='personal')
  JOIN public.task_system_rules rule ON rule.workspace_id=workspace.id
    AND rule.rule_key='document_signing_stale' AND rule.enabled
  WHERE document.estado='en_proceso' AND document.deleted_at IS NULL
    AND document.owner_id IS NOT NULL
    AND document.updated_at<=now()-make_interval(days=>rule.threshold_days)
  ON CONFLICT DO NOTHING;

  INSERT INTO pg_temp.task_risk_candidates
  SELECT file.workspace_id,'case_inactive',file.id,'case_file',NULL,file.id::text,
    NULL,file.title,file.owner_user_id,COALESCE(file.created_by,file.owner_user_id),
    'Retomar expediente: '||file.title,
    'El expediente abierto no registra cambios recientes. Revisa su avance.',
    'revisar_expediente'::public.tarea_tipo,'media'::public.tarea_prioridad,
    now()+interval '2 days','Abrir expediente'
  FROM public.case_files file JOIN public.task_system_rules rule
    ON rule.workspace_id=file.workspace_id AND rule.rule_key='case_inactive' AND rule.enabled
  WHERE file.status IN ('open','in_progress') AND file.closed_at IS NULL
    AND file.owner_user_id IS NOT NULL
    AND file.updated_at<=now()-make_interval(days=>rule.threshold_days)
  ON CONFLICT DO NOTHING;

  INSERT INTO pg_temp.task_risk_candidates
  SELECT member.workspace_id,'identity_phone_pending',verification.user_id,'user',NULL,NULL,
    NULL,NULL,verification.user_id,verification.user_id,
    'Completar verificación de teléfono',
    'El correo ya está verificado, pero el teléfono registrado aún requiere validación.',
    'validar_identidad'::public.tarea_tipo,'media'::public.tarea_prioridad,
    now()+interval '2 days','Abrir perfil'
  FROM public.user_verification_status verification
  JOIN public.workspace_members member ON member.user_id=verification.user_id AND member.status='active'
  JOIN public.task_system_rules rule ON rule.workspace_id=member.workspace_id
    AND rule.rule_key='identity_phone_pending' AND rule.enabled
  WHERE verification.email_verified AND NOT COALESCE(verification.phone_verified,false)
    AND nullif(trim(verification.phone_number),'') IS NOT NULL
    AND verification.created_at<=now()-make_interval(days=>rule.threshold_days)
  ON CONFLICT DO NOTHING;

  INSERT INTO pg_temp.task_risk_candidates
  SELECT workspace.id,'nom151_failed',document.id,'document',document.id::text,NULL,
    document.nombre,NULL,document.owner_id,document.owner_id,
    'Revisar certificación: '||document.nombre,
    'El último intento de certificación NOM-151 falló. Revisa el documento y reintenta el proceso.',
    'obtener_nom151'::public.tarea_tipo,'alta'::public.tarea_prioridad,
    now()+interval '1 day','Abrir documento'
  FROM (SELECT DISTINCT ON (documento_id) documento_id,status,updated_at
    FROM public.nom151_constancias_doc ORDER BY documento_id,created_at DESC,id DESC) certificate
  JOIN public.documentos document ON document.id=certificate.documento_id
  JOIN public.workspaces workspace ON workspace.id=document.workspace_id OR
    (document.workspace_id IS NULL AND workspace.owner_id=document.owner_id
      AND workspace.workspace_type::text='personal')
  JOIN public.task_system_rules rule ON rule.workspace_id=workspace.id
    AND rule.rule_key='nom151_failed' AND rule.enabled
  WHERE certificate.status='failed' AND document.deleted_at IS NULL
    AND document.owner_id IS NOT NULL AND document.estado NOT IN ('cancelado','rechazado')
    AND certificate.updated_at<=now()-make_interval(days=>rule.threshold_days)
  ON CONFLICT DO NOTHING;

  WITH inserted AS (
    INSERT INTO public.tareas(workspace_id,automation_key,source_type,source_id,
      document_id,expediente_id,document_name,expediente_name,assigned_to,created_by,
      title,description,tipo,prioridad,riesgo,estado,due_date,main_action,origin,work_kind,
      responsible_name,creator_name)
    SELECT c.workspace_id,c.rule_key,c.source_type,c.source_id,c.document_id,c.expediente_id,
      c.document_name,c.expediente_name,c.assignee,c.creator,c.title,c.description,c.task_type,
      c.priority,CASE WHEN c.priority='alta' THEN 'medio'::public.tarea_riesgo
        ELSE 'bajo'::public.tarea_riesgo END,'pendiente'::public.tarea_estado,
      c.due_at,c.action_label,'sistema','accion',
      COALESCE(assignee.full_name,assignee.email,'Usuario'),
      COALESCE(creator.full_name,creator.email,'Sistema')
    FROM pg_temp.task_risk_candidates c
    LEFT JOIN public.user_profiles assignee ON assignee.id=c.assignee
    LEFT JOIN public.user_profiles creator ON creator.id=c.creator
    ON CONFLICT (workspace_id,automation_key,source_id)
      WHERE automation_key IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET estado='pendiente',completed_at=NULL,cancelled_at=NULL,
      resolution_note=NULL,due_date=EXCLUDED.due_date
    WHERE tareas.origin='sistema' AND tareas.estado='completada'
    RETURNING id,workspace_id
  ), audit AS (
    INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Acción creada por una señal de riesgo del recurso.',
      'Sistema','AlertTriangle','text-amber-500' FROM inserted RETURNING id
  ) SELECT count(*) INTO created_count FROM audit;

  WITH closed AS (
    UPDATE public.tareas task SET estado='completada',completed_at=now(),is_overdue=false,
      resolution_note='Cierre automático: la señal de riesgo desapareció o la regla fue desactivada.'
    WHERE task.origin='sistema' AND task.automation_key IN
      ('document_signing_stale','case_inactive','identity_phone_pending','nom151_failed')
      AND task.estado NOT IN ('completada','cancelada','rechazada')
      AND NOT EXISTS (SELECT 1 FROM pg_temp.task_risk_candidates candidate
        WHERE candidate.workspace_id=task.workspace_id AND candidate.rule_key=task.automation_key
          AND candidate.source_id=task.source_id)
    RETURNING task.id,task.workspace_id
  ), audit AS (
    INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_name,icon_name,color)
    SELECT id,workspace_id,'Cierre automático: la señal de riesgo dejó de aplicarse.',
      'Sistema','CheckCircle2','text-green-500' FROM closed RETURNING id
  ) SELECT count(*) INTO closed_count FROM audit;
  RETURN jsonb_build_object('created',created_count,'closed',closed_count);
END;
$$;
REVOKE ALL ON FUNCTION task_internal.reconcile_risk_tasks() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('docubox-task-risk-signals','*/30 * * * *',
  'select task_internal.reconcile_risk_tasks();');

-- Track the jobs that actually run after the custom-rule pipeline consolidation.
CREATE OR REPLACE FUNCTION task_internal.monitor_task_crons()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sent_count integer:=0;
BEGIN
  WITH required(jobname) AS (VALUES ('docubox-task-reconcile'),('docubox-task-extended'),
    ('docubox-task-custom-pipeline'),('docubox-task-form-signatures'),
    ('docubox-task-risk-signals')),
  unhealthy AS (
    SELECT required.jobname FROM required LEFT JOIN cron.job job ON job.jobname=required.jobname
    WHERE job.jobid IS NULL OR NOT job.active OR NOT EXISTS (
      SELECT 1 FROM cron.job_run_details run WHERE run.jobid=job.jobid
        AND run.status='succeeded' AND run.start_time>now()-interval '90 minutes')
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
