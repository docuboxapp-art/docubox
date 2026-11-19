-- Select the row shape before evaluating fields specific to a trigger table.
CREATE OR REPLACE FUNCTION public.enforce_organization_phase2_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'organization_directory_people' THEN
    IF NEW.member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.id = NEW.member_id AND member.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'organization_directory_member_workspace_mismatch' USING ERRCODE = '23514';
    END IF;
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

CREATE OR REPLACE FUNCTION public.protect_published_organization_governance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.status='published' THEN
  IF TG_TABLE_NAME='organization_approval_workflows' THEN
   IF ROW(NEW.name,NEW.description,NEW.version,NEW.definition,NEW.document_type,NEW.applicable_areas)
     IS DISTINCT FROM ROW(OLD.name,OLD.description,OLD.version,OLD.definition,OLD.document_type,OLD.applicable_areas) THEN
    RAISE EXCEPTION 'published_workflow_is_immutable' USING ERRCODE='55000';
   END IF;
  ELSIF TG_TABLE_NAME='organization_signature_policies' THEN
   IF ROW(NEW.name,NEW.description,NEW.version,NEW.security_level,NEW.resource_scope,NEW.allowed_signature_types,NEW.requirements)
     IS DISTINCT FROM ROW(OLD.name,OLD.description,OLD.version,OLD.security_level,OLD.resource_scope,OLD.allowed_signature_types,OLD.requirements) THEN
    RAISE EXCEPTION 'published_signature_policy_is_immutable' USING ERRCODE='55000';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.enforce_organization_phase2_tenant_scope(),public.protect_published_organization_governance() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
