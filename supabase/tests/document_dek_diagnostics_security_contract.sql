BEGIN;

SELECT plan(4);

SELECT ok(
  COALESCE((SELECT 'security_invoker=true' = ANY(reloptions)
            FROM pg_class
            WHERE oid = 'public.v_documents_missing_participant_deks'::regclass), false),
  'DEK diagnostics view executes with invoker permissions'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.v_documents_missing_participant_deks', 'SELECT'),
  'anonymous clients cannot read DEK diagnostics'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.v_documents_missing_participant_deks', 'SELECT'),
  'authenticated clients cannot read DEK diagnostics directly'
);

SELECT ok(
  has_table_privilege('service_role', 'public.v_documents_missing_participant_deks', 'SELECT'),
  'trusted backend can read DEK diagnostics'
);

SELECT * FROM finish();
ROLLBACK;
