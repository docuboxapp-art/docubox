-- Confirm a direct private-storage upload and its audit event atomically.
CREATE OR REPLACE FUNCTION public.finalize_organization_directory_evidence(ws uuid,actor uuid,evidence_id uuid,evidence_values jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person public.organization_directory_people;existing public.organization_directory_evidence;next_version integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=ws AND w.workspace_type='business' AND coalesce(w.organization_enabled,true)) OR NOT private.organization_actor_context_allowed(ws,'directory.manage',jsonb_build_object('owners',ARRAY[actor],'assigned','[]'::jsonb,'units','[]'::jsonb),actor) THEN RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE='42501';END IF;
 SELECT * INTO person FROM public.organization_directory_people WHERE id=(evidence_values->>'person_id')::uuid AND workspace_id=ws FOR UPDATE;
 IF person.id IS NULL THEN RAISE EXCEPTION 'catalog_record_not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO existing FROM public.organization_directory_evidence WHERE id=evidence_id;
 IF existing.id IS NOT NULL THEN
  IF existing.workspace_id<>ws OR existing.person_id<>person.id OR existing.storage_path IS DISTINCT FROM evidence_values->>'storage_path' OR existing.sha256_hash IS DISTINCT FROM evidence_values->>'sha256_hash' THEN RAISE EXCEPTION 'catalog_relation_scope' USING ERRCODE='42501';END IF;
  RETURN existing.id;
 END IF;
 IF NOT coalesce(
 evidence_values->>'storage_path' LIKE ws::text||'/'||person.id::text||'/'||evidence_id::text||'-%'
 AND evidence_values->>'sha256_hash' ~ '^[a-f0-9]{64}$' AND (evidence_values->>'size_bytes')::bigint BETWEEN 1 AND 15728640
 AND evidence_values->>'mime_type' IN('application/pdf','image/jpeg','image/png')
 AND length(btrim(evidence_values->>'display_name')) BETWEEN 2 AND 180
 AND length(btrim(evidence_values->>'evidence_type')) BETWEEN 2 AND 80
 AND length(btrim(evidence_values->>'file_name')) BETWEEN 1 AND 255
 AND ((evidence_values->>'valid_from') IS NULL OR (evidence_values->>'valid_until') IS NULL
   OR (evidence_values->>'valid_from')::date<=(evidence_values->>'valid_until')::date),false)
 THEN RAISE EXCEPTION 'catalog_fields_invalid' USING ERRCODE='22023';END IF;
 SELECT coalesce(max(version),0)+1 INTO next_version FROM public.organization_directory_evidence WHERE person_id=person.id AND evidence_type=evidence_values->>'evidence_type';
 INSERT INTO public.organization_directory_evidence(id,workspace_id,person_id,created_by,evidence_type,display_name,storage_bucket,storage_path,mime_type,size_bytes,sha256_hash,valid_from,valid_until,status,metadata,version)
 VALUES(evidence_id,ws,person.id,actor,evidence_values->>'evidence_type',evidence_values->>'display_name','organization-evidence',evidence_values->>'storage_path',evidence_values->>'mime_type',(evidence_values->>'size_bytes')::bigint,evidence_values->>'sha256_hash',(evidence_values->>'valid_from')::date,(evidence_values->>'valid_until')::date,'pending',jsonb_build_object('original_file_name',evidence_values->>'file_name'),next_version);
 INSERT INTO public.organization_audit_events(workspace_id,actor_user_id,event_type,resource_type,resource_id,summary,payload,module,severity)
 VALUES(ws,actor,'directory.evidence.uploaded','organization_directory_evidence',evidence_id,'Documento probatorio cargado en almacenamiento privado',jsonb_build_object('person_id',person.id,'sha256_hash',evidence_values->>'sha256_hash','size_bytes',(evidence_values->>'size_bytes')::bigint,'version',next_version),'directory','high');
 RETURN evidence_id;
END;$$;
REVOKE ALL ON FUNCTION public.finalize_organization_directory_evidence(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_organization_directory_evidence(uuid,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.organization_directory_upload_available(ws_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT public.has_organization_permission(ws_id,'directory.manage') AND has_function_privilege('service_role','public.finalize_organization_directory_evidence(uuid,uuid,uuid,jsonb)','EXECUTE')
$$;
REVOKE ALL ON FUNCTION public.organization_directory_upload_available(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.organization_directory_upload_available(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
