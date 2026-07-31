-- Migration: workflow_flows table
-- Stores workflow flow configurations for documents

CREATE TABLE IF NOT EXISTS public.workflow_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id UUID REFERENCES public.documentos(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  nombre TEXT NOT NULL DEFAULT 'Flujo de Trabajo',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workflow_flows_documento_id ON public.workflow_flows(documento_id);
CREATE INDEX IF NOT EXISTS idx_workflow_flows_created_by ON public.workflow_flows(created_by);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_workflow_flows_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_flows_updated_at ON public.workflow_flows;
CREATE TRIGGER workflow_flows_updated_at
  BEFORE UPDATE ON public.workflow_flows
  FOR EACH ROW
  EXECUTE FUNCTION public.update_workflow_flows_updated_at();

ALTER TABLE public.workflow_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_workflow_flows" ON public.workflow_flows;
CREATE POLICY "users_manage_own_workflow_flows"
  ON public.workflow_flows
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
