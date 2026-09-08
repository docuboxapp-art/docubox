-- Keep the vector RPC on an empty search_path while resolving pgvector's
-- distance operator explicitly from the schema where the extension is installed.

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding public.vector(1536),
  p_workspace_id uuid,
  p_document_id uuid,
  p_allowed_document_ids uuid[],
  match_threshold float DEFAULT 0.70,
  match_count int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  workspace_id uuid,
  content text,
  page_number integer,
  chunk_index integer,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR pg_catalog.coalesce(pg_catalog.array_length(p_allowed_document_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND (wm.access_expires_at IS NULL OR wm.access_expires_at > pg_catalog.now())
  ) THEN
    RETURN;
  END IF;

  IF p_document_id IS NOT NULL AND NOT (p_document_id = ANY(p_allowed_document_ids)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.workspace_id,
    c.content,
    c.page_number,
    c.chunk_index,
    c.metadata,
    1 - (c.embedding OPERATOR(public.<=>) query_embedding)
  FROM public.ai_document_chunks c
  WHERE c.workspace_id = p_workspace_id
    AND c.document_id = ANY(p_allowed_document_ids)
    AND (p_document_id IS NULL OR c.document_id = p_document_id)
    AND public.can_access_documento(c.document_id)
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding OPERATOR(public.<=>) query_embedding) >= match_threshold
  ORDER BY c.embedding OPERATOR(public.<=>) query_embedding
  LIMIT pg_catalog.least(pg_catalog.greatest(match_count, 1), 20);
END;
$$;

REVOKE ALL ON FUNCTION public.match_document_chunks(
  public.vector(1536), uuid, uuid, uuid[], float, int
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(
  public.vector(1536), uuid, uuid, uuid[], float, int
) TO authenticated;
