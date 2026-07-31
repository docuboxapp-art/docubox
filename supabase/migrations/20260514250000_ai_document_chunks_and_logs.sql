-- ============================================================
-- AI Document Chunks (RAG) + AI Query Logs
-- ============================================================

-- Enable pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- ai_document_chunks: stores text chunks + embeddings for RAG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_document_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  content         text NOT NULL,
  embedding       vector(1536),
  page_number     integer,
  chunk_index     integer NOT NULL DEFAULT 0,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_document_chunks_document_id_idx
  ON public.ai_document_chunks (document_id);

CREATE INDEX IF NOT EXISTS ai_document_chunks_workspace_id_idx
  ON public.ai_document_chunks (workspace_id);

-- Vector similarity index (IVFFlat for cosine similarity)
CREATE INDEX IF NOT EXISTS ai_document_chunks_embedding_idx
  ON public.ai_document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RLS
ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_chunks_workspace_member_read" ON public.ai_document_chunks;
CREATE POLICY "ai_chunks_workspace_member_read"
  ON public.ai_document_chunks
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id
      FROM public.workspace_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_chunks_workspace_member_insert" ON public.ai_document_chunks;
CREATE POLICY "ai_chunks_workspace_member_insert"
  ON public.ai_document_chunks
  FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id
      FROM public.workspace_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ai_chunks_service_role_all" ON public.ai_document_chunks;
CREATE POLICY "ai_chunks_service_role_all"
  ON public.ai_document_chunks
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- ai_query_logs: audit log for every LucIA query
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_query_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  session_id      uuid,
  question        text NOT NULL,
  intent          text,
  scope           text,
  document_id     uuid,
  context_used    jsonb DEFAULT '{}'::jsonb,
  response_text   text,
  tokens_used     integer,
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_query_logs_workspace_id_idx
  ON public.ai_query_logs (workspace_id);

CREATE INDEX IF NOT EXISTS ai_query_logs_user_id_idx
  ON public.ai_query_logs (user_id);

CREATE INDEX IF NOT EXISTS ai_query_logs_created_at_idx
  ON public.ai_query_logs (created_at DESC);

-- RLS
ALTER TABLE public.ai_query_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_logs_own_read" ON public.ai_query_logs;
CREATE POLICY "ai_logs_own_read"
  ON public.ai_query_logs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_logs_service_role_all" ON public.ai_query_logs;
CREATE POLICY "ai_logs_service_role_all"
  ON public.ai_query_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);
