BEGIN;

SELECT plan(28);

SELECT has_table('public', 'document_custody_transfers', 'bilateral custody transfer ledger exists');
SELECT has_column('public', 'documentos', 'current_custodian_workspace_id', 'document tracks current administrative custodian');
SELECT has_column('public', 'documentos', 'custody_updated_at', 'document tracks custody transition time');
SELECT has_column('public', 'document_custody_transfers', 'source_workspace_id', 'transfer records source organization');
SELECT has_column('public', 'document_custody_transfers', 'destination_workspace_id', 'transfer records destination organization');
SELECT has_column('public', 'document_custody_transfers', 'idempotency_key', 'transfer request is idempotent');
SELECT has_column('public', 'document_custody_transfers', 'correlation_id', 'transfer is correlated across audit and events');
SELECT has_column('public', 'document_custody_transfers', 'expires_at', 'pending transfer has explicit expiration');

SELECT has_function(
  'public',
  'request_cross_tenant_custody_transfer',
  ARRAY['uuid','uuid','uuid','uuid','text','text','uuid','timestamp with time zone'],
  'source request uses one transactional RPC'
);
SELECT has_function(
  'public',
  'resolve_cross_tenant_custody_transfer',
  ARRAY['uuid','uuid','uuid','text','text','text'],
  'destination resolution uses one transactional RPC'
);
SELECT has_function(
  'public',
  'expire_cross_tenant_custody_transfers',
  ARRAY['uuid','timestamp with time zone'],
  'expired requests are terminalized through the canonical operation'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.document_custody_transfers'::regclass),
  'custody transfer RLS is enabled'
);
SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.document_custody_transfers'::regclass),
  'custody transfer RLS is forced'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.document_custody_transfers', 'SELECT'),
  'anonymous users cannot inspect custody requests'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_custody_transfers', 'INSERT'),
  'browser clients cannot forge custody requests'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_custody_transfers', 'UPDATE'),
  'browser clients cannot accept or reject directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_custody_transfers', 'DELETE'),
  'custody transfer history is append-only for browser clients'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.request_cross_tenant_custody_transfer(uuid,uuid,uuid,uuid,text,text,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass source API authorization'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.resolve_cross_tenant_custody_transfer(uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass destination API authorization'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.request_cross_tenant_custody_transfer(uuid,uuid,uuid,uuid,text,text,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'authorized server can request a transfer'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.resolve_cross_tenant_custody_transfer(uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authorized server can resolve a transfer'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'document_custody_transfers_one_active_idx'
  ),
  'only one pending transfer can exist per document'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.document_custody_transfers'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%source_workspace_id, idempotency_key%'
  ),
  'source idempotency key has a database uniqueness guarantee'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.document_custody_transfers'::regclass
      AND pg_get_constraintdef(oid) LIKE '%source_workspace_id <> destination_workspace_id%'
  ),
  'source and destination cannot be the same organization'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.organization_permissions
    WHERE permission_key = 'documents.custody.transfer'
  ),
  'source transfer permission reuses organization RBAC'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.organization_permissions
    WHERE permission_key = 'documents.custody.receive'
  ),
  'destination receive permission reuses organization RBAC'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_feature_flags
    WHERE flag_key = 'cross_tenant_document_custody'
      AND global_enabled = false
      AND rollout_percentage = 0
  ),
  'cross-tenant custody remains disabled by default'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.can_read_document_storage(text)', 'EXECUTE'),
  'authenticated Storage reads continue through the custody-aware access helper'
);

SELECT * FROM finish();
ROLLBACK;
