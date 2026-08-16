-- Organization governance phase 2
-- Extends the foundation without replacing document templates, forms or workflow instances.

ALTER TABLE public.organization_directory_people
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.workspace_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS person_type TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS area_name TEXT,
  ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS data_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sensitive_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_directory_member
  ON public.organization_directory_people(workspace_id, member_id)
  WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_directory_relationship
  ON public.organization_directory_people(workspace_id, relationship_type, status);

ALTER TABLE public.organization_authorities
  ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS legal_basis TEXT,
  ADD COLUMN IF NOT EXISTS monetary_limit NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS document_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS areas TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS required_representatives INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS identity_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.organization_authorities DROP CONSTRAINT IF EXISTS organization_authorities_status_check;
ALTER TABLE public.organization_authorities
  ADD CONSTRAINT organization_authorities_status_check
  CHECK (status IN ('draft', 'pending_validation', 'active', 'suspended', 'expired', 'revoked'));
ALTER TABLE public.organization_authorities
  DROP CONSTRAINT IF EXISTS organization_authorities_modality_check;
ALTER TABLE public.organization_authorities
  ADD CONSTRAINT organization_authorities_modality_check
  CHECK (modality IN ('individual', 'joint', 'several'));
ALTER TABLE public.organization_authorities
  DROP CONSTRAINT IF EXISTS organization_authorities_required_representatives_check;
ALTER TABLE public.organization_authorities
  ADD CONSTRAINT organization_authorities_required_representatives_check
  CHECK (required_representatives > 0);

ALTER TABLE public.organization_approval_workflows
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS applicable_areas TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_version_id UUID REFERENCES public.organization_approval_workflows(id) ON DELETE SET NULL;

ALTER TABLE public.organization_approval_workflows DROP CONSTRAINT IF EXISTS organization_approval_workflows_status_check;
ALTER TABLE public.organization_approval_workflows
  ADD CONSTRAINT organization_approval_workflows_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'archived'));
CREATE INDEX IF NOT EXISTS idx_org_workflow_catalog
  ON public.organization_approval_workflows(workspace_id, name, version DESC);

ALTER TABLE public.organization_signature_policies
  ADD COLUMN IF NOT EXISTS security_level TEXT NOT NULL DEFAULT 'basic',
  ADD COLUMN IF NOT EXISTS resource_scope TEXT[] NOT NULL DEFAULT ARRAY['documents']::TEXT[],
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_version_id UUID REFERENCES public.organization_signature_policies(id) ON DELETE SET NULL;

ALTER TABLE public.organization_signature_policies DROP CONSTRAINT IF EXISTS organization_signature_policies_status_check;
ALTER TABLE public.organization_signature_policies
  ADD CONSTRAINT organization_signature_policies_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'archived'));
ALTER TABLE public.organization_signature_policies
  DROP CONSTRAINT IF EXISTS organization_signature_policies_security_level_check;
ALTER TABLE public.organization_signature_policies
  ADD CONSTRAINT organization_signature_policies_security_level_check
  CHECK (security_level IN ('basic', 'reinforced', 'advanced', 'custom'));
CREATE INDEX IF NOT EXISTS idx_org_signature_policy_catalog
  ON public.organization_signature_policies(workspace_id, name, version DESC);

CREATE TABLE IF NOT EXISTS public.organization_directory_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.organization_directory_people(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  storage_path TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'expired', 'revoked')),
  valid_from DATE,
  valid_until DATE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (person_id, evidence_type, version)
);

CREATE TABLE IF NOT EXISTS public.organization_shared_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('document_template', 'form', 'clause', 'custom_field', 'taxonomy')),
  document_template_id UUID REFERENCES public.plantillas(id) ON DELETE SET NULL,
  form_template_id UUID REFERENCES public.form_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'organization' CHECK (visibility IN ('private', 'team', 'area', 'organization')),
  owner_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  custodian_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  workflow_id UUID REFERENCES public.organization_approval_workflows(id) ON DELETE SET NULL,
  signature_policy_id UUID REFERENCES public.organization_signature_policies(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'archived')),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (resource_type = 'document_template' AND document_template_id IS NOT NULL AND form_template_id IS NULL)
    OR (resource_type = 'form' AND form_template_id IS NOT NULL AND document_template_id IS NULL)
    OR (resource_type IN ('clause', 'custom_field', 'taxonomy') AND document_template_id IS NULL AND form_template_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_org_directory_evidence_person
  ON public.organization_directory_evidence(workspace_id, person_id, status);
CREATE INDEX IF NOT EXISTS idx_org_shared_resources_catalog
  ON public.organization_shared_resources(workspace_id, resource_type, status, updated_at DESC);

INSERT INTO public.organization_permissions (permission_key, name, description, category) VALUES
  ('directory.sensitive.read', 'Ver datos sensibles del directorio', 'Consultar identificadores y evidencia restringida.', 'Personas'),
  ('directory.sensitive.download', 'Descargar evidencia del directorio', 'Descargar identificaciones y documentos probatorios.', 'Personas')
ON CONFLICT (permission_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

INSERT INTO public.organization_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM public.organization_roles role
CROSS JOIN public.organization_permissions permission
WHERE role.system_key IN ('owner', 'admin')
  AND permission.permission_key IN ('directory.sensitive.read', 'directory.sensitive.download')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.organization_phase2_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_directory_evidence_updated_at ON public.organization_directory_evidence;
CREATE TRIGGER organization_directory_evidence_updated_at
  BEFORE UPDATE ON public.organization_directory_evidence
  FOR EACH ROW EXECUTE FUNCTION public.organization_phase2_set_updated_at();
DROP TRIGGER IF EXISTS organization_shared_resources_updated_at ON public.organization_shared_resources;
CREATE TRIGGER organization_shared_resources_updated_at
  BEFORE UPDATE ON public.organization_shared_resources
  FOR EACH ROW EXECUTE FUNCTION public.organization_phase2_set_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_organization_phase2_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'organization_directory_people' AND NEW.member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.id = NEW.member_id AND member.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_directory_member_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'organization_directory_evidence' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_directory_people person
      WHERE person.id = NEW.person_id AND person.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_directory_evidence_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'organization_shared_resources' THEN
    IF NEW.document_template_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.plantillas item
      WHERE item.id = NEW.document_template_id AND item.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_document_template_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.form_template_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.form_templates item
      WHERE item.id = NEW.form_template_id AND item.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_form_template_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.workflow_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organization_approval_workflows item
      WHERE item.id = NEW.workflow_id AND item.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_resource_workflow_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
    IF NEW.signature_policy_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.organization_signature_policies item
      WHERE item.id = NEW.signature_policy_id AND item.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_resource_policy_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_org_directory_member_scope ON public.organization_directory_people;
CREATE TRIGGER enforce_org_directory_member_scope
  BEFORE INSERT OR UPDATE ON public.organization_directory_people
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_phase2_tenant_scope();
DROP TRIGGER IF EXISTS enforce_org_directory_evidence_scope ON public.organization_directory_evidence;
CREATE TRIGGER enforce_org_directory_evidence_scope
  BEFORE INSERT OR UPDATE ON public.organization_directory_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_phase2_tenant_scope();
DROP TRIGGER IF EXISTS enforce_org_shared_resource_scope ON public.organization_shared_resources;
CREATE TRIGGER enforce_org_shared_resource_scope
  BEFORE INSERT OR UPDATE ON public.organization_shared_resources
  FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_phase2_tenant_scope();

CREATE OR REPLACE FUNCTION public.protect_published_organization_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'published' THEN
    IF TG_TABLE_NAME = 'organization_approval_workflows'
       AND (NEW.name, NEW.description, NEW.version, NEW.definition, NEW.document_type, NEW.applicable_areas)
           IS DISTINCT FROM
           (OLD.name, OLD.description, OLD.version, OLD.definition, OLD.document_type, OLD.applicable_areas) THEN
      RAISE EXCEPTION 'published_workflow_is_immutable' USING ERRCODE = '55000';
    ELSIF TG_TABLE_NAME = 'organization_signature_policies'
       AND (NEW.name, NEW.description, NEW.version, NEW.security_level, NEW.resource_scope, NEW.allowed_signature_types, NEW.requirements)
           IS DISTINCT FROM
           (OLD.name, OLD.description, OLD.version, OLD.security_level, OLD.resource_scope, OLD.allowed_signature_types, OLD.requirements) THEN
      RAISE EXCEPTION 'published_signature_policy_is_immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_published_org_workflow ON public.organization_approval_workflows;
CREATE TRIGGER protect_published_org_workflow
  BEFORE UPDATE ON public.organization_approval_workflows
  FOR EACH ROW EXECUTE FUNCTION public.protect_published_organization_governance();
DROP TRIGGER IF EXISTS protect_published_org_signature_policy ON public.organization_signature_policies;
CREATE TRIGGER protect_published_org_signature_policy
  BEFORE UPDATE ON public.organization_signature_policies
  FOR EACH ROW EXECUTE FUNCTION public.protect_published_organization_governance();

CREATE OR REPLACE FUNCTION public.publish_organization_workflow(ws_id UUID, target_workflow_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  workflow_record public.organization_approval_workflows%ROWTYPE;
  step JSONB;
  has_start BOOLEAN := FALSE;
  has_terminal BOOLEAN := FALSE;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'workflows.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO workflow_record FROM public.organization_approval_workflows
  WHERE id = target_workflow_id AND workspace_id = ws_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_workflow_not_found' USING ERRCODE = 'P0002'; END IF;
  IF workflow_record.status <> 'draft' THEN RAISE EXCEPTION 'only_draft_workflows_can_be_published' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(workflow_record.definition->'steps') <> 'array'
     OR jsonb_array_length(workflow_record.definition->'steps') < 2 THEN
    RAISE EXCEPTION 'workflow_requires_at_least_two_steps' USING ERRCODE = '23514';
  END IF;
  FOR step IN SELECT value FROM jsonb_array_elements(workflow_record.definition->'steps') LOOP
    IF COALESCE(step->>'type', '') NOT IN ('start', 'review', 'approval', 'signature', 'identity', 'condition', 'notification', 'wait', 'approved', 'rejected', 'cancelled')
       OR NULLIF(BTRIM(step->>'label'), '') IS NULL THEN
      RAISE EXCEPTION 'workflow_contains_invalid_step' USING ERRCODE = '23514';
    END IF;
    has_start := has_start OR step->>'type' = 'start';
    has_terminal := has_terminal OR step->>'type' IN ('approved', 'rejected', 'cancelled');
  END LOOP;
  IF NOT has_start OR NOT has_terminal THEN
    RAISE EXCEPTION 'workflow_requires_start_and_terminal_steps' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_approval_workflows
  SET status = 'published', published_at = CURRENT_TIMESTAMP, published_by = auth.uid(), updated_at = CURRENT_TIMESTAMP
  WHERE id = target_workflow_id;
  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload)
  VALUES (ws_id, auth.uid(), 'workflow.published', 'organization_approval_workflow', target_workflow_id::TEXT,
    'Flujo de aprobación publicado', jsonb_build_object('version', workflow_record.version));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization_workflow_version(ws_id UUID, source_workflow_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_record public.organization_approval_workflows%ROWTYPE;
  new_id UUID;
  next_version INTEGER;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'workflows.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO source_record FROM public.organization_approval_workflows
  WHERE id = source_workflow_id AND workspace_id = ws_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_workflow_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM public.organization_approval_workflows WHERE workspace_id = ws_id AND name = source_record.name;
  INSERT INTO public.organization_approval_workflows (
    workspace_id, name, description, version, definition, status, document_type, applicable_areas, source_version_id, created_by
  ) VALUES (
    ws_id, source_record.name, source_record.description, next_version, source_record.definition, 'draft',
    source_record.document_type, source_record.applicable_areas, source_record.id, auth.uid()
  ) RETURNING id INTO new_id;
  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload)
  VALUES (ws_id, auth.uid(), 'workflow.version.created', 'organization_approval_workflow', new_id::TEXT,
    'Nueva versión de flujo creada', jsonb_build_object('source_id', source_record.id, 'version', next_version));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_organization_signature_policy(ws_id UUID, target_policy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy_record public.organization_signature_policies%ROWTYPE;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'signature_policies.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO policy_record FROM public.organization_signature_policies
  WHERE id = target_policy_id AND workspace_id = ws_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_signature_policy_not_found' USING ERRCODE = 'P0002'; END IF;
  IF policy_record.status <> 'draft' THEN RAISE EXCEPTION 'only_draft_policies_can_be_published' USING ERRCODE = '55000'; END IF;
  IF COALESCE(cardinality(policy_record.allowed_signature_types), 0) = 0 THEN
    RAISE EXCEPTION 'signature_policy_requires_a_method' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(COALESCE(policy_record.requirements->'unavailable_capabilities', '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'signature_policy_has_unavailable_capabilities' USING ERRCODE = '23514';
  END IF;
  UPDATE public.organization_signature_policies
  SET status = 'published', published_at = CURRENT_TIMESTAMP, published_by = auth.uid(), updated_at = CURRENT_TIMESTAMP
  WHERE id = target_policy_id;
  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload)
  VALUES (ws_id, auth.uid(), 'signature_policy.published', 'organization_signature_policy', target_policy_id::TEXT,
    'Política de firma publicada', jsonb_build_object('version', policy_record.version));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_organization_signature_policy_version(ws_id UUID, source_policy_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  source_record public.organization_signature_policies%ROWTYPE;
  new_id UUID;
  next_version INTEGER;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'signature_policies.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO source_record FROM public.organization_signature_policies
  WHERE id = source_policy_id AND workspace_id = ws_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_signature_policy_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version
  FROM public.organization_signature_policies WHERE workspace_id = ws_id AND name = source_record.name;
  INSERT INTO public.organization_signature_policies (
    workspace_id, name, description, version, allowed_signature_types, requirements, status,
    security_level, resource_scope, source_version_id, created_by
  ) VALUES (
    ws_id, source_record.name, source_record.description, next_version, source_record.allowed_signature_types,
    source_record.requirements, 'draft', source_record.security_level, source_record.resource_scope, source_record.id, auth.uid()
  ) RETURNING id INTO new_id;
  INSERT INTO public.organization_audit_events (workspace_id, actor_user_id, event_type, resource_type, resource_id, summary, payload)
  VALUES (ws_id, auth.uid(), 'signature_policy.version.created', 'organization_signature_policy', new_id::TEXT,
    'Nueva versión de política de firma creada', jsonb_build_object('source_id', source_record.id, 'version', next_version));
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_directory_person(ws_id UUID, target_person_id UUID)
RETURNS TABLE(
  id UUID, workspace_id UUID, member_id UUID, full_name TEXT, email TEXT, phone TEXT, rfc TEXT,
  relationship_type TEXT, person_type TEXT, job_title TEXT, area_name TEXT, identity_status TEXT,
  status TEXT, valid_from DATE, valid_until DATE, data_version INTEGER, metadata JSONB,
  sensitive_identifiers JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  can_read_sensitive BOOLEAN;
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'directory.read') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  can_read_sensitive := public.has_organization_permission(ws_id, 'directory.sensitive.read');
  RETURN QUERY
  SELECT person.id, person.workspace_id, person.member_id, person.full_name, person.email, person.phone,
    CASE WHEN can_read_sensitive THEN person.rfc ELSE NULL END,
    person.relationship_type, person.person_type, person.job_title, person.area_name, person.identity_status,
    person.status, person.valid_from, person.valid_until, person.data_version, person.metadata,
    CASE WHEN can_read_sensitive THEN person.sensitive_identifiers ELSE '{}'::jsonb END,
    person.created_at, person.updated_at
  FROM public.organization_directory_people person
  WHERE person.workspace_id = ws_id AND person.id = target_person_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_resource_catalog(ws_id UUID)
RETURNS TABLE(
  id UUID, resource_type TEXT, source_id UUID, name TEXT, description TEXT, visibility TEXT,
  version INTEGER, status TEXT, locked BOOLEAN, workflow_name TEXT, policy_name TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'resources.read') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT resource.id, resource.resource_type,
    COALESCE(resource.document_template_id, resource.form_template_id), resource.name, resource.description,
    resource.visibility, resource.version, resource.status, resource.locked,
    workflow.name, policy.name, resource.updated_at
  FROM public.organization_shared_resources resource
  LEFT JOIN public.organization_approval_workflows workflow ON workflow.id = resource.workflow_id
  LEFT JOIN public.organization_signature_policies policy ON policy.id = resource.signature_policy_id
  WHERE resource.workspace_id = ws_id
  ORDER BY resource.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_organization_resource_candidates(ws_id UUID)
RETURNS TABLE(resource_type TEXT, source_id UUID, name TEXT, status TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_organization_permission(ws_id, 'resources.manage') THEN
    RAISE EXCEPTION 'organization_permission_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT 'document_template'::TEXT, template.id, template.name, template.status, template.updated_at
  FROM public.plantillas template
  WHERE template.workspace_id = ws_id
    AND NOT EXISTS (SELECT 1 FROM public.organization_shared_resources resource WHERE resource.document_template_id = template.id)
  UNION ALL
  SELECT 'form'::TEXT, form.id, form.name, form.status, form.updated_at
  FROM public.form_templates form
  WHERE form.workspace_id = ws_id
    AND NOT EXISTS (SELECT 1 FROM public.organization_shared_resources resource WHERE resource.form_template_id = form.id)
  ORDER BY 5 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_organization_workflow(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_workflow_version(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_organization_signature_policy(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_signature_policy_version(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_organization_directory_person(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_organization_resource_catalog(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_organization_resource_candidates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_organization_workflow(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_workflow_version(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_organization_signature_policy(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_signature_policy_version(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_directory_person(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_resource_catalog(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_resource_candidates(UUID) TO authenticated;

ALTER TABLE public.organization_directory_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_shared_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_sensitive_read_directory_evidence" ON public.organization_directory_evidence;
CREATE POLICY "org_sensitive_read_directory_evidence" ON public.organization_directory_evidence
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'directory.sensitive.read'));
DROP POLICY IF EXISTS "org_admin_manage_directory_evidence" ON public.organization_directory_evidence;
CREATE POLICY "org_admin_manage_directory_evidence" ON public.organization_directory_evidence
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'directory.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'directory.manage'));

DROP POLICY IF EXISTS "org_members_read_shared_resources" ON public.organization_shared_resources;
CREATE POLICY "org_members_read_shared_resources" ON public.organization_shared_resources
  FOR SELECT TO authenticated USING (public.has_organization_permission(workspace_id, 'resources.read'));
DROP POLICY IF EXISTS "org_admin_manage_shared_resources" ON public.organization_shared_resources;
CREATE POLICY "org_admin_manage_shared_resources" ON public.organization_shared_resources
  FOR ALL TO authenticated USING (public.has_organization_permission(workspace_id, 'resources.manage'))
  WITH CHECK (public.has_organization_permission(workspace_id, 'resources.manage'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_directory_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_shared_resources TO authenticated;
