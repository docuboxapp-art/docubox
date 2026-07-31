-- Document Notes table for Notas y Comentarios feature
-- Stores notes, rejection notes, and cancellation notes for documents

CREATE TABLE IF NOT EXISTS public.document_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  author_nombre TEXT NOT NULL,
  content TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'general',
  -- tipo: 'general' | 'rechazo' | 'cancelacion'
  visibilidad TEXT NOT NULL DEFAULT 'privada',
  -- visibilidad: 'privada' | 'publica'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_notes_documento_id ON public.document_notes(documento_id);
CREATE INDEX IF NOT EXISTS idx_document_notes_author_id ON public.document_notes(author_id);

ALTER TABLE public.document_notes ENABLE ROW LEVEL SECURITY;

-- Owner and participants can read notes:
-- - Private notes: only the author can read
-- - Public notes: all participants and the document owner can read
-- Uses can_read_documento() SECURITY DEFINER function to avoid uuid=text operator issues
DROP POLICY IF EXISTS "document_notes_select" ON public.document_notes;
CREATE POLICY "document_notes_select"
ON public.document_notes
FOR SELECT
TO authenticated
USING (
  author_id = auth.uid()
  OR (
    visibilidad = 'publica'
    AND public.can_read_documento(documento_id)
  )
);

-- Authors can insert their own notes
DROP POLICY IF EXISTS "document_notes_insert" ON public.document_notes;
CREATE POLICY "document_notes_insert"
ON public.document_notes
FOR INSERT
TO authenticated
WITH CHECK (author_id = auth.uid());

-- Authors can delete their own notes
DROP POLICY IF EXISTS "document_notes_delete" ON public.document_notes;
CREATE POLICY "document_notes_delete"
ON public.document_notes
FOR DELETE
TO authenticated
USING (author_id = auth.uid());

-- Service role can insert system notes (rejection/cancellation)
DROP POLICY IF EXISTS "document_notes_service_insert" ON public.document_notes;
CREATE POLICY "document_notes_service_insert"
ON public.document_notes
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
