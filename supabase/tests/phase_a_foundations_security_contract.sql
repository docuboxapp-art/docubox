BEGIN;

SELECT plan(25);

SELECT has_table('public', 'document_participant_references', 'stable participant bridge exists');
SELECT has_table('public', 'document_operational_events', 'canonical document events exist');
SELECT has_column('public', 'document_participant_references', 'id', 'participant identity is stable');
SELECT has_column('public', 'document_participant_references', 'snapshot', 'JSONB compatibility snapshot exists');
SELECT has_column('public', 'document_operational_events', 'correlation_id', 'events carry correlation ids');
SELECT has_column('public', 'document_operational_events', 'event_key', 'events carry idempotency keys');
SELECT has_function(
  'public',
  'update_participante_sub_estado',
  ARRAY['uuid', 'text', 'text'],
  'participant sub-state transition RPC exists'
);
SELECT has_function(
  'public',
  'update_participante_estado',
  ARRAY['uuid', 'text', 'text'],
  'participant state transition RPC exists'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.update_participante_sub_estado(uuid,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot mutate participant sub-state'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.update_participante_estado(uuid,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot mutate participant state'
);
SELECT has_trigger('public', 'documentos', 'ensure_document_participant_reference_ids', 'participant ids are ensured transactionally');
SELECT has_trigger('public', 'documentos', 'sync_document_participant_references', 'participant bridge is synchronized');
SELECT has_trigger('public', 'documentos', 'zz_emit_document_transition_events', 'document transitions emit events');
SELECT has_trigger(
  'public',
  'document_participant_references',
  'enforce_document_participant_reference_scope',
  'participant bridge derives tenant scope from its document'
);
SELECT has_trigger(
  'public',
  'document_operational_events',
  'enforce_document_operational_event_scope',
  'operational events enforce document and participant scope'
);
SELECT has_trigger('public', 'plantillas', 'protect_published_template_immutability', 'published templates are protected in database');
SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_participant_references'::regclass),
  'participant bridge has RLS'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.document_operational_events'::regclass),
  'operational events have RLS'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_participant_references', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot mutate participant references directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.document_operational_events', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot forge document events directly'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.document_participant_references', 'SELECT'),
  'authenticated access is read-only and delegated to RLS'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.document_operational_events', 'SELECT'),
  'authenticated event access is read-only and delegated to RLS'
);
SELECT ok(
  COALESCE((
    SELECT policies.cmd = 'SELECT'
      AND policies.roles @> ARRAY['authenticated']::NAME[]
      AND policies.qual LIKE '%can_access_documento(document_id)%'
    FROM pg_catalog.pg_policies policies
    WHERE policies.schemaname = 'public'
      AND policies.tablename = 'document_participant_references'
      AND policies.policyname = 'document_participant_references_read'
  ), false),
  'participant reference reads reuse canonical document authorization'
);
SELECT ok(
  COALESCE((
    SELECT policies.cmd = 'SELECT'
      AND policies.roles @> ARRAY['authenticated']::NAME[]
      AND policies.qual LIKE '%can_access_documento(document_id)%'
    FROM pg_catalog.pg_policies policies
    WHERE policies.schemaname = 'public'
      AND policies.tablename = 'document_operational_events'
      AND policies.policyname = 'document_operational_events_read'
  ), false),
  'operational event reads reuse canonical document authorization'
);
SELECT ok(
  (SELECT count(*) = count(DISTINCT (document_id, event_key)) FROM public.document_operational_events),
  'event idempotency key is unique per document'
);

SELECT * FROM finish();
ROLLBACK;
