BEGIN;

SELECT plan(22);

SELECT has_table('public', 'participant_completion_attempts', 'completion attempt ledger exists');
SELECT has_column('public', 'participant_completion_attempts', 'participant_reference_id', 'attempt uses stable participant identity');
SELECT has_column('public', 'participant_completion_attempts', 'document_version_id', 'attempt binds the document version');
SELECT has_column('public', 'participant_completion_attempts', 'in_person_session_id', 'attempt can bind a kiosk session');
SELECT has_column('public', 'participant_completion_attempts', 'idempotency_key', 'attempt has an idempotency key');
SELECT has_column('public', 'participant_completion_attempts', 'signature_evidence_id', 'attempt binds operational evidence');
SELECT has_column('public', 'participant_completion_attempts', 'participation_response_id', 'attempt binds the response');
SELECT has_column('public', 'participation_responses', 'participant_reference_id', 'response uses stable participant identity');
SELECT has_column('public', 'participation_responses', 'completion_attempt_id', 'response binds the completion attempt');
SELECT has_column('public', 'participation_responses', 'operational_committed_at', 'response records operational commit time');
SELECT has_function(
  'public', 'claim_participant_completion',
  ARRAY['uuid','uuid','uuid','text','text','text','text','uuid','uuid'],
  'atomic claim function exists'
);
SELECT has_function(
  'public', 'commit_participant_completion',
  ARRAY['uuid','uuid','text','text','uuid','jsonb'],
  'atomic commit function exists'
);
SELECT has_trigger(
  'public', 'participation_responses', 'protect_committed_participation_response',
  'committed participant responses are immutable'
);
SELECT has_trigger(
  'public', 'documentos', 'enforce_atomic_participant_completion',
  'terminal participant transitions require an atomic commit'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.participant_completion_attempts'::regclass),
  'attempt ledger has RLS'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.participant_completion_attempts', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.participant_completion_attempts', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.participant_completion_attempts', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.participant_completion_attempts', 'DELETE'),
  'anonymous clients cannot access attempts'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.participant_completion_attempts', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.participant_completion_attempts', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.participant_completion_attempts', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.participant_completion_attempts', 'DELETE'),
  'authenticated browser clients cannot access attempts'
);
SELECT ok(
  has_table_privilege('service_role', 'public.participant_completion_attempts', 'SELECT')
    AND has_table_privilege('service_role', 'public.participant_completion_attempts', 'INSERT')
    AND has_table_privilege('service_role', 'public.participant_completion_attempts', 'UPDATE'),
  'service role can operate attempts'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.claim_participant_completion(uuid,uuid,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot claim completion'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_participant_completion(uuid,uuid,uuid,text,text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  'browser clients cannot claim completion directly'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.commit_participant_completion(uuid,uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'browser clients cannot commit completion directly'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.commit_participant_completion(uuid,uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'service role can execute the atomic commit'
);

SELECT * FROM finish();
ROLLBACK;
