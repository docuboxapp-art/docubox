-- Migration: document_metaetiquetas
-- Stores custom key-value metadata tags linked to documents

CREATE TABLE IF NOT EXISTS public.document_metaetiquetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id TEXT NOT NULL,
  clave TEXT NOT NULL,
  valor TEXT,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_metaetiquetas_doc_clave
  ON public.document_metaetiquetas (documento_id, clave);

CREATE INDEX IF NOT EXISTS idx_doc_metaetiquetas_documento_id
  ON public.document_metaetiquetas (documento_id);

CREATE INDEX IF NOT EXISTS idx_doc_metaetiquetas_user_id
  ON public.document_metaetiquetas (user_id);

ALTER TABLE public.document_metaetiquetas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_document_metaetiquetas" ON public.document_metaetiquetas;
CREATE POLICY "users_manage_own_document_metaetiquetas"
  ON public.document_metaetiquetas
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
