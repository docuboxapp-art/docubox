CREATE TEMP TABLE lucia_acl_smoke (
  case_name text,
  candidate_found boolean,
  expected boolean,
  actual boolean
);

DO $$
DECLARE
  v_document_id uuid;
  v_user_id uuid;
  v_email text;
BEGIN
  SELECT d.id, d.owner_id
  INTO v_document_id, v_user_id
  FROM public.documentos d
  WHERE d.owner_id IS NOT NULL
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, false);
    INSERT INTO lucia_acl_smoke VALUES ('owner_document', true, true, public.can_access_documento(v_document_id));
  ELSE
    INSERT INTO lucia_acl_smoke VALUES ('owner_document', false, true, null);
  END IF;

  SELECT d.id, wm.user_id
  INTO v_document_id, v_user_id
  FROM public.documentos d
  JOIN public.workspace_members wm ON wm.workspace_id = d.workspace_id
  WHERE wm.user_id <> d.owner_id
    AND wm.status = 'active'
    AND lower(wm.role::text) IN ('owner', 'admin', 'workspace_admin')
    AND (wm.access_expires_at IS NULL OR wm.access_expires_at > now())
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, false);
    INSERT INTO lucia_acl_smoke VALUES ('workspace_manager', true, true, public.can_access_documento(v_document_id));
  ELSE
    INSERT INTO lucia_acl_smoke VALUES ('workspace_manager', false, true, null);
  END IF;

  SELECT d.id, wm.user_id
  INTO v_document_id, v_user_id
  FROM public.documentos d
  JOIN public.workspace_members wm ON wm.workspace_id = d.workspace_id
  WHERE wm.user_id <> d.owner_id
    AND wm.status = 'active'
    AND lower(wm.role::text) NOT IN ('owner', 'admin', 'workspace_admin')
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) participant
      WHERE public.try_uuid(participant ->> 'id') = wm.user_id
         OR public.try_uuid(participant ->> 'user_id') = wm.user_id
    )
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, false);
    INSERT INTO lucia_acl_smoke VALUES ('same_workspace_without_document_acl', true, false, public.can_access_documento(v_document_id));
  ELSE
    INSERT INTO lucia_acl_smoke VALUES ('same_workspace_without_document_acl', false, false, null);
  END IF;

  SELECT d.id, wm.user_id
  INTO v_document_id, v_user_id
  FROM public.documentos d
  JOIN public.workspace_members wm ON wm.workspace_id <> d.workspace_id
  WHERE wm.status = 'active'
    AND wm.user_id <> d.owner_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) participant
      WHERE public.try_uuid(participant ->> 'id') = wm.user_id
         OR public.try_uuid(participant ->> 'user_id') = wm.user_id
    )
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, false);
    INSERT INTO lucia_acl_smoke VALUES ('different_workspace', true, false, public.can_access_documento(v_document_id));
  ELSE
    INSERT INTO lucia_acl_smoke VALUES ('different_workspace', false, false, null);
  END IF;

  SELECT d.id,
         COALESCE(public.try_uuid(participant ->> 'user_id'), public.try_uuid(participant ->> 'id')),
         participant ->> 'email'
  INTO v_document_id, v_user_id, v_email
  FROM public.documentos d
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.participantes, '[]'::jsonb)) participant
  WHERE COALESCE(public.try_uuid(participant ->> 'user_id'), public.try_uuid(participant ->> 'id')) IS NOT NULL
    AND lower(COALESCE(participant ->> 'current_access', 'true')) NOT IN ('false', '0', 'no')
    AND participant ->> 'portal_token_invalidated_at' IS NULL
    AND COALESCE(public.try_uuid(participant ->> 'user_id'), public.try_uuid(participant ->> 'id')) <> d.owner_id
  LIMIT 1;

  IF FOUND THEN
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_user_id, 'role', 'authenticated', 'email', v_email)::text,
      false
    );
    INSERT INTO lucia_acl_smoke VALUES ('authorized_participant', true, true, public.can_access_documento(v_document_id));
  ELSE
    INSERT INTO lucia_acl_smoke VALUES ('authorized_participant', false, true, null);
  END IF;
END
$$;

SELECT case_name,
       candidate_found,
       expected,
       actual,
       CASE WHEN candidate_found THEN actual IS NOT DISTINCT FROM expected ELSE null END AS passed
FROM lucia_acl_smoke
ORDER BY case_name;
