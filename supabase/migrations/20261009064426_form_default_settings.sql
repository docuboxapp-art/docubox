-- Predeterminados de formularios por usuario y espacio de trabajo.
CREATE TABLE IF NOT EXISTS public.form_default_settings (
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('experience', 'appearance', 'pdf')),
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id, kind)
);

ALTER TABLE public.form_default_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_default_settings_owner ON public.form_default_settings;
CREATE POLICY form_default_settings_owner ON public.form_default_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_default_settings TO authenticated;
