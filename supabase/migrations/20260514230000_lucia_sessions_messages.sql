-- Migration: LucIA Sessions and Messages
-- Creates tables for persisting LucIA chat sessions and messages per user

-- 1. Create lucia_sessions table
CREATE TABLE IF NOT EXISTS public.lucia_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nueva conversación',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create lucia_messages table
CREATE TABLE IF NOT EXISTS public.lucia_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.lucia_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_lucia_sessions_user_id ON public.lucia_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_lucia_sessions_updated_at ON public.lucia_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lucia_messages_session_id ON public.lucia_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_lucia_messages_user_id ON public.lucia_messages(user_id);

-- 4. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_lucia_session_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 5. Enable RLS
ALTER TABLE public.lucia_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lucia_messages ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for lucia_sessions
DROP POLICY IF EXISTS "users_manage_own_lucia_sessions" ON public.lucia_sessions;
CREATE POLICY "users_manage_own_lucia_sessions"
ON public.lucia_sessions
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 7. RLS Policies for lucia_messages
DROP POLICY IF EXISTS "users_manage_own_lucia_messages" ON public.lucia_messages;
CREATE POLICY "users_manage_own_lucia_messages"
ON public.lucia_messages
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 8. Trigger for updated_at on lucia_sessions
DROP TRIGGER IF EXISTS set_lucia_session_updated_at ON public.lucia_sessions;
CREATE TRIGGER set_lucia_session_updated_at
  BEFORE UPDATE ON public.lucia_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_lucia_session_updated_at();
