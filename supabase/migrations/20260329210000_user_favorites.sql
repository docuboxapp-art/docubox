-- Migration: user_favorites table
-- Stores favorite document types and grupo-tipo selections per user

CREATE TABLE IF NOT EXISTS public.user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_favorites_unique
  ON public.user_favorites (user_id, storage_key, item_id);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user_key
  ON public.user_favorites (user_id, storage_key);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_user_favorites" ON public.user_favorites;
CREATE POLICY "users_manage_own_user_favorites"
  ON public.user_favorites
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
