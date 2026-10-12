-- Include personal documents in resource rules and reject invalid task dependencies.
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
    SELECT COALESCE(d.workspace_id,personal.id) workspace_id,'document'::text kind,d.id source_id,
      d.nombre resource_name,d.estado resource_status,d.created_at,d.updated_at,
      d.fecha_vencimiento due_at,d.owner_id resource_owner,
      '/visor-documento/'||d.id::text action_url
    FROM public.documentos d
    LEFT JOIN LATERAL (
      SELECT w.id FROM public.workspaces w
      WHERE d.workspace_id IS NULL AND w.owner_id=d.owner_id
        AND w.workspace_type::text='personal'
      ORDER BY w.id LIMIT 1
    ) personal ON true
    WHERE d.deleted_at IS NULL AND COALESCE(d.workspace_id,personal.id) IS NOT NULL
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

-- Keep task dependencies inside one workspace and prevent circular chains.
CREATE OR REPLACE FUNCTION task_internal.validate_task_dependency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE from_workspace uuid; to_workspace uuid;
BEGIN
  IF NEW.tarea_id=NEW.depends_on_id THEN
    RAISE EXCEPTION 'Una tarea no puede depender de sí misma.' USING ERRCODE='23514';
  END IF;
  SELECT workspace_id INTO from_workspace FROM public.tareas WHERE id=NEW.tarea_id;
  SELECT workspace_id INTO to_workspace FROM public.tareas WHERE id=NEW.depends_on_id;
  IF from_workspace IS NULL OR to_workspace IS NULL OR
    from_workspace<>to_workspace OR NEW.workspace_id IS DISTINCT FROM from_workspace THEN
    RAISE EXCEPTION 'Las tareas vinculadas deben pertenecer al mismo espacio.' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT d.depends_on_id FROM public.task_dependencies d WHERE d.tarea_id=NEW.depends_on_id
      UNION
      SELECT d.depends_on_id FROM public.task_dependencies d JOIN chain c ON d.tarea_id=c.id
    )
    SELECT 1 FROM chain WHERE id=NEW.tarea_id
  ) THEN
    RAISE EXCEPTION 'La dependencia crearía un ciclo.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION task_internal.validate_task_dependency() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task_dependency_validity BEFORE INSERT OR UPDATE
  ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION task_internal.validate_task_dependency();
