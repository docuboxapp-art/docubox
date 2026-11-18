
-- Service-only mutation: authorization, optimistic concurrency and history share
-- a transaction. The caller supplies the actor obtained from verified Auth.
CREATE OR REPLACE FUNCTION public.colabora_mutate_task(ws uuid,task_id uuid,actor uuid,action text,expected_version integer,changes jsonb DEFAULT '{}',reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current public.tareas;result public.tareas;permission text;next_state text;assignee uuid;profile_name text;
BEGIN
 IF expected_version IS NULL OR expected_version<1 OR action IS NULL OR action NOT IN('start','complete','block','unblock','request_review','reopen','cancel','reassign','update') OR jsonb_typeof(changes)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(changes) k WHERE k NOT IN('estado','is_blocked','blocked_reason','completed_at','cancelled_at','assigned_to','due_date','prioridad')) THEN RAISE EXCEPTION 'task_mutation_invalid' USING ERRCODE='22023';END IF;
 -- Serialize the membership and role grants used by this operation against revocation.
 PERFORM 1 FROM public.workspace_members m WHERE m.workspace_id=ws AND m.user_id=actor FOR SHARE;
 PERFORM 1 FROM public.organization_member_roles mr JOIN public.workspace_members m ON m.id=mr.member_id JOIN public.organization_roles r ON r.id=mr.role_id JOIN public.organization_role_permissions rp ON rp.role_id=r.id WHERE mr.workspace_id=ws AND m.user_id=actor FOR SHARE OF mr,r,rp;
 SELECT * INTO current FROM public.tareas WHERE id=task_id AND workspace_id=ws FOR UPDATE;
 permission:=CASE action WHEN 'complete' THEN 'tasks.complete' WHEN 'cancel' THEN 'tasks.cancel' WHEN 'reassign' THEN 'tasks.assign' ELSE 'tasks.edit' END;
 IF current.id IS NULL OR NOT private.organization_actor_resource_allowed(ws,actor,permission,'task',task_id) THEN RAISE EXCEPTION 'organization_mutation_scope_denied' USING ERRCODE='42501';END IF;
 IF current.optimistic_version<>expected_version THEN RAISE EXCEPTION 'task_version_conflict' USING ERRCODE='40001';END IF;
 IF current.estado IN('completada','cancelada','rechazada') AND action<>'reopen' THEN RAISE EXCEPTION 'task_closed' USING ERRCODE='23514';END IF;
 IF action='reopen' AND current.estado NOT IN('completada','cancelada','rechazada') OR action='unblock' AND NOT coalesce(current.is_blocked,false) OR action='complete' AND coalesce(current.is_blocked,false) THEN RAISE EXCEPTION 'task_transition_invalid' USING ERRCODE='23514';END IF;
 IF action IN('block','cancel','reopen') AND nullif(btrim(reason),'') IS NULL THEN RAISE EXCEPTION 'task_reason_required' USING ERRCODE='22023';END IF;
 IF changes ? 'assigned_to' AND changes->>'assigned_to' IS DISTINCT FROM current.assigned_to::text THEN
  assignee:=private.organization_scope_uuid(changes->>'assigned_to');
  IF NOT private.organization_actor_resource_allowed(ws,actor,'tasks.assign','task',task_id) OR (assignee IS NOT NULL AND NOT private.organization_actor_new_resource_allowed(ws,'tasks.assign','task',ARRAY[assignee],'{}',NULL,actor)) THEN RAISE EXCEPTION 'organization_mutation_scope_denied' USING ERRCODE='42501';END IF;
  IF changes->>'assigned_to' IS NOT NULL AND assignee IS NULL THEN RAISE EXCEPTION 'task_mutation_invalid' USING ERRCODE='22023';END IF;
 END IF;
 IF (changes ? 'prioridad' OR changes ? 'due_date') AND NOT private.organization_actor_resource_allowed(ws,actor,'tasks.edit','task',task_id) THEN RAISE EXCEPTION 'organization_mutation_scope_denied' USING ERRCODE='42501';END IF;
 IF changes ? 'prioridad' AND changes->>'prioridad' NOT IN('critica','alta','media','baja') THEN RAISE EXCEPTION 'task_mutation_invalid' USING ERRCODE='22023';END IF;

 IF action='start' AND (to_jsonb(current)->>'scheduled_for')::timestamptz>now() THEN RAISE EXCEPTION 'task_not_due' USING ERRCODE='23514';END IF;
 IF action='complete' THEN
  IF EXISTS(SELECT 1 FROM public.task_checklist_items WHERE tarea_id=task_id AND workspace_id=ws AND NOT done) OR EXISTS(SELECT 1 FROM public.task_dependencies d JOIN public.tareas t ON t.id=d.depends_on_id AND t.workspace_id=ws WHERE d.workspace_id=ws AND d.tarea_id=task_id AND t.estado<>'completada') THEN RAISE EXCEPTION 'task_completion_pending' USING ERRCODE='23514';END IF;
  IF (to_jsonb(current)->>'origin'='sistema' AND to_jsonb(current)->>'source_id' IS NOT NULL) OR (to_jsonb(current)->>'tipo' IN('retomar_borrador','firmar_documento','responder_formulario','validar_identidad','cerrar_expediente','subir_anexo','obtener_nom151') AND to_jsonb(current)->>'source_type' IN('document','form_token','user','case_file','participant_requirement')) THEN RAISE EXCEPTION 'task_source_action_required' USING ERRCODE='23514';END IF;
  IF char_length(btrim(coalesce(reason,'')))<15 OR char_length(reason)>1000 THEN RAISE EXCEPTION 'task_result_required' USING ERRCODE='22023';END IF;
 END IF;
 next_state:=CASE action WHEN 'start' THEN 'en_proceso' WHEN 'complete' THEN 'completada' WHEN 'block' THEN 'bloqueada' WHEN 'unblock' THEN 'pendiente' WHEN 'request_review' THEN 'en_revision' WHEN 'reopen' THEN 'pendiente' WHEN 'cancel' THEN 'cancelada' ELSE current.estado END;
 UPDATE public.tareas SET estado=next_state::public.tarea_estado,
 resolution_note=CASE WHEN action='complete' THEN reason ELSE current.resolution_note END,
 responsible_name=CASE WHEN changes ? 'assigned_to' THEN (SELECT coalesce(p.full_name,p.email) FROM public.user_profiles p WHERE p.id=private.organization_scope_uuid(changes->>'assigned_to')) ELSE current.responsible_name END,
 is_critical=coalesce(changes->>'prioridad',current.prioridad::text)='critica',
 assigned_to=CASE WHEN changes ? 'assigned_to' THEN private.organization_scope_uuid(changes->>'assigned_to') ELSE current.assigned_to END,
 due_date=CASE WHEN changes ? 'due_date' THEN (changes->>'due_date')::timestamptz ELSE current.due_date END,
 prioridad=coalesce(changes->>'prioridad',current.prioridad::text)::public.tarea_prioridad,
 is_blocked=CASE WHEN action='block' THEN true WHEN action IN('unblock','reopen') THEN false ELSE current.is_blocked END,
 blocked_reason=CASE WHEN action IN('block','cancel') THEN reason WHEN action IN('unblock','reopen') THEN NULL ELSE current.blocked_reason END,
 completed_at=CASE WHEN action='complete' THEN now() WHEN action='reopen' THEN NULL ELSE current.completed_at END,
 cancelled_at=CASE WHEN action='cancel' THEN now() WHEN action='reopen' THEN NULL ELSE current.cancelled_at END,
 optimistic_version=current.optimistic_version+1,updated_at=now()
 WHERE id=task_id AND workspace_id=ws RETURNING * INTO result;
 SELECT full_name INTO profile_name FROM public.user_profiles WHERE id=actor;
 INSERT INTO public.task_history(tarea_id,workspace_id,action,actor_id,actor_name,metadata) VALUES(task_id,ws,'Tarea: '||action,actor,coalesce(profile_name,'Usuario'),jsonb_build_object('reason',reason));
 RETURN to_jsonb(result);
END;$$;
REVOKE ALL ON FUNCTION public.colabora_mutate_task(uuid,uuid,uuid,text,integer,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_mutate_task(uuid,uuid,uuid,text,integer,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.colabora_bulk_mutate_tasks(ws uuid,actor uuid,items jsonb,action text,changes jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb;result jsonb;results jsonb:='[]';code text;
BEGIN
 IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items)<1 OR jsonb_array_length(items)>25 OR action NOT IN('start','request_review','reassign','update') THEN RAISE EXCEPTION 'task_mutation_invalid' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(items))<>jsonb_array_length(items) THEN RAISE EXCEPTION 'task_mutation_invalid' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(items) ORDER BY value->>'id' LOOP
  BEGIN
   result:=public.colabora_mutate_task(ws,(item->>'id')::uuid,actor,action,(item->>'optimistic_version')::integer,changes,NULL);
   results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','success',true,'data',result));
  EXCEPTION WHEN OTHERS THEN
   code:=CASE WHEN SQLERRM IN('organization_mutation_scope_denied','task_version_conflict','task_closed','task_transition_invalid','task_mutation_invalid','task_not_due') THEN SQLERRM ELSE 'task_update_failed' END;
   results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','success',false,'code',code));
  END;
 END LOOP;
 RETURN results;
END;$$;
REVOKE ALL ON FUNCTION public.colabora_bulk_mutate_tasks(uuid,uuid,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.colabora_bulk_mutate_tasks(uuid,uuid,jsonb,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
