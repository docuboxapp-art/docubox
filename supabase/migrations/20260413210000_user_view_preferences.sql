-- Migration: user_view_preferences
-- Stores column visibility/order and filter visibility/order preferences per user per view

CREATE TABLE IF NOT EXISTS public.user_view_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  view_key TEXT NOT NULL,
  columns_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  filters_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_view_preferences_user_view
  ON public.user_view_preferences (user_id, view_key);

CREATE INDEX IF NOT EXISTS idx_user_view_preferences_user_id
  ON public.user_view_preferences (user_id);

ALTER TABLE public.user_view_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_view_preferences" ON public.user_view_preferences;
CREATE POLICY "users_manage_own_view_preferences"
  ON public.user_view_preferences
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.update_user_view_preferences_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_view_preferences_updated_at ON public.user_view_preferences;
CREATE TRIGGER trg_user_view_preferences_updated_at
  BEFORE UPDATE ON public.user_view_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_view_preferences_updated_at();
