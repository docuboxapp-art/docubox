-- Connect published organization governance to documents without changing
-- the behavior of workspaces that do not configure defaults.

ALTER TABLE public.documentos
  ADD COLUMN IF NOT EXISTS organization_workflow_id UUID
    REFERENCES public.organization_approval_workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_signature_policy_id UUID
    REFERENCES public.organization_signature_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_workflow_instance_id UUID
    REFERENCES public.organization_workflow_instances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_governance_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS organization_governance_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documentos_organization_workflow
  ON public.documentos(workspace_id, organization_workflow_id)
  WHERE organization_workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documentos_organization_policy
  ON public.documentos(workspace_id, organization_signature_policy_id)
  WHERE organization_signature_policy_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_document_governance_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF TG_OP = 'INSERT' AND (
      NEW.organization_workflow_id IS NOT NULL
      OR NEW.organization_signature_policy_id IS NOT NULL
      OR NEW.organization_workflow_instance_id IS NOT NULL
      OR NEW.organization_governance_snapshot IS NOT NULL
      OR NEW.organization_governance_applied_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'document_governance_is_backend_managed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND (
      NEW.organization_workflow_id IS DISTINCT FROM OLD.organization_workflow_id
      OR NEW.organization_signature_policy_id IS DISTINCT FROM OLD.organization_signature_policy_id
      OR NEW.organization_workflow_instance_id IS DISTINCT FROM OLD.organization_workflow_instance_id
      OR NEW.organization_governance_snapshot IS DISTINCT FROM OLD.organization_governance_snapshot
      OR NEW.organization_governance_applied_at IS DISTINCT FROM OLD.organization_governance_applied_at
    ) THEN
      RAISE EXCEPTION 'document_governance_is_backend_managed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_document_governance_snapshot ON public.documentos;
CREATE TRIGGER protect_document_governance_snapshot
  BEFORE INSERT OR UPDATE ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.protect_document_governance_snapshot();

REVOKE ALL ON FUNCTION public.protect_document_governance_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.protect_document_governance_snapshot() TO authenticated, service_role;

COMMENT ON COLUMN public.documentos.organization_governance_snapshot IS
  'Immutable snapshot of the published workflow and signature policy applied when the document was sent.';

CREATE OR REPLACE FUNCTION public.set_organization_governance_default(
  ws_id UUID,
  requested_kind TEXT,
  requested_resource_id UUID DEFAULT NULL,
  requested_correlation_id UUID DEFAULT gen_random_uuid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  required_permission TEXT;
  setting_key TEXT;
  resource_type_name TEXT;
  resource_name TEXT;
  resource_version INTEGER;
  before_settings JSONB;
  after_settings JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  CASE requested_kind
    WHEN 'workflow' THEN
      required_permission := 'workflows.manage';
      setting_key := 'default_workflow_id';
      resource_type_name := 'organization_approval_workflow';
    WHEN 'signature_policy' THEN
      required_permission := 'signature_policies.manage';
      setting_key := 'default_signature_policy_id';
      resource_type_name := 'organization_signature_policy';
    ELSE
      RAISE EXCEPTION 'invalid_governance_kind' USING ERRCODE = '22023';
  END CASE;

  IF NOT public.has_organization_permission(ws_id, required_permission) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF requested_resource_id IS NOT NULL THEN
    IF requested_kind = 'workflow' THEN
      SELECT name, version INTO resource_name, resource_version
      FROM public.organization_approval_workflows
      WHERE workspace_id = ws_id
        AND id = requested_resource_id
        AND status = 'published';
    ELSE
      SELECT name, version INTO resource_name, resource_version
      FROM public.organization_signature_policies
      WHERE workspace_id = ws_id
        AND id = requested_resource_id
        AND status = 'published';
    END IF;

    IF resource_name IS NULL THEN
      RAISE EXCEPTION 'published_resource_required' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT COALESCE(organization_settings, '{}'::JSONB)
  INTO before_settings
  FROM public.workspaces
  WHERE id = ws_id
    AND workspace_type = 'business'
    AND organization_enabled = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF requested_resource_id IS NULL THEN
    after_settings := before_settings - setting_key;
  ELSE
    after_settings := jsonb_set(
      before_settings,
      ARRAY[setting_key],
      to_jsonb(requested_resource_id::TEXT),
      TRUE
    );
  END IF;

  UPDATE public.workspaces
  SET organization_settings = after_settings
  WHERE id = ws_id;

  INSERT INTO public.organization_audit_events (
    workspace_id,
    actor_user_id,
    event_type,
    resource_type,
    resource_id,
    summary,
    before_payload,
    after_payload,
    payload,
    outcome,
    severity,
    module,
    origin,
    correlation_id
  ) VALUES (
    ws_id,
    auth.uid(),
    format('governance.default.%s.updated', requested_kind),
    resource_type_name,
    requested_resource_id::TEXT,
    CASE
      WHEN requested_resource_id IS NULL THEN 'Se retiró el valor predeterminado'
      ELSE format('Se estableció %s como predeterminado', resource_name)
    END,
    jsonb_build_object(setting_key, before_settings -> setting_key),
    jsonb_build_object(setting_key, requested_resource_id),
    jsonb_build_object('version', resource_version),
    'success',
    'high',
    'governance',
    'api',
    requested_correlation_id
  );

  RETURN jsonb_build_object(
    'kind', requested_kind,
    'resource_id', requested_resource_id,
    'resource_name', resource_name,
    'resource_version', resource_version,
    'settings', after_settings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_governance_default(UUID, TEXT, UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_organization_governance_default(UUID, TEXT, UUID, UUID)
  TO authenticated;
