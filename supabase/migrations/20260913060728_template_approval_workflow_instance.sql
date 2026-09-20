ALTER TABLE public.plantillas
  ADD COLUMN IF NOT EXISTS approval_workflow_instance_id UUID
    REFERENCES public.organization_workflow_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plantillas_approval_workflow_instance
  ON public.plantillas(approval_workflow_instance_id)
  WHERE approval_workflow_instance_id IS NOT NULL;

COMMENT ON COLUMN public.plantillas.approval_workflow_instance_id IS
  'Runtime workflow instance created when this template version is submitted for approval.';

CREATE OR REPLACE FUNCTION public.submit_template_for_approval(
  ws_id UUID,
  target_template_id UUID,
  target_workflow_id UUID,
  requested_context JSONB,
  requested_idempotency_key UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  template_record public.plantillas%ROWTYPE;
  instance_id UUID;
BEGIN
  SELECT * INTO template_record
  FROM public.plantillas
  WHERE id = target_template_id AND workspace_id = ws_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF template_record.created_by <> auth.uid()
     AND NOT public.has_organization_permission(ws_id, 'resources.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF template_record.estado <> 'draft' OR template_record.approval_workflow_instance_id IS NOT NULL THEN
    RAISE EXCEPTION 'template_cannot_be_submitted_for_approval' USING ERRCODE = '55000';
  END IF;

  instance_id := public.start_organization_workflow_instance(
    ws_id,
    target_workflow_id,
    'document_template',
    target_template_id::TEXT,
    COALESCE(requested_context, '{}'::JSONB),
    requested_idempotency_key
  );

  UPDATE public.plantillas
  SET estado = 'in_review',
      estado_plantilla = 'En revisión',
      publicacion_opcion = 'aprobacion',
      approval_workflow_id = target_workflow_id,
      approval_workflow_instance_id = instance_id
  WHERE id = target_template_id;

  RETURN instance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_template_for_approval(
  UUID, UUID, UUID, JSONB, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_template_for_approval(
  UUID, UUID, UUID, JSONB, UUID
) TO authenticated;
