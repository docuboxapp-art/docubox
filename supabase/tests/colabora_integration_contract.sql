BEGIN;

SELECT plan(9);

SELECT has_table('public', 'document_versions', 'canonical collaboration versions exist');
SELECT has_column('public', 'documentos', 'storage_path', 'documents retain a private storage path');
SELECT has_table('public', 'collaboration_space_resources', 'spaces link canonical resources');
SELECT has_column('public', 'notifications', 'idempotency_key', 'automation notifications are deduplicated');
SELECT has_column('public', 'collaboration_activity_events', 'idempotency_key', 'automation activity is deduplicated');
SELECT has_function(
  'public',
  'enqueue_collaboration_automations_for_activity',
  ARRAY[]::TEXT[],
  'activity events enqueue published automations'
);
SELECT has_trigger(
  'public',
  'collaboration_activity_events',
  'enqueue_collaboration_automations_activity',
  'automation queue trigger is installed'
);
SELECT has_index('public', 'notifications', 'uq_notifications_idempotency', 'notification effects are unique');
SELECT has_index(
  'public',
  'collaboration_activity_events',
  'uq_collaboration_activity_idempotency',
  'activity effects are unique per workspace'
);

SELECT * FROM finish();
ROLLBACK;
