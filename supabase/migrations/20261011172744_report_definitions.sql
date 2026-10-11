CREATE TABLE public.report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 3 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  dataset text NOT NULL CHECK (dataset IN ('documentos','plantillas','formularios','respuestas','expedientes','tareas','participantes','actividad','usuarios')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_definitions_workspace_updated_idx
  ON public.report_definitions(workspace_id, updated_at DESC);
ALTER TABLE public.report_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_definitions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_definitions TO authenticated;

CREATE POLICY report_definitions_select ON public.report_definitions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = report_definitions.workspace_id
      AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'
  ));
CREATE POLICY report_definitions_insert ON public.report_definitions
  FOR INSERT TO authenticated WITH CHECK (
    created_by = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = report_definitions.workspace_id
        AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'
    )
  );
CREATE POLICY report_definitions_update ON public.report_definitions
  FOR UPDATE TO authenticated USING (
    created_by = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = report_definitions.workspace_id
        AND m.user_id = (SELECT auth.uid()) AND m.status = 'active' AND m.role IN ('owner','admin')
    )
  ) WITH CHECK (
    created_by = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = report_definitions.workspace_id
        AND m.user_id = (SELECT auth.uid()) AND m.status = 'active'
    )
  );
CREATE POLICY report_definitions_delete ON public.report_definitions
  FOR DELETE TO authenticated USING (
    created_by = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = report_definitions.workspace_id
        AND m.user_id = (SELECT auth.uid()) AND m.status = 'active' AND m.role IN ('owner','admin')
    )
  );

CREATE FUNCTION public.touch_report_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER report_definitions_updated_at BEFORE UPDATE ON public.report_definitions
  FOR EACH ROW EXECUTE FUNCTION public.touch_report_definition();
