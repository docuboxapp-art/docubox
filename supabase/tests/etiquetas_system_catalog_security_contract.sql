BEGIN;
SELECT plan(8);

SELECT ok(
  has_table_privilege('authenticated', 'public.etiquetas', 'SELECT'),
  'authenticated users can read the shared system catalog'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.etiquetas', 'INSERT'),
  'authenticated users cannot insert shared labels'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.etiquetas', 'UPDATE'),
  'authenticated users cannot update shared labels'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.etiquetas', 'DELETE'),
  'authenticated users cannot delete shared labels'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.etiquetas', 'SELECT'),
  'anonymous users cannot read the catalog directly'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.etiquetas', 'INSERT'),
  'anonymous users cannot write the catalog'
);
SELECT ok(
  has_table_privilege('service_role', 'public.etiquetas', 'INSERT')
    AND has_table_privilege('service_role', 'public.etiquetas', 'UPDATE')
    AND has_table_privilege('service_role', 'public.etiquetas', 'DELETE'),
  'service role can maintain the system catalog'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'etiquetas'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::name[]
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'etiquetas'
      AND cmd = 'ALL'
      AND roles @> ARRAY['authenticated']::name[]
  ),
  'authenticated users have read policy but no all-actions policy'
);

SELECT * FROM finish();
ROLLBACK;
