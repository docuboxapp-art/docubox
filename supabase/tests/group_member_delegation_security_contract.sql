BEGIN;

SELECT plan(23);

SELECT has_column('public', 'document_participant_delegations', 'signing_group_id', 'delegation records its existing signing group');
SELECT has_column('public', 'document_participant_delegations', 'group_member_slot_id', 'delegation binds one logical member slot');
SELECT has_column('public', 'document_participant_delegations', 'delegate_participant_reference_id', 'delegate has a stable participant reference');
SELECT has_column('public', 'document_participant_delegations', 'idempotency_key', 'delegation creation is idempotent');
SELECT has_column('public', 'document_participant_delegations', 'revocation_idempotency_key', 'delegation revocation is idempotent');
SELECT has_column('public', 'document_participant_delegations', 'superseded_at', 'ANY_ONE losing delegations are terminalized');

SELECT has_function(
  'public',
  'create_group_member_delegation',
  ARRAY['uuid','uuid','uuid','uuid','uuid','text','text'],
  'group-member delegation reuses the existing delegation table'
);
SELECT has_function(
  'public',
  'revoke_group_member_delegation',
  ARRAY['uuid','uuid','uuid','uuid','text'],
  'group-member revocation is atomic'
);
SELECT has_function(
  'public',
  'claim_participant_completion_phase_d',
  ARRAY['uuid','uuid','uuid','text','text','text','text','uuid','uuid'],
  'the Phase D winner claim remains the inner completion boundary'
);

SELECT has_trigger(
  'public',
  'document_participant_delegations',
  'emit_group_member_delegation_event',
  'group-member delegation status emits canonical events'
);
SELECT has_trigger(
  'public',
  'document_signing_group_members',
  'close_superseded_group_member_delegation',
  'ANY_ONE closes losing active delegations'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.document_participant_delegations'::regclass),
  'existing delegation RLS remains enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.document_participant_delegations', 'SELECT'),
  'anonymous users cannot read delegations'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_participant_delegations', 'INSERT'),
  'browser clients cannot forge delegation rows'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_participant_delegations', 'UPDATE'),
  'browser clients cannot race revocation against completion'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.create_group_member_delegation(uuid,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot bypass the delegation API'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.revoke_group_member_delegation(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot revoke delegations directly'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.create_group_member_delegation(uuid,uuid,uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'the authorized server can create a group-member delegation'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.revoke_group_member_delegation(uuid,uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the authorized server can revoke a group-member delegation'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'document_group_member_delegations_one_active_slot_idx'
  ),
  'one active delegation per member slot is enforced'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'organization_audit_group_member_delegation_once_idx'
  ),
  'idempotent retries cannot duplicate group-member delegation audit events'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_participant_delegations_group_scope_check'
  ),
  'group delegation references are all present or all absent'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_feature_flags
    WHERE flag_key = 'signature_delegation'
      AND global_enabled = false
      AND rollout_percentage = 0
  ),
  'delegation remains disabled in Production by default'
);

SELECT * FROM finish();
ROLLBACK;
