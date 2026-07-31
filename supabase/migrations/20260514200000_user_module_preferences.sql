-- Migration: user_module_preferences
-- Stores the active App Market module selection per user
-- Replaces localStorage-based persistence

CREATE TABLE IF NOT EXISTS public.user_module_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  active_module_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_user_module_preferences_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_module_preferences_user_id
  ON public.user_module_preferences(user_id);

ALTER TABLE public.user_module_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_module_preferences" ON public.user_module_preferences;
CREATE POLICY "users_manage_own_module_preferences"
  ON public.user_module_preferences
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
