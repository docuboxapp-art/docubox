-- ============================================================
-- match_document_chunks: vector similarity search RPC
-- Used by LucIA RAG to find semantically relevant document chunks
-- ============================================================

-- Ensure pgvector is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop and recreate the match function
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, uuid, uuid, float, int);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector(1536), uuid, uuid, float, int);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding   vector(1536),
  p_workspace_id    uuid,
  p_document_id     uuid DEFAULT NULL,
  match_threshold   float DEFAULT 0.70,
  match_count       int   DEFAULT 8
)
RETURNS TABLE (
  id            uuid,
  document_id   uuid,
  workspace_id  uuid,
  content       text,
  page_number   integer,
  chunk_index   integer,
  metadata      jsonb,
  similarity    float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.workspace_id,
    c.content,
    c.page_number,
    c.chunk_index,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.ai_document_chunks c
  WHERE
    c.workspace_id = p_workspace_id
    AND (p_document_id IS NULL OR c.document_id = p_document_id)
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector(1536), uuid, uuid, float, int)
  TO authenticated, service_role;

-- ============================================================
-- get_document_chunks_count: helper to check if doc is embedded
-- ============================================================
DROP FUNCTION IF EXISTS public.get_document_chunks_count(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_document_chunks_count(
  p_document_id   uuid,
  p_workspace_id  uuid
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.ai_document_chunks
  WHERE document_id = p_document_id
    AND workspace_id = p_workspace_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_document_chunks_count(uuid, uuid)
  TO authenticated, service_role;
