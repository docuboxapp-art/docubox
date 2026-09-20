-- Repair the deployed delegation function without changing the workspace role enum.
-- Fresh installations already receive the corrected definition from the source migration.
DO $remediation$
DECLARE
  v_signature REGPROCEDURE := 'public.create_group_member_delegation(uuid,uuid,uuid,uuid,uuid,text,text)'::REGPROCEDURE;
  v_definition TEXT;
  v_legacy_expression CONSTANT TEXT := 'COALESCE(v_delegate_member.role, '''')';
  v_fixed_expression CONSTANT TEXT := 'COALESCE(v_delegate_member.role::TEXT, '''')';
BEGIN
  SELECT pg_get_functiondef(v_signature::OID) INTO v_definition;

  IF position(v_fixed_expression IN v_definition) > 0 THEN
    RETURN;
  END IF;

  IF position(v_legacy_expression IN v_definition) = 0 THEN
    RAISE EXCEPTION 'GROUP_MEMBER_DELEGATION_ROLE_CAST_REMEDIATION_SOURCE_MISMATCH';
  END IF;

  EXECUTE replace(v_definition, v_legacy_expression, v_fixed_expression);
END;
$remediation$;
