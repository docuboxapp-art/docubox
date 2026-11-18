-- Each trigger record has its own columns; boolean AND does not protect a
-- reference to a field missing from the other table's record type.
CREATE OR REPLACE FUNCTION public.protect_organization_ownership()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='workspaces' THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'organization_owner_change_requires_transfer_workflow' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='workspace_members' THEN
    IF OLD.role='owner'::public.workspace_member_role THEN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'organization_owner_membership_is_protected' USING ERRCODE='42501';
      END IF;
      IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'organization_owner_change_requires_transfer_workflow' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
