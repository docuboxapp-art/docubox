CREATE OR REPLACE FUNCTION public.get_organization_person_document_history(ws_id uuid,target_person_id uuid,page_offset integer DEFAULT 0,page_size integer DEFAULT 50)
RETURNS TABLE(id uuid,documento_id text,nombre text,estado text,created_at timestamptz,fecha_completado timestamptz,total_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $history$
 WITH person AS (
  SELECT p.id,lower(p.email) email,m.user_id FROM public.organization_directory_people p
  LEFT JOIN public.workspace_members m ON m.id=p.member_id AND m.workspace_id=ws_id
  WHERE p.id=target_person_id AND p.workspace_id=ws_id AND auth.uid() IS NOT NULL
   AND public.has_organization_permission(ws_id,'directory.read') AND public.has_organization_permission(ws_id,'documents.read')
 )
 SELECT d.id,d.documento_id,d.nombre,d.estado::text,d.created_at,d.fecha_completado,count(*) OVER()
 FROM public.documentos d CROSS JOIN person p
 WHERE d.workspace_id=ws_id AND d.deleted_at IS NULL AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.participantes)='array' THEN d.participantes ELSE '[]'::jsonb END) participant
  WHERE (p.email IS NOT NULL AND p.email<>'' AND lower(participant->>'email')=p.email)
   OR (p.user_id IS NOT NULL AND participant->>'user_id'=p.user_id::text)
   OR participant->>'directory_person_id'=p.id::text OR participant->>'organization_directory_person_id'=p.id::text
   OR participant->>'organizationDirectoryPersonId'=p.id::text
 )
 ORDER BY d.created_at DESC,d.id DESC LIMIT greatest(1,least(page_size,100)) OFFSET greatest(page_offset,0);
$history$;
REVOKE ALL ON FUNCTION public.get_organization_person_document_history(uuid,uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_organization_person_document_history(uuid,uuid,integer,integer) TO authenticated;
