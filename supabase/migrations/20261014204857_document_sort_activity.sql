-- Sorting metadata for the authenticated user's own document interactions.
-- Existing RLS on document_activity_log remains in force (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.my_document_sort_activity(p_document_ids uuid[])
RETURNS TABLE (
  documento_id uuid,
  last_opened_at timestamptz,
  last_edited_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT log.documento_id,
         max(log.created_at) FILTER (WHERE log.action IN ('documento_visto', 'documento_abierto')),
         max(log.created_at) FILTER (WHERE log.action = 'documento_editado')
  FROM public.document_activity_log AS log
  WHERE log.actor_id = (SELECT auth.uid())
    AND log.documento_id = ANY(p_document_ids)
    AND log.action IN ('documento_visto', 'documento_abierto', 'documento_editado')
  GROUP BY log.documento_id;
$$;

REVOKE ALL ON FUNCTION public.my_document_sort_activity(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_document_sort_activity(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.my_document_sort_activity(uuid[]) IS
  'Latest opening and editing events recorded for the current user and requested documents; document_activity_log RLS applies.';
