-- Organization phase 5 member-detail contract and cross-tenant integration test.
-- The transaction is rolled back, including all fixture users and workspaces.

BEGIN;

DO $$
DECLARE
  function_name TEXT;
  function_oid OID;
  is_security_definer BOOLEAN;
  configured_search_path TEXT[];
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'set_organization_member_roles',
    'set_organization_member_units',
    'revoke_organization_member_sessions',
    'set_organization_member_access_status'
  ] LOOP
    SELECT p.oid, p.prosecdef, p.proconfig
      INTO function_oid, is_security_definer, configured_search_path
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = function_name
    LIMIT 1;

    IF is_security_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Function public.% must be SECURITY DEFINER', function_name;
    END IF;

    IF configured_search_path IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM unnest(configured_search_path) setting
         WHERE setting = 'search_path=public'
       ) THEN
      RAISE EXCEPTION 'Function public.% must pin search_path to public', function_name;
    END IF;

    IF has_function_privilege('anon', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Anonymous execution must stay revoked on public.%', function_name;
    END IF;
  END LOOP;
END;
$$;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000aa01', 'authenticated', 'authenticated', 'org-phase5-a@example.test', 'fixture', CURRENT_TIMESTAMP, '{}'::JSONB, '{"full_name":"Tenant A"}'::JSONB, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000bb01', 'authenticated', 'authenticated', 'org-phase5-b@example.test', 'fixture', CURRENT_TIMESTAMP, '{}'::JSONB, '{"full_name":"Tenant B"}'::JSONB, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO public.user_profiles (id, email, full_name)
VALUES
  ('00000000-0000-4000-8000-00000000aa01', 'org-phase5-a@example.test', 'Tenant A'),
  ('00000000-0000-4000-8000-00000000bb01', 'org-phase5-b@example.test', 'Tenant B')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name;

INSERT INTO public.workspaces (id, name, workspace_type, owner_id)
VALUES
  ('00000000-0000-4000-8000-00000000aa10', 'Organization phase 5 A', 'business', '00000000-0000-4000-8000-00000000aa01'),
  ('00000000-0000-4000-8000-00000000bb10', 'Organization phase 5 B', 'business', '00000000-0000-4000-8000-00000000bb01');

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES
  ('00000000-0000-4000-8000-00000000aa10', '00000000-0000-4000-8000-00000000aa01', 'owner', 'active'),
  ('00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-00000000bb01', 'owner', 'active');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000aa01', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'test.foreign_member_id',
  (SELECT id::TEXT FROM public.workspace_members WHERE workspace_id = '00000000-0000-4000-8000-00000000bb10' LIMIT 1),
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  own_count INTEGER;
  foreign_count INTEGER;
  foreign_member_id UUID;
  operation_denied BOOLEAN := FALSE;
BEGIN
  SELECT count(*) INTO own_count
  FROM public.workspace_members
  WHERE workspace_id = '00000000-0000-4000-8000-00000000aa10';

  SELECT count(*) INTO foreign_count
  FROM public.workspace_members
  WHERE workspace_id = '00000000-0000-4000-8000-00000000bb10';

  IF own_count < 1 THEN
    RAISE EXCEPTION 'Tenant A cannot read its own membership';
  END IF;

  IF foreign_count <> 0 THEN
    RAISE EXCEPTION 'Tenant A can infer workspace_members from tenant B';
  END IF;

  IF public.has_organization_permission(
    '00000000-0000-4000-8000-00000000bb10',
    'members.read'
  ) THEN
    RAISE EXCEPTION 'Tenant A received a permission from tenant B';
  END IF;

  foreign_member_id := current_setting('test.foreign_member_id')::UUID;

  BEGIN
    PERFORM public.set_organization_member_access_status(
      '00000000-0000-4000-8000-00000000bb10',
      foreign_member_id,
      'suspended'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    operation_denied := TRUE;
  END;

  IF NOT operation_denied THEN
    RAISE EXCEPTION 'Tenant A could suspend a member from tenant B';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
