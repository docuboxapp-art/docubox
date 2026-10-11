CREATE OR REPLACE FUNCTION task_internal.reconcile_tasks()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  created_count integer := 0;
  closed_count integer := 0;
  rec record;
BEGIN
  INSERT INTO public.task_system_rules (workspace_id, rule_key, threshold_days)
  SELECT w.id, r.rule_key, r.threshold_days
  FROM public.workspaces w
  CROSS JOIN (VALUES
    ('draft_stale', 3), ('document_due', 3), ('form_invite_pending', 2),
    ('case_due', 3), ('missing_anexo', 1)
  ) AS r(rule_key, threshold_days)
  ON CONFLICT (workspace_id, rule_key) DO NOTHING;

  WITH candidates AS (
    SELECT ws.id workspace_id, 'draft_stale'::text automation_key, d.id source_id,
      'document'::text source_type, d.id::text document_id, NULL::text expediente_id,
      d.nombre document_name, NULL::text expediente_name,
      d.owner_id assignee, d.owner_id creator,
      ('Continuar borrador: ' || d.nombre) title,
      'El documento lleva varios días sin cambios. Revísalo o continúa su preparación.'::text description,
      'retomar_borrador'::public.tarea_tipo task_type, 'media'::public.tarea_prioridad priority,
      (now() + interval '2 days') due_at, 'Continuar documento'::text action_label
    FROM public.documentos d
    JOIN public.workspaces ws ON ws.id = d.workspace_id
      OR (d.workspace_id IS NULL AND ws.owner_id = d.owner_id AND ws.workspace_type::text = 'personal')
    JOIN public.task_system_rules rule ON rule.workspace_id = ws.id AND rule.rule_key = 'draft_stale' AND rule.enabled
    WHERE d.estado = 'borrador' AND d.deleted_at IS NULL AND d.owner_id IS NOT NULL
      AND d.updated_at <= now() - make_interval(days => rule.threshold_days)

    UNION ALL
    SELECT ws.id, 'document_due', d.id, 'document', d.id::text, NULL::text,
      d.nombre, NULL::text, d.owner_id, d.owner_id,
      ('Revisar vencimiento: ' || d.nombre),
      'El documento tiene una fecha de vencimiento cercana o superada.',
      'revisar_vencimiento'::public.tarea_tipo, 'alta'::public.tarea_prioridad,
      d.fecha_vencimiento, 'Abrir documento'
    FROM public.documentos d
    JOIN public.workspaces ws ON ws.id = d.workspace_id
      OR (d.workspace_id IS NULL AND ws.owner_id = d.owner_id AND ws.workspace_type::text = 'personal')
    JOIN public.task_system_rules rule ON rule.workspace_id = ws.id AND rule.rule_key = 'document_due' AND rule.enabled
    WHERE d.estado IN ('borrador', 'en_proceso') AND d.deleted_at IS NULL AND d.owner_id IS NOT NULL
      AND d.fecha_vencimiento IS NOT NULL
      AND d.fecha_vencimiento <= now() + make_interval(days => rule.threshold_days)

    UNION ALL
    SELECT f.workspace_id, 'form_invite_pending', token.id, 'form_token', NULL::text, NULL::text,
      NULL::text, NULL::text, f.created_by, f.created_by,
      ('Dar seguimiento al formulario: ' || f.name),
      'La invitación enviada sigue sin respuesta. Revisa su estado o recuerda al destinatario.',
      'seguimiento_formulario'::public.tarea_tipo, 'media'::public.tarea_prioridad,
      COALESCE(token.expires_at, token.created_at + interval '7 days'), 'Ver formulario'
    FROM public.form_tokens token
    JOIN public.form_templates f ON f.id = token.template_id
    JOIN public.task_system_rules rule ON rule.workspace_id = f.workspace_id AND rule.rule_key = 'form_invite_pending' AND rule.enabled
    WHERE token.used_at IS NULL AND (token.expires_at IS NULL OR token.expires_at > now())
      AND token.created_at <= now() - make_interval(days => rule.threshold_days)
      AND f.created_by IS NOT NULL

    UNION ALL
    SELECT c.workspace_id, 'case_due', c.id, 'case_file', NULL::text, c.id::text,
      NULL::text, c.title, c.owner_user_id, c.created_by,
      ('Revisar expediente: ' || c.title),
      'La fecha objetivo del expediente está próxima o vencida.',
      'revisar_expediente'::public.tarea_tipo, 'alta'::public.tarea_prioridad,
      c.target_close_at, 'Abrir expediente'
    FROM public.case_files c
    JOIN public.task_system_rules rule ON rule.workspace_id = c.workspace_id AND rule.rule_key = 'case_due' AND rule.enabled
    WHERE c.closed_at IS NULL AND c.target_close_at IS NOT NULL AND c.owner_user_id IS NOT NULL
      AND c.target_close_at <= now() + make_interval(days => rule.threshold_days)

    UNION ALL
    SELECT req.workspace_id, 'missing_anexo', req.id, 'participant_requirement', d.id::text, NULL::text,
      d.nombre, NULL::text, COALESCE(pref.participant_user_id, d.owner_id), d.owner_id,
      ('Completar anexo: ' || req.name),
      COALESCE(req.description, 'Falta un anexo requerido para continuar el documento.'),
      'subir_anexo'::public.tarea_tipo, 'alta'::public.tarea_prioridad,
      now() + interval '3 days', 'Abrir documento'
    FROM public.participant_document_requirements req
    JOIN public.documentos d ON d.id = req.document_id AND d.deleted_at IS NULL
    LEFT JOIN public.document_participant_references pref ON pref.id = req.participant_reference_id
    JOIN public.task_system_rules rule ON rule.workspace_id = req.workspace_id AND rule.rule_key = 'missing_anexo' AND rule.enabled
    WHERE req.required AND req.provided_at IS NULL AND req.status NOT IN ('approved', 'accepted', 'completed', 'waived')
      AND COALESCE(pref.participant_user_id, d.owner_id) IS NOT NULL
  ), inserted AS (
    INSERT INTO public.tareas (
      workspace_id, automation_key, source_type, source_id, document_id, expediente_id,
      document_name, expediente_name, assigned_to, created_by, title, description,
      tipo, prioridad, riesgo, estado, due_date, main_action, origin, work_kind,
      responsible_name, creator_name
    )
    SELECT c.workspace_id, c.automation_key, c.source_type, c.source_id,
      c.document_id, c.expediente_id, c.document_name, c.expediente_name,
      c.assignee, c.creator, c.title, c.description, c.task_type, c.priority,
      CASE WHEN c.priority = 'alta' THEN 'medio'::public.tarea_riesgo ELSE 'bajo'::public.tarea_riesgo END,
      'pendiente'::public.tarea_estado, c.due_at, c.action_label, 'sistema', 'accion',
      COALESCE(assignee.full_name, assignee.email, 'Usuario'),
      COALESCE(creator.full_name, creator.email, 'Sistema')
    FROM candidates c
    LEFT JOIN public.user_profiles assignee ON assignee.id = c.assignee
    LEFT JOIN public.user_profiles creator ON creator.id = c.creator
    WHERE c.workspace_id IS NOT NULL
    ON CONFLICT (workspace_id, automation_key, source_id)
      WHERE automation_key IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET estado = 'pendiente', completed_at = NULL, cancelled_at = NULL,
      resolution_note = NULL, due_date = EXCLUDED.due_date,
      title = EXCLUDED.title, description = EXCLUDED.description,
      assigned_to = EXCLUDED.assigned_to, responsible_name = EXCLUDED.responsible_name
    WHERE tareas.origin = 'sistema' AND tareas.estado = 'completada'
    RETURNING id, workspace_id
  ), audit AS (
    INSERT INTO public.task_history (tarea_id, workspace_id, action, actor_name, icon_name, color)
    SELECT id, workspace_id, 'Acción creada o reabierta automáticamente por una condición del proceso.',
      'Sistema', 'Plus', 'text-blue-500' FROM inserted RETURNING id
  )
  SELECT count(*) INTO created_count FROM audit;

  FOR rec IN
    SELECT t.id, t.workspace_id, t.automation_key,
      CASE t.automation_key
        WHEN 'draft_stale' THEN 'El borrador fue actualizado, completado o retirado.'
        WHEN 'document_due' THEN 'El documento ya no tiene un vencimiento que requiera atención.'
        WHEN 'form_invite_pending' THEN 'La invitación fue atendida o dejó de estar vigente.'
        WHEN 'case_due' THEN 'El expediente se cerró o cambió su fecha objetivo.'
        WHEN 'missing_anexo' THEN 'El anexo requerido fue proporcionado o dejó de ser obligatorio.'
      END note
    FROM public.tareas t
    WHERE t.origin = 'sistema' AND t.automation_key IS NOT NULL
      AND t.estado NOT IN ('completada', 'cancelada', 'rechazada')
      AND CASE t.automation_key
        WHEN 'draft_stale' THEN NOT EXISTS (
          SELECT 1 FROM public.documentos d JOIN public.task_system_rules r
            ON r.workspace_id = t.workspace_id AND r.rule_key = 'draft_stale'
          WHERE d.id = t.source_id AND d.estado = 'borrador' AND d.deleted_at IS NULL
            AND d.updated_at <= now() - make_interval(days => r.threshold_days))
        WHEN 'document_due' THEN NOT EXISTS (
          SELECT 1 FROM public.documentos d JOIN public.task_system_rules r
            ON r.workspace_id = t.workspace_id AND r.rule_key = 'document_due'
          WHERE d.id = t.source_id AND d.estado IN ('borrador', 'en_proceso') AND d.deleted_at IS NULL
            AND d.fecha_vencimiento <= now() + make_interval(days => r.threshold_days))
        WHEN 'form_invite_pending' THEN NOT EXISTS (
          SELECT 1 FROM public.form_tokens token WHERE token.id = t.source_id
            AND token.used_at IS NULL AND (token.expires_at IS NULL OR token.expires_at > now()))
        WHEN 'case_due' THEN NOT EXISTS (
          SELECT 1 FROM public.case_files c JOIN public.task_system_rules r
            ON r.workspace_id = t.workspace_id AND r.rule_key = 'case_due'
          WHERE c.id = t.source_id AND c.closed_at IS NULL
            AND c.target_close_at <= now() + make_interval(days => r.threshold_days))
        WHEN 'missing_anexo' THEN NOT EXISTS (
          SELECT 1 FROM public.participant_document_requirements req
          WHERE req.id = t.source_id AND req.required AND req.provided_at IS NULL
            AND req.status NOT IN ('approved', 'accepted', 'completed', 'waived'))
        ELSE false END
  LOOP
    UPDATE public.tareas SET estado = 'completada', completed_at = now(),
      resolution_note = rec.note, is_overdue = false WHERE id = rec.id;
    INSERT INTO public.task_history (tarea_id, workspace_id, action, actor_name, icon_name, color)
    VALUES (rec.id, rec.workspace_id, 'Cierre automático: ' || rec.note,
      'Sistema', 'CheckCircle2', 'text-green-500');
    closed_count := closed_count + 1;
  END LOOP;

  UPDATE public.tareas SET is_overdue = (due_date < now()),
    is_critical = (prioridad = 'critica'),
    estado = CASE WHEN due_date < now() AND estado IN ('nueva', 'pendiente', 'en_proceso')
      THEN 'vencida'::public.tarea_estado ELSE estado END
  WHERE estado NOT IN ('completada', 'cancelada', 'rechazada') AND due_date IS NOT NULL;

  RETURN jsonb_build_object('created', created_count, 'closed', closed_count);
END;
$$;


REVOKE ALL ON FUNCTION task_internal.reconcile_tasks() FROM PUBLIC, anon, authenticated;
