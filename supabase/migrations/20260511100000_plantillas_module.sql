-- Plantillas Module Migration
-- Creates the plantillas table for storing document templates with variable fields

CREATE TABLE IF NOT EXISTS public.plantillas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Nueva Plantilla',
  description TEXT,
  category TEXT DEFAULT 'Otro',
  language TEXT DEFAULT 'Español',
  requires_efirma BOOLEAN DEFAULT false,
  requires_nom151 BOOLEAN DEFAULT false,
  signer_roles JSONB DEFAULT '[]'::jsonb,
  fields JSONB DEFAULT '[]'::jsonb,
  content JSONB DEFAULT '{}'::jsonb,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plantillas_workspace_id ON public.plantillas(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plantillas_created_by ON public.plantillas(created_by);
CREATE INDEX IF NOT EXISTS idx_plantillas_status ON public.plantillas(status);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_plantillas_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plantillas_updated_at ON public.plantillas;
CREATE TRIGGER plantillas_updated_at
  BEFORE UPDATE ON public.plantillas
  FOR EACH ROW EXECUTE FUNCTION public.update_plantillas_updated_at();

ALTER TABLE public.plantillas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_plantillas" ON public.plantillas;
CREATE POLICY "users_manage_own_plantillas"
ON public.plantillas
FOR ALL
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());
