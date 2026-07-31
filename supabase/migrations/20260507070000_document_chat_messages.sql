-- Chat messages per document
-- Each document has its own chat thread between participants

CREATE TABLE IF NOT EXISTS public.document_chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID NOT NULL REFERENCES public.documentos(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  sender_nombre TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_documento_id ON public.document_chat_messages(documento_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at   ON public.document_chat_messages(documento_id, created_at);

ALTER TABLE public.document_chat_messages ENABLE ROW LEVEL SECURITY;

-- Participants of a document (stored in documentos.participantes JSONB) and the owner can read messages
DROP POLICY IF EXISTS "chat_select_participants" ON public.document_chat_messages;
CREATE POLICY "chat_select_participants"
ON public.document_chat_messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.documentos d
    WHERE d.id = document_chat_messages.documento_id
      AND (
        d.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) AS p
          WHERE (p->>'email') = public.current_user_email()
        )
      )
  )
);

-- Only the sender can insert their own messages
DROP POLICY IF EXISTS "chat_insert_own" ON public.document_chat_messages;
CREATE POLICY "chat_insert_own"
ON public.document_chat_messages
FOR INSERT
TO authenticated
WITH CHECK (sender_id = auth.uid());

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.document_chat_messages;
